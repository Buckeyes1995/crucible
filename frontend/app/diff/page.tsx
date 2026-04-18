"use client";

import { useEffect, useRef, useState } from "react";
import { api, readSSE, type ModelEntry, type PromptTemplate } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GitCompare, Play, Loader2, X, Copy, Check, BookOpen, ChevronDown } from "lucide-react";

type DiffStatus = "queued" | "loading" | "streaming" | "done" | "error";

export default function DiffPage() {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [responses, setResponses] = useState<Record<number, { model: string; text: string; tps: number | null; done: boolean; status: DiffStatus; error?: string }>>({});
  const [modelNames, setModelNames] = useState<string[]>([]);
  const [availableBytes, setAvailableBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [maxTokensInput, setMaxTokensInput] = useState("4096");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [eventCount, setEventCount] = useState(0); // diag — every SSE event ticks this
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const templateRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Safety: clear any stuck "running" state left over from a prior stream that hung
  useEffect(() => {
    setRunning(false);
    setResponses({});
  }, []);

  // Load prompt templates once
  useEffect(() => {
    api.templates.list().then(setTemplates).catch(() => {});
  }, []);

  // Close template dropdown on outside click
  useEffect(() => {
    if (!showTemplates) return;
    const handler = (e: MouseEvent) => {
      if (templateRef.current && !templateRef.current.contains(e.target as Node)) {
        setShowTemplates(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showTemplates]);

  useEffect(() => {
    api.models.list().then((all) => setModels(all.filter((m) => m.kind === "mlx" && m.node === "local" && !m.hidden)));
    const refreshMem = () => {
      fetch("/api/status").then((r) => r.json()).then((s) => {
        setAvailableBytes(s.available_memory_bytes ?? 0);
        setTotalBytes(s.total_memory_bytes ?? 0);
      }).catch(() => {});
    };
    refreshMem();
    const id = setInterval(refreshMem, 5000);
    return () => clearInterval(id);
  }, []);

  // Sequential diff: each model runs solo so only individual size matters
  const largestSelected = selected.reduce((max, id) => {
    const sz = models.find((m) => m.id === id)?.size_bytes ?? 0;
    return Math.max(max, sz);
  }, 0);

  const wouldExceed = (m: ModelEntry): boolean => {
    if (selected.includes(m.id)) return false;
    const size = m.size_bytes ?? 0;
    return size > availableBytes;
  };

  const toggleModel = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 6) return prev;
      return [...prev, id];
    });
  };

  const fmtGB = (b: number) => (b / 1e9).toFixed(1) + " GB";

  const stopDiff = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
  };

  async function runDiff() {
    if (selected.length < 2 || !prompt.trim()) return;
    setRunning(true);
    setResponses({});

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
    const resp = await fetch("/api/diff/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model_ids: selected, prompt: prompt.trim(), temperature: 0.7, max_tokens: maxTokens }),
      signal: ctrl.signal,
    });

    setEventCount(0);
    setLastEventAt(null);
    await readSSE(resp, (data) => {
      setEventCount((c) => c + 1);
      setLastEventAt(Date.now());
      const event = data.event as string;
      if (event === "start") {
        const names = data.models as string[];
        setModelNames(names);
        // Seed all slots as "queued" (waiting). Backend sends "running" when each
        // model actually starts loading in sequential mode.
        setResponses(Object.fromEntries(names.map((n, i) => [i, { model: n, text: "", tps: null, done: false, status: "queued" as DiffStatus }])));
      } else if (event === "running") {
        const idx = data.index as number;
        setResponses((prev) => ({
          ...prev,
          [idx]: { ...prev[idx], model: (data.model as string) ?? prev[idx]?.model ?? "", text: "", done: false, tps: null, status: "loading" },
        }));
      } else if (event === "token") {
        const idx = data.index as number;
        setResponses((prev) => ({
          ...prev,
          [idx]: { ...prev[idx], text: (prev[idx]?.text ?? "") + (data.token as string), model: prev[idx]?.model ?? "", done: false, tps: prev[idx]?.tps ?? null, status: "streaming" },
        }));
      } else if (event === "done") {
        const idx = data.index as number;
        setResponses((prev) => ({
          ...prev,
          [idx]: { model: data.model as string, text: data.response as string, tps: data.tps as number | null, done: true, status: "done" },
        }));
      } else if (event === "error") {
        const idx = data.index as number;
        setResponses((prev) => ({
          ...prev,
          [idx]: { ...prev[idx], model: (data.model as string) ?? prev[idx]?.model ?? "", done: true, status: "error", error: (data.message as string) ?? "Error", tps: prev[idx]?.tps ?? null, text: prev[idx]?.text ?? "" },
        }));
      } else if (event === "complete") {
        // Safety: if any panel is still stuck in streaming/queued (missed done event),
        // mark it done so the UI doesn't lie about what's running.
        setResponses((prev) => {
          const next: typeof prev = {};
          for (const [k, v] of Object.entries(prev)) {
            if (v.status === "streaming" || v.status === "queued") {
              next[Number(k)] = { ...v, done: true, status: "done" };
            } else {
              next[Number(k)] = v;
            }
          }
          return next;
        });
        setRunning(false);
      }
    });
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") console.error("diff failed:", e);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  const cols = Math.min(selected.length || 2, 4);

  return (
    <div className="flex flex-col h-full min-h-screen">
      <div className="px-6 py-4 border-b border-white/[0.04] flex items-center gap-3">
        <GitCompare className="w-5 h-5 text-indigo-400" />
        <h1 className="text-lg font-semibold text-zinc-100">Model Diff</h1>
        <span className="text-xs text-zinc-500">{selected.length} selected</span>
        {running && (
          <span className="text-xs font-mono text-zinc-500 ml-auto">
            events: <span className="text-indigo-400">{eventCount}</span>
            {lastEventAt && <span className="text-zinc-600"> · {Math.floor((Date.now() - lastEventAt) / 1000)}s ago</span>}
          </span>
        )}
        {!running && selected.length > 0 && (
          <span className="text-xs text-zinc-600 ml-auto font-mono">
            <span className="text-zinc-600">largest: </span>
            <span className={cn(largestSelected > availableBytes ? "text-red-400" : largestSelected > availableBytes * 0.85 ? "text-amber-400" : "text-zinc-300")}>
              {fmtGB(largestSelected)}
            </span>
            <span className="text-zinc-600"> · </span>
            <span className="text-zinc-300">{fmtGB(availableBytes)}</span>
            <span className="text-zinc-600"> free · </span>
            <span className="text-zinc-600">runs sequentially</span>
          </span>
        )}
      </div>

      <div className="px-6 py-3 border-b border-white/[0.04] flex gap-2 flex-wrap">
        {models.map((m) => {
          const isSelected = selected.includes(m.id);
          const exceeds = wouldExceed(m);
          const atLimit = selected.length >= 6 && !isSelected;
          const disabled = exceeds || atLimit;
          const size = m.size_bytes ? (m.size_bytes / 1e9).toFixed(1) : "?";
          const title = exceeds
            ? `Too large on its own — needs ${fmtGB(m.size_bytes ?? 0)}, only ${fmtGB(availableBytes)} free`
            : atLimit ? "Max 6 models per diff"
            : `${size} GB`;
          return (
            <button
              key={m.id}
              onClick={() => !disabled && toggleModel(m.id)}
              disabled={disabled}
              title={title}
              className={cn("px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5",
                isSelected && "bg-indigo-600 text-white",
                !isSelected && !disabled && "bg-zinc-800 text-zinc-400 hover:text-zinc-100",
                !isSelected && exceeds && "bg-amber-950/30 border border-amber-500/30 text-amber-400/60 cursor-not-allowed",
                !isSelected && atLimit && !exceeds && "bg-zinc-900 text-zinc-700 cursor-not-allowed opacity-50"
              )}>
              {m.name.slice(0, 30)}
              <span className={cn("text-[10px] font-mono opacity-70", isSelected && "opacity-80")}>{size}G</span>
            </button>
          );
        })}
      </div>

      <div className="px-6 py-3 border-b border-white/[0.04] flex gap-3">
        <div className="flex-1 flex flex-col gap-1.5">
          <div ref={templateRef} className="relative">
            <button
              onClick={() => setShowTemplates((v) => !v)}
              disabled={running}
              className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded border border-zinc-700/50 hover:border-zinc-600 bg-zinc-800/60 transition-colors disabled:opacity-50"
            >
              <BookOpen className="w-3 h-3" />
              Templates
              <ChevronDown className={cn("w-3 h-3 transition-transform", showTemplates && "rotate-180")} />
            </button>
            {showTemplates && (
              <div className="absolute top-full left-0 mt-1 w-96 max-h-80 overflow-y-auto bg-zinc-900 border border-white/10 rounded-lg shadow-2xl z-20">
                {templates.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-zinc-500">No templates saved. Create some in the Templates page.</div>
                ) : (
                  templates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => { setPrompt(t.content); setShowTemplates(false); }}
                      className="w-full text-left px-3 py-2 hover:bg-zinc-800 border-b border-white/5 last:border-0"
                    >
                      <div className="text-xs font-medium text-zinc-100 truncate">{t.name}</div>
                      {t.description && <div className="text-[10px] text-zinc-500 truncate mt-0.5">{t.description}</div>}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <textarea className="w-full bg-zinc-900 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 resize-none"
            rows={2} placeholder="Enter prompt to send to all models…" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1 self-end">
          <label className="text-[10px] uppercase tracking-wider text-zinc-600">Max tokens</label>
          <input
            type="number"
            min={64}
            step={512}
            value={maxTokensInput}
            onChange={(e) => setMaxTokensInput(e.target.value)}
            onBlur={() => {
              const n = parseInt(maxTokensInput);
              const clamped = Number.isFinite(n) && n >= 64 ? n : 4096;
              setMaxTokens(clamped);
              setMaxTokensInput(String(clamped));
            }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            disabled={running}
            className="w-24 bg-zinc-900 border border-white/[0.06] rounded-lg px-2 py-1.5 text-sm font-mono text-zinc-100 focus:outline-none focus:border-indigo-500/40"
          />
        </div>
        {running ? (
          <Button onClick={stopDiff} variant="destructive" className="gap-1.5 self-end" title="Abort the running diff">
            <X className="w-4 h-4" /> Stop
          </Button>
        ) : (
          <Button onClick={runDiff} disabled={selected.length < 2 || !prompt.trim()} variant="primary" className="gap-1.5 self-end">
            <Play className="w-4 h-4" /> Run
          </Button>
        )}
      </div>

      <div className={`flex-1 grid gap-3 p-4`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {(modelNames.length > 0 ? modelNames : selected.map((id) => models.find((m) => m.id === id)?.name ?? id)).map((name, i) => {
          const r = responses[i];
          return (
            <div key={i} className="flex flex-col rounded-2xl border border-white/[0.06] bg-zinc-900/40 overflow-hidden">
              <div className="px-3 py-2 border-b border-white/[0.04] flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span className="text-xs font-medium text-zinc-300 truncate">{name}</span>
                  {r?.status === "queued" && running && (
                    <span className="text-[10px] font-medium text-zinc-600 shrink-0">Queued</span>
                  )}
                  {r?.status === "loading" && (
                    <span className="flex items-center gap-1 text-[10px] font-medium text-amber-400 shrink-0">
                      <Loader2 className="w-3 h-3 animate-spin" />Loading
                    </span>
                  )}
                  {r?.status === "streaming" && (
                    <span className="flex items-center gap-1 text-[10px] font-medium text-indigo-400 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />Streaming
                    </span>
                  )}
                  {r?.status === "done" && (
                    <span className="text-[10px] font-medium text-emerald-400 shrink-0">✓ Done</span>
                  )}
                  {r?.status === "error" && (
                    <span className="text-[10px] font-medium text-red-400 shrink-0" title={r.error}>✗ Error</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {r?.tps && <span className="text-xs font-mono text-indigo-400">{r.tps} tok/s</span>}
                  {r?.text && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(r.text ?? "");
                        setCopiedIdx(i);
                        setTimeout(() => setCopiedIdx((v) => (v === i ? null : v)), 1200);
                      }}
                      title="Copy output"
                      className="text-zinc-500 hover:text-zinc-200 transition-colors"
                    >
                      {copiedIdx === i ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-3 text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
                {r?.status === "queued" && running ? (
                  <span className="text-zinc-600 italic">Waiting — previous model must finish first…</span>
                ) : r?.status === "loading" ? (
                  <span className="text-zinc-600 italic">Loading weights into oMLX…</span>
                ) : (
                  <>
                    {r?.text ?? ""}
                    {!r?.done && running && <span className="inline-block w-1.5 h-4 bg-indigo-400 animate-pulse ml-0.5" />}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
