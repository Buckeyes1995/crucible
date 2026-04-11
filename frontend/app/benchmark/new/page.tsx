"use client";

import { useEffect, useState, useRef } from "react";
import { useModelsStore } from "@/lib/stores/models";
import { api, readSSE, type BenchmarkPrompt } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn, formatBytes } from "@/lib/utils";
import { useRouter, useSearchParams } from "next/navigation";

const CATEGORIES = ["Short", "Medium", "Long", "Coding", "Reasoning", "Math", "Creative", "Instruction-following"];

const PRESET_META: Record<string, { label: string; desc: string; color: string }> = {
  quick:    { label: "Quick",    desc: "3 prompts · ~30s",  color: "border-emerald-500/40 bg-emerald-900/10 text-emerald-300 hover:border-emerald-400/60" },
  standard: { label: "Standard", desc: "7 prompts · ~2 min", color: "border-indigo-500/40 bg-indigo-900/10 text-indigo-300 hover:border-indigo-400/60" },
  deep:     { label: "Deep",     desc: "All prompts · ~10 min", color: "border-amber-500/40 bg-amber-900/10 text-amber-300 hover:border-amber-400/60" },
};

export default function NewBenchmarkPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { models, fetchModels } = useModelsStore();

  const [prompts, setPrompts] = useState<BenchmarkPrompt[]>([]);
  const [presets, setPresets] = useState<Record<string, string[]>>({});
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [selectedPrompts, setSelectedPrompts] = useState<string[]>([]);
  const [customPrompt, setCustomPrompt] = useState("");
  const [customPrompts, setCustomPrompts] = useState<string[]>([]);
  const [reps, setReps] = useState(1);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [temperature, setTemperature] = useState(0.0);
  const [warmupReps, setWarmupReps] = useState(1);
  const [runName, setRunName] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [promptsExpanded, setPromptsExpanded] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [promptSearch, setPromptSearch] = useState("");

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => { fetchModels(); }, [fetchModels]);
  useEffect(() => {
    api.benchmark.prompts().then(setPrompts).catch(console.error);
    api.benchmark.presets().then(setPresets).catch(console.error);
  }, []);
  useEffect(() => {
    const modelId = searchParams.get("model");
    if (modelId) setSelectedModels([modelId]);
  }, [searchParams]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [progress]);

  const toggleModel = (id: string) =>
    setSelectedModels(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const togglePrompt = (id: string) =>
    setSelectedPrompts(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const applyPreset = (key: string) => {
    const ids = presets[key] ?? [];
    setSelectedPrompts(ids);
  };

  const addCustom = () => {
    const t = customPrompt.trim();
    if (t) { setCustomPrompts(p => [...p, t]); setCustomPrompt(""); }
  };

  const totalPrompts = selectedPrompts.length + customPrompts.length;
  const canRun = selectedModels.length > 0 && totalPrompts > 0 && !running;

  const runBenchmark = async () => {
    setRunning(true);
    setProgress([]);
    setRunId(null);

    const config = {
      model_ids: selectedModels,
      prompt_ids: selectedPrompts,
      custom_prompts: customPrompts,
      reps,
      max_tokens: maxTokens,
      temperature,
      warmup_reps: warmupReps,
      name: runName || undefined,
    };

    try {
      const resp = await api.benchmark.run(config);
      await readSSE(
        resp,
        (data) => {
          const event = data.event as string;
          if (event === "start") {
            setProgress(p => [...p, `▶ Started (${data.total_steps} steps)`]);
          } else if (event === "stage") {
            const payload = data.data as Record<string, unknown> | undefined;
            const msg = (payload?.message ?? data.message) as string;
            if (msg) setProgress(p => [...p, `  · ${msg}`]);
          } else if (event === "progress") {
            const status = data.status as string;
            if (status === "loading") {
              setProgress(p => [...p, `⟳ Loading ${data.model_id}…`]);
            } else {
              const model = (data.model_id as string).split(":").pop();
              setProgress(p => [...p, `  Step ${data.step}: ${model} · ${data.prompt_id} rep ${data.rep}`]);
            }
          } else if (event === "result") {
            const m = data.metrics as Record<string, number>;
            const model = (data.model_id as string).split(":").pop();
            setProgress(p => [
              ...p,
              `  ✓ ${model} · ${data.prompt_id} — ${m.throughput_tps?.toFixed(1) ?? "?"} tok/s, TTFT ${m.ttft_ms?.toFixed(0) ?? "?"}ms`,
            ]);
          } else if (event === "done" && data.run_id) {
            const s = data.summary as Record<string, unknown> | undefined;
            setRunId(data.run_id as string);
            setProgress(p => [...p, `✓ Done! Best: ${(s?.best_tps as number)?.toFixed(1) ?? "?"} tok/s`]);
            setRunning(false);
          } else if (event === "error") {
            setProgress(p => [...p, `✗ ${data.message ?? JSON.stringify(data)}`]);
            setRunning(false);
          }
        },
        (err) => {
          setProgress(p => [...p, `Stream error: ${err.message}`]);
          setRunning(false);
        }
      );
    } catch (e) {
      setProgress(p => [...p, `Failed: ${String(e)}`]);
      setRunning(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Benchmark</h1>
        <p className="text-sm text-zinc-500 mt-1">Select models and prompts, then run.</p>
      </div>

      {/* Models */}
      <Section title="Models" hint={selectedModels.length > 0 ? `${selectedModels.length} selected` : "none"}>
        <Input
          placeholder="Filter models…"
          value={modelSearch}
          onChange={e => setModelSearch(e.target.value)}
          className="mb-3 text-sm"
        />
        <div className="grid grid-cols-2 gap-2">
          {models.filter(m =>
            !modelSearch || m.name.toLowerCase().includes(modelSearch.toLowerCase())
          ).map(m => (
            <button
              key={m.id}
              onClick={() => toggleModel(m.id)}
              className={cn(
                "text-left px-3 py-2.5 rounded-lg border transition-all",
                selectedModels.includes(m.id)
                  ? "border-indigo-500/70 bg-indigo-950/30"
                  : "border-white/5 bg-zinc-900/60 hover:border-white/15"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-zinc-100 truncate">{m.name}</span>
                <Badge variant={m.kind as "mlx" | "gguf" | "ollama"} className="shrink-0">{m.kind.toUpperCase()}</Badge>
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">{formatBytes(m.size_bytes)}</div>
            </button>
          ))}
        </div>
      </Section>

      {/* Prompts */}
      <Section
        title="Prompts"
        hint={totalPrompts > 0 ? `${totalPrompts} selected` : "none"}
      >
        {/* Presets */}
        <div className="flex gap-2 mb-4">
          {Object.entries(PRESET_META).map(([key, meta]) => (
            <button
              key={key}
              onClick={() => applyPreset(key)}
              className={cn(
                "flex-1 py-2 px-3 rounded-lg border text-xs font-medium transition-all",
                meta.color
              )}
            >
              <div className="font-semibold">{meta.label}</div>
              <div className="text-xs opacity-70 mt-0.5">{meta.desc}</div>
            </button>
          ))}
        </div>

        {/* Category toggles */}
        <div className="flex gap-1.5 flex-wrap mb-3">
          <button
            onClick={() => setSelectedPrompts(prompts.map(p => p.id))}
            className="px-2.5 py-1 rounded-md text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors"
          >
            All
          </button>
          <button
            onClick={() => setSelectedPrompts([])}
            className="px-2.5 py-1 rounded-md text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors"
          >
            None
          </button>
          {CATEGORIES.filter(cat => prompts.some(p => p.category === cat)).map(cat => {
            const ids = prompts.filter(p => p.category === cat).map(p => p.id);
            const allSel = ids.every(id => selectedPrompts.includes(id));
            return (
              <button
                key={cat}
                onClick={() => setSelectedPrompts(s =>
                  allSel ? s.filter(id => !ids.includes(id)) : [...new Set([...s, ...ids])]
                )}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs border transition-colors",
                  allSel
                    ? "border-indigo-500 bg-indigo-600/20 text-indigo-300"
                    : "border-zinc-700 text-zinc-400 hover:text-zinc-100"
                )}
              >
                {cat}
              </button>
            );
          })}
        </div>

        {/* Prompt search */}
        <Input
          placeholder="Filter prompts…"
          value={promptSearch}
          onChange={e => { setPromptSearch(e.target.value); if (e.target.value) setPromptsExpanded(true); }}
          className="mb-2 text-sm"
        />

        {/* Prompt list — collapsed by default, show top N */}
        <div className={cn("space-y-1 overflow-hidden transition-all", promptsExpanded ? "" : "max-h-48")}>
          {prompts.filter(p =>
            !promptSearch || p.text.toLowerCase().includes(promptSearch.toLowerCase()) || p.category.toLowerCase().includes(promptSearch.toLowerCase())
          ).map(p => (
            <button
              key={p.id}
              onClick={() => togglePrompt(p.id)}
              className={cn(
                "w-full text-left px-3 py-2 rounded-lg border transition-all flex items-center gap-3",
                selectedPrompts.includes(p.id)
                  ? "border-indigo-500/40 bg-indigo-950/20"
                  : "border-white/5 bg-zinc-900/30 hover:border-white/10"
              )}
            >
              <div className={cn(
                "w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center",
                selectedPrompts.includes(p.id) ? "bg-indigo-500 border-indigo-400" : "border-zinc-600"
              )}>
                {selectedPrompts.includes(p.id) && <span className="text-white text-xs leading-none">✓</span>}
              </div>
              <span className="text-xs text-zinc-500 w-24 shrink-0">{p.category}</span>
              <span className="text-xs text-zinc-300 truncate">{p.text}</span>
            </button>
          ))}
        </div>
        <button
          onClick={() => setPromptsExpanded(v => !v)}
          className="text-xs text-zinc-500 hover:text-zinc-300 mt-1 transition-colors"
        >
          {promptsExpanded ? "▲ Show less" : `▼ Show all ${prompts.length} prompts`}
        </button>

        {/* Custom prompt */}
        <div className="flex gap-2 mt-3">
          <Input
            value={customPrompt}
            onChange={e => setCustomPrompt(e.target.value)}
            placeholder="Add custom prompt…"
            onKeyDown={e => e.key === "Enter" && addCustom()}
            className="text-sm"
          />
          <Button variant="secondary" size="sm" onClick={addCustom}>Add</Button>
        </div>
        {customPrompts.map((cp, i) => (
          <div key={i} className="flex items-center gap-2 text-xs text-zinc-400 bg-zinc-800/50 rounded px-3 py-2 mt-1">
            <span className="flex-1 truncate">{cp}</span>
            <button onClick={() => setCustomPrompts(p => p.filter((_, j) => j !== i))} className="text-zinc-600 hover:text-red-400">✕</button>
          </div>
        ))}
      </Section>

      {/* Parameters (collapsed by default) */}
      <div className="border border-white/5 rounded-xl bg-zinc-900/40 overflow-hidden">
        <button
          onClick={() => setShowAdvanced(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <span className="font-medium">Parameters</span>
          <span className="text-xs text-zinc-500">
            {showAdvanced ? "▲ hide" : `max ${maxTokens} tokens · temp ${temperature.toFixed(2)} · ${reps} rep${reps !== 1 ? "s" : ""} ▼`}
          </span>
        </button>
        {showAdvanced && (
          <div className="px-4 pb-4 space-y-4 border-t border-white/5 pt-4">
            <div className="grid grid-cols-3 gap-3">
              <NumField label="Max tokens" value={maxTokens} onChange={setMaxTokens} min={64} max={8192} step={64} />
              <NumField label="Reps per prompt" value={reps} onChange={setReps} min={1} max={10} />
              <NumField label="Warmup reps" value={warmupReps} onChange={setWarmupReps} min={0} max={5} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Temperature</label>
              <div className="flex items-center gap-3">
                <input
                  type="range" min="0" max="2" step="0.05"
                  value={temperature}
                  onChange={e => setTemperature(Number(e.target.value))}
                  className="flex-1 accent-indigo-500"
                />
                <span className="text-sm font-mono text-zinc-300 w-8">{temperature.toFixed(2)}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Run name (optional)</label>
              <Input value={runName} onChange={e => setRunName(e.target.value)} placeholder="e.g. Qwen3 4bit vs 6bit" />
            </div>
          </div>
        )}
      </div>

      {/* Run button */}
      {!running && !runId && (
        <Button
          variant="primary"
          disabled={!canRun}
          onClick={runBenchmark}
          className="w-full py-3 text-base"
        >
          {selectedModels.length === 0
            ? "Select at least one model"
            : totalPrompts === 0
            ? "Select at least one prompt"
            : `Run benchmark · ${selectedModels.length} model${selectedModels.length !== 1 ? "s" : ""} × ${totalPrompts} prompt${totalPrompts !== 1 ? "s" : ""}`}
        </Button>
      )}

      {/* Progress log */}
      {(running || progress.length > 0) && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {running && <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-pulse" />}
            <span className="text-sm text-zinc-400">{running ? "Running…" : "Complete"}</span>
          </div>
          <div
            ref={logRef}
            className="bg-zinc-950 border border-white/10 rounded-lg p-4 h-64 overflow-y-auto font-mono text-xs text-zinc-400 space-y-0.5"
          >
            {progress.map((line, i) => (
              <div key={i} className={cn(
                line.startsWith("✓") && "text-green-400",
                line.startsWith("✗") && "text-red-400",
                line.startsWith("▶") && "text-indigo-300",
              )}>{line}</div>
            ))}
          </div>
          {runId && !running && (
            <div className="flex gap-3">
              <Button variant="primary" onClick={() => router.push(`/benchmark/run/${runId}`)}>
                View results →
              </Button>
              <Button variant="ghost" onClick={() => { setProgress([]); setRunId(null); }}>
                Run again
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border border-white/5 rounded-xl bg-zinc-900/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
        {hint && <span className="text-xs text-zinc-500">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function NumField({ label, value, onChange, min, max, step = 1 }: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step?: number;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs text-zinc-400">{label}</label>
      <input
        type="number" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
      />
    </div>
  );
}
