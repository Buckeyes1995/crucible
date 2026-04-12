"use client";

import { useEffect, useRef, useState } from "react";
import { useModelsStore } from "@/lib/stores/models";
import { api, readSSE, type BenchmarkPrompt, type ModelEntry } from "@/lib/api";
import { cn, formatBytes, formatTps, formatMs } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Play, Square, ChevronDown, ChevronUp, Plus, X, Clock, Zap, AlertTriangle, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// ── Types ──────────────────────────────────────────────────────────────────

type Preset = "quick" | "standard" | "deep" | "custom";

type LiveResult = {
  modelId: string;
  modelName: string;
  promptId: string;
  rep: number;
  tps: number | null;
  ttft: number | null;
  tokens: number | null;
  done: boolean;
};

type ModelSummary = {
  modelId: string;
  modelName: string;
  tpsList: number[];
  ttftList: number[];
  done: boolean;
};

type HistoryRow = {
  run_id: string;
  created_at: string;
  name?: string;
  model_ids?: string[];
  prompt_count?: number;
  best_tps?: number;
  has_regression?: boolean;
};

const PRESET_CONFIG = {
  quick:    { label: "Quick",    icon: "⚡", desc: "3 prompts · ~30s",   color: "emerald" },
  standard: { label: "Standard", icon: "◈",  desc: "7 prompts · ~2 min", color: "indigo"  },
  deep:     { label: "Deep",     icon: "◉",  desc: "All prompts · ~10m", color: "amber"   },
  custom:   { label: "Custom",   icon: "+",  desc: "Pick your own",      color: "violet"  },
} as const;

const PRESET_COLORS: Record<string, string> = {
  emerald: "border-emerald-500/50 bg-emerald-900/10 text-emerald-300 ring-emerald-500/40",
  indigo:  "border-indigo-500/50  bg-indigo-900/10  text-indigo-300  ring-indigo-500/40",
  amber:   "border-amber-500/50   bg-amber-900/10   text-amber-300   ring-amber-500/40",
  violet:  "border-violet-500/50  bg-violet-900/10  text-violet-300  ring-violet-500/40",
};

const INACTIVE_PRESET = "border-white/8 bg-zinc-900/40 text-zinc-400 hover:border-white/20 hover:text-zinc-200";

// ── Main page ──────────────────────────────────────────────────────────────

export default function Benchmark2Page() {
  const router = useRouter();
  const { models, fetchModels, activeModelId } = useModelsStore();

  // Config state
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [modelSearch, setModelSearch] = useState("");
  const [preset, setPreset] = useState<Preset>("standard");
  const [presets, setPresets] = useState<Record<string, string[]>>({});
  const [allPrompts, setAllPrompts] = useState<BenchmarkPrompt[]>([]);
  const [customPrompts, setCustomPrompts] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState("");
  const [selectedPromptIds, setSelectedPromptIds] = useState<string[]>([]);
  const [showCustom, setShowCustom] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [reps, setReps] = useState(1);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [temperature, setTemperature] = useState(0.0);
  const [runName, setRunName] = useState("");

  // Run state
  const [phase, setPhase] = useState<"idle" | "loading-model" | "running" | "done">("idle");
  const [loadingMsg, setLoadingMsg] = useState("");
  const [liveResults, setLiveResults] = useState<LiveResult[]>([]);
  const [modelSummaries, setModelSummaries] = useState<Map<string, ModelSummary>>(new Map());
  const [completedSteps, setCompletedSteps] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);
  const [finishedRunId, setFinishedRunId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  // History
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const abortRef = useRef<AbortController | null>(null);

  // Init
  useEffect(() => { fetchModels(); }, [fetchModels]);
  useEffect(() => {
    api.benchmark.prompts().then(setAllPrompts).catch(() => {});
    api.benchmark.presets().then(setPresets).catch(() => {});
    api.params.getDefaults().then(d => {
      if (d.temperature != null) setTemperature(d.temperature);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    loadHistory();
  }, []);

  // When selected models change, pull merged temperature for the first selected model
  useEffect(() => {
    if (selectedModels.length === 0) return;
    const first = selectedModels[0];
    Promise.all([
      api.params.getDefaults().catch(() => ({} as Record<string, unknown>)),
      api.models.getParams(first).catch(() => ({} as Record<string, unknown>)),
    ]).then(([defaults, modelParams]) => {
      const merged = { ...defaults, ...Object.fromEntries(Object.entries(modelParams).filter(([, v]) => v != null)) };
      if (merged.temperature != null) setTemperature(merged.temperature as number);
    });
  }, [selectedModels[0]]);

  // Pre-select active model
  useEffect(() => {
    if (activeModelId && selectedModels.length === 0) {
      setSelectedModels([activeModelId]);
    }
  }, [activeModelId]);

  // Sync preset → selectedPromptIds
  useEffect(() => {
    if (preset !== "custom" && presets[preset]) {
      setSelectedPromptIds(presets[preset]);
    }
  }, [preset, presets]);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const rows = await api.benchmark.history() as HistoryRow[];
      setHistory(rows.slice(0, 8));
    } finally {
      setHistoryLoading(false);
    }
  };

  // Computed
  const filteredModels = models.filter(m =>
    !m.hidden && (!modelSearch || m.name.toLowerCase().includes(modelSearch.toLowerCase()))
  );
  const promptCount = preset === "custom"
    ? selectedPromptIds.length + customPrompts.length
    : (presets[preset] ?? []).length;
  const canRun = selectedModels.length > 0 && promptCount > 0 && phase === "idle";

  const totalOps = selectedModels.length * promptCount * reps;

  // ── Run ────────────────────────────────────────────────────────────────────

  const runBenchmark = async () => {
    setPhase("loading-model");
    setLiveResults([]);
    setModelSummaries(new Map());
    setCompletedSteps(0);
    setTotalSteps(0);
    setFinishedRunId(null);
    setRunError(null);
    setLoadingMsg("Starting…");

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const config = {
      model_ids: selectedModels,
      prompt_ids: preset !== "custom" ? (presets[preset] ?? []) : selectedPromptIds,
      custom_prompts: customPrompts,
      reps,
      max_tokens: maxTokens,
      temperature,
      name: runName || undefined,
    };

    try {
      const resp = await api.benchmark.run(config);
      await readSSE(resp, (data) => {
        if (ctrl.signal.aborted) return;
        const event = data.event as string;

        if (event === "start") {
          setPhase("running");
          setTotalSteps(data.total_steps as number ?? 0);
        } else if (event === "stage" || event === "progress" && data.status === "loading") {
          const payload = data.data as Record<string, unknown> | undefined;
          const msg = (payload?.message ?? data.message) as string ?? "";
          setLoadingMsg(msg || `Loading ${data.model_id ?? ""}…`);
          setPhase("loading-model");
        } else if (event === "progress" && data.status === "running") {
          setPhase("running");
        } else if (event === "result") {
          const m = data.metrics as Record<string, number | null> ?? {};
          const modelId = data.model_id as string;
          const modelName = (modelId).split(":").pop() ?? modelId;
          const result: LiveResult = {
            modelId,
            modelName,
            promptId: data.prompt_id as string,
            rep: data.rep as number,
            tps: m.throughput_tps ?? null,
            ttft: m.ttft_ms ?? null,
            tokens: m.output_tokens ?? null,
            done: true,
          };
          setLiveResults(prev => [...prev, result]);
          setCompletedSteps(s => s + 1);
          setModelSummaries(prev => {
            const next = new Map(prev);
            const existing = next.get(modelId) ?? { modelId, modelName, tpsList: [], ttftList: [], done: false };
            if (m.throughput_tps != null) existing.tpsList.push(m.throughput_tps);
            if (m.ttft_ms != null) existing.ttftList.push(m.ttft_ms);
            next.set(modelId, existing);
            return next;
          });
        } else if (event === "done") {
          setFinishedRunId(data.run_id as string ?? null);
          setPhase("done");
          setModelSummaries(prev => {
            const next = new Map(prev);
            for (const [k, v] of next) next.set(k, { ...v, done: true });
            return next;
          });
          loadHistory();
        } else if (event === "error") {
          setRunError(String(data.message ?? "Unknown error"));
          setPhase("idle");
        }
      });
    } catch (e: unknown) {
      if ((e as Error)?.name !== "AbortError") {
        setRunError(String(e));
      }
      setPhase("idle");
    }
  };

  const stopRun = () => {
    abortRef.current?.abort();
    setPhase("idle");
    setLoadingMsg("");
  };

  const reset = () => {
    setPhase("idle");
    setLiveResults([]);
    setModelSummaries(new Map());
    setFinishedRunId(null);
    setRunError(null);
    setCompletedSteps(0);
    setTotalSteps(0);
    setRunName("");
  };

  const addCustomPrompt = () => {
    const t = customInput.trim();
    if (t && !customPrompts.includes(t)) {
      setCustomPrompts(p => [...p, t]);
      setCustomInput("");
    }
  };

  const progress = totalSteps > 0 ? completedSteps / totalSteps : 0;

  return (
    <div className="flex h-full min-h-0">

      {/* ── Left config rail ─────────────────────────────────────────────── */}
      <div className="w-80 shrink-0 flex flex-col border-r border-white/10 bg-zinc-950/60 min-h-0">

        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 shrink-0">
          <h1 className="text-base font-bold text-zinc-100">Benchmark</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Measure inference speed across models</p>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-6">

          {/* ── Step 1: Models ─────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
                1 · Models
              </label>
              {selectedModels.length > 0 && (
                <span className="text-xs text-indigo-400">{selectedModels.length} selected</span>
              )}
            </div>

            {models.length > 6 && (
              <input
                value={modelSearch}
                onChange={e => setModelSearch(e.target.value)}
                placeholder="Filter…"
                className="w-full mb-2 bg-zinc-800/60 border border-zinc-700/50 rounded px-2.5 py-1.5 text-xs text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/60"
              />
            )}

            <div className="space-y-1 max-h-52 overflow-y-auto pr-0.5">
              {filteredModels.map(m => {
                const sel = selectedModels.includes(m.id);
                const isActive = m.id === activeModelId;
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelectedModels(s => sel ? s.filter(x => x !== m.id) : [...s, m.id])}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-all",
                      sel
                        ? "border-indigo-500/50 bg-indigo-950/20"
                        : "border-white/5 bg-zinc-900/30 hover:border-white/15"
                    )}
                  >
                    <div className={cn(
                      "w-4 h-4 rounded border shrink-0 flex items-center justify-center",
                      sel ? "bg-indigo-500 border-indigo-400" : "border-zinc-600"
                    )}>
                      {sel && <span className="text-white text-[10px] leading-none font-bold">✓</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-zinc-200 truncate">{m.name}</span>
                        {isActive && (
                          <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-green-900/40 text-green-400 border border-green-700/30">LOADED</span>
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">{formatBytes(m.size_bytes ?? 0)} · {m.kind.toUpperCase()}</div>
                    </div>
                  </button>
                );
              })}
              {filteredModels.length === 0 && (
                <div className="text-xs text-zinc-600 text-center py-3">No models found</div>
              )}
            </div>
          </div>

          {/* ── Step 2: Prompts ────────────────────────────────────────── */}
          <div>
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wide block mb-2">
              2 · Prompts
            </label>

            {/* Preset cards — primary action */}
            <div className="grid grid-cols-2 gap-2">
              {(["quick", "standard", "deep", "custom"] as Preset[]).map(p => {
                const cfg = PRESET_CONFIG[p];
                const active = preset === p;
                const colorKey = cfg.color;
                return (
                  <button
                    key={p}
                    onClick={() => { setPreset(p); if (p === "custom") setShowCustom(true); }}
                    className={cn(
                      "rounded-lg border px-3 py-2.5 text-left transition-all",
                      active
                        ? cn(PRESET_COLORS[colorKey], "ring-1")
                        : INACTIVE_PRESET
                    )}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-sm">{cfg.icon}</span>
                      <span className="text-xs font-semibold">{cfg.label}</span>
                    </div>
                    <div className="text-[10px] opacity-70">{cfg.desc}</div>
                  </button>
                );
              })}
            </div>

            {/* Custom prompt panel */}
            {preset === "custom" && (
              <div className="mt-3 space-y-2">
                {/* Category chips */}
                <div className="flex flex-wrap gap-1">
                  {["Short","Medium","Long","Coding","Reasoning","Math"].filter(cat =>
                    allPrompts.some(p => p.category === cat)
                  ).map(cat => {
                    const ids = allPrompts.filter(p => p.category === cat).map(p => p.id);
                    const allSel = ids.every(id => selectedPromptIds.includes(id));
                    return (
                      <button
                        key={cat}
                        onClick={() => setSelectedPromptIds(s =>
                          allSel ? s.filter(id => !ids.includes(id)) : [...new Set([...s, ...ids])]
                        )}
                        className={cn(
                          "px-2 py-0.5 rounded text-[10px] border transition-colors",
                          allSel
                            ? "border-violet-500/60 bg-violet-900/20 text-violet-300"
                            : "border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500"
                        )}
                      >
                        {cat} <span className="opacity-60">({allPrompts.filter(p => p.category === cat).length})</span>
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setSelectedPromptIds(allPrompts.map(p => p.id))}
                    className="px-2 py-0.5 rounded text-[10px] border border-zinc-700 text-zinc-500 hover:text-zinc-300"
                  >All</button>
                  <button
                    onClick={() => setSelectedPromptIds([])}
                    className="px-2 py-0.5 rounded text-[10px] border border-zinc-700 text-zinc-500 hover:text-zinc-300"
                  >None</button>
                </div>
                {selectedPromptIds.length > 0 && (
                  <div className="text-[10px] text-zinc-500">{selectedPromptIds.length} built-in selected</div>
                )}
                {/* Custom text input */}
                <div className="flex gap-1.5">
                  <input
                    value={customInput}
                    onChange={e => setCustomInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addCustomPrompt()}
                    placeholder="Add custom prompt…"
                    className="flex-1 bg-zinc-800/60 border border-zinc-700/50 rounded px-2.5 py-1.5 text-xs text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/60"
                  />
                  <button
                    onClick={addCustomPrompt}
                    className="px-2.5 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                {customPrompts.map((cp, i) => (
                  <div key={i} className="flex items-center gap-2 bg-zinc-800/40 border border-white/5 rounded px-2.5 py-1.5">
                    <span className="flex-1 text-[10px] text-zinc-400 truncate">{cp}</span>
                    <button onClick={() => setCustomPrompts(p => p.filter((_, j) => j !== i))} className="text-zinc-600 hover:text-red-400 shrink-0">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Step 3: Advanced (collapsed) ──────────────────────────── */}
          <div>
            <button
              onClick={() => setShowAdvanced(v => !v)}
              className="w-full flex items-center justify-between text-xs font-semibold text-zinc-400 uppercase tracking-wide hover:text-zinc-300 transition-colors"
            >
              <span>3 · Settings</span>
              {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <MiniField label="Reps" value={reps} onChange={setReps} min={1} max={10} />
                  <MiniField label="Max tokens" value={maxTokens} onChange={setMaxTokens} min={64} max={8192} step={64} />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] text-zinc-500">Temperature</label>
                    <span className="text-[10px] font-mono text-zinc-400">{temperature.toFixed(2)}</span>
                  </div>
                  <input
                    type="range" min="0" max="2" step="0.05" value={temperature}
                    onChange={e => setTemperature(Number(e.target.value))}
                    className="w-full accent-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 block mb-1">Run name</label>
                  <input
                    value={runName}
                    onChange={e => setRunName(e.target.value)}
                    placeholder="Optional label…"
                    className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded px-2.5 py-1.5 text-xs text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/60"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Run button — always visible at bottom */}
        <div className="px-5 py-4 border-t border-white/10 space-y-2 shrink-0">
          {phase === "idle" ? (
            <>
              <Button
                variant="primary"
                className="w-full"
                disabled={!canRun}
                onClick={runBenchmark}
              >
                <Play className="w-3.5 h-3.5" />
                {selectedModels.length === 0
                  ? "Select a model"
                  : promptCount === 0
                  ? "Select prompts"
                  : `Run · ${selectedModels.length}m × ${promptCount}p${reps > 1 ? ` × ${reps}r` : ""}`}
              </Button>
              {totalOps > 0 && selectedModels.length > 0 && (
                <p className="text-[10px] text-zinc-600 text-center">{totalOps} total inference{totalOps !== 1 ? "s" : ""}</p>
              )}
            </>
          ) : phase === "done" ? (
            <div className="space-y-2">
              {finishedRunId && (
                <Button variant="primary" className="w-full" onClick={() => router.push(`/benchmark/run/${finishedRunId}`)}>
                  View full results →
                </Button>
              )}
              <Button variant="ghost" className="w-full" onClick={reset}>Run again</Button>
            </div>
          ) : (
            <button
              onClick={stopRun}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-red-900/20 border border-red-500/30 text-red-400 text-sm font-medium hover:bg-red-900/30 transition-colors"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              Stop
            </button>
          )}
        </div>
      </div>

      {/* ── Right panel ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto bg-zinc-950/30">

        {/* ── Idle: show history ─────────────────────────────────────────── */}
        {phase === "idle" && !runError && (
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-zinc-300">Recent Runs</h2>
              <Link href="/benchmark/history" className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
                View all <ExternalLink className="w-3 h-3" />
              </Link>
            </div>

            {historyLoading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-14 bg-zinc-900/60 rounded-lg animate-pulse border border-white/5" />
                ))}
              </div>
            ) : history.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="text-4xl mb-3">⚡</div>
                <p className="text-sm font-medium text-zinc-300">No benchmark runs yet</p>
                <p className="text-xs text-zinc-600 mt-1">Select models and a preset, then hit Run</p>
              </div>
            ) : (
              <div className="space-y-2">
                {history.map(run => (
                  <Link
                    key={run.run_id}
                    href={`/benchmark/run/${run.run_id}`}
                    className="flex items-center gap-4 px-4 py-3 rounded-lg border border-white/8 bg-zinc-900/40 hover:border-white/20 hover:bg-zinc-900/60 transition-all group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-100 truncate">
                          {run.name || "Untitled run"}
                        </span>
                        {run.has_regression && (
                          <span title="Performance regression detected" className="shrink-0">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        {new Date(run.created_at).toLocaleString()} · {run.model_ids?.length ?? "?"} model{(run.model_ids?.length ?? 0) !== 1 ? "s" : ""} · {run.prompt_count ?? "?"} prompts
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {run.best_tps != null && (
                        <div className="text-sm font-mono font-semibold text-indigo-300">{run.best_tps.toFixed(1)}</div>
                      )}
                      <div className="text-[10px] text-zinc-600">tok/s best</div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Error ──────────────────────────────────────────────────────── */}
        {runError && (
          <div className="p-6">
            <div className="flex items-center gap-3 p-4 rounded-lg bg-red-900/20 border border-red-500/30 text-red-300 text-sm">
              <X className="w-4 h-4 shrink-0" />
              {runError}
            </div>
            <button onClick={reset} className="mt-3 text-xs text-zinc-500 hover:text-zinc-300">← Try again</button>
          </div>
        )}

        {/* ── Loading model ──────────────────────────────────────────────── */}
        {phase === "loading-model" && (
          <div className="flex flex-col items-center justify-center flex-1 py-16 px-6">
            <div className="relative w-12 h-12 mb-5">
              <div className="absolute inset-0 rounded-full border-2 border-indigo-500/20" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-indigo-500 animate-spin" />
            </div>
            <p className="text-sm font-medium text-zinc-200 text-center">{loadingMsg || "Loading model…"}</p>
            <p className="text-xs text-zinc-500 mt-1">This may take a moment for large models</p>
          </div>
        )}

        {/* ── Running / Done ─────────────────────────────────────────────── */}
        {(phase === "running" || phase === "done") && (
          <div className="p-6 space-y-5">

            {/* Progress bar */}
            {phase === "running" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse inline-block" />
                    Running…
                  </span>
                  <span className="text-zinc-500 font-mono">{completedSteps} / {totalSteps}</span>
                </div>
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
              </div>
            )}

            {phase === "done" && (
              <div className="flex items-center gap-2 text-sm text-green-400">
                <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
                Complete
              </div>
            )}

            {/* Per-model summary cards */}
            {modelSummaries.size > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[...modelSummaries.values()].map(summary => {
                  const avgTps = summary.tpsList.length
                    ? summary.tpsList.reduce((a, b) => a + b, 0) / summary.tpsList.length
                    : null;
                  const avgTtft = summary.ttftList.length
                    ? summary.ttftList.reduce((a, b) => a + b, 0) / summary.ttftList.length
                    : null;
                  const maxTps = summary.tpsList.length ? Math.max(...summary.tpsList) : null;
                  const completed = summary.tpsList.length;
                  const expected = promptCount * reps;
                  return (
                    <div key={summary.modelId} className={cn(
                      "rounded-xl border p-4 space-y-3 transition-all",
                      summary.done
                        ? "border-white/10 bg-zinc-900/50"
                        : "border-indigo-500/20 bg-indigo-950/10"
                    )}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-zinc-100 truncate">{summary.modelName}</p>
                          <p className="text-[10px] text-zinc-500 mt-0.5">
                            {completed} / {expected} inference{expected !== 1 ? "s" : ""}
                            {!summary.done && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />}
                          </p>
                        </div>
                        {summary.done && <span className="text-xs text-green-400 shrink-0">✓ done</span>}
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <Stat label="Avg tok/s" value={avgTps != null ? avgTps.toFixed(1) : "—"} highlight />
                        <Stat label="Best tok/s" value={maxTps != null ? maxTps.toFixed(1) : "—"} />
                        <Stat label="Avg TTFT" value={avgTtft != null ? `${avgTtft.toFixed(0)}ms` : "—"} />
                      </div>

                      {/* Mini result list */}
                      {liveResults.filter(r => r.modelId === summary.modelId).length > 0 && (
                        <div className="space-y-1 pt-1 border-t border-white/5">
                          {liveResults.filter(r => r.modelId === summary.modelId).map((r, i) => (
                            <div key={i} className="flex items-center justify-between text-[10px]">
                              <span className="text-zinc-500 truncate max-w-[140px]">{r.promptId}</span>
                              <span className="font-mono text-indigo-300 shrink-0">
                                {r.tps != null ? `${r.tps.toFixed(1)} tok/s` : "—"}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* While running and no results yet */}
            {phase === "running" && modelSummaries.size === 0 && (
              <div className="flex items-center gap-3 text-sm text-zinc-500 animate-pulse">
                <Clock className="w-4 h-4" />
                Waiting for first result…
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="text-center">
      <div className={cn("text-base font-mono font-semibold", highlight ? "text-indigo-300" : "text-zinc-200")}>
        {value}
      </div>
      <div className="text-[9px] text-zinc-600 mt-0.5 uppercase tracking-wide">{label}</div>
    </div>
  );
}

function MiniField({ label, value, onChange, min, max, step = 1 }: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step?: number;
}) {
  return (
    <div>
      <label className="text-[10px] text-zinc-500 block mb-1">{label}</label>
      <input
        type="number" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full rounded border border-zinc-700 bg-zinc-800/80 px-2 py-1.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-indigo-500/60"
      />
    </div>
  );
}
