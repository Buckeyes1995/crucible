"use client";

import { useEffect, useRef, useState } from "react";
import { api, readSSE, type ModelEntry } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GitCompare, Play, Loader2, X, Copy, Check } from "lucide-react";

type DiffStatus = "queued" | "streaming" | "done" | "error";

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
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Safety: clear any stuck "running" state left over from a prior stream that hung
  useEffect(() => {
    setRunning(false);
    setResponses({});
  }, []);

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

  // Sum of selected model sizes — approximates what oMLX will hold resident during a diff run
  const selectedBytes = selected.reduce((sum, id) => sum + (models.find((m) => m.id === id)?.size_bytes ?? 0), 0);
  const remainingBytes = Math.max(availableBytes - selectedBytes, 0);

  const wouldExceed = (m: ModelEntry): boolean => {
    if (selected.includes(m.id)) return false; // already in; toggle off always allowed
    const size = m.size_bytes ?? 0;
    return size > remainingBytes;
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

    await readSSE(resp, (data) => {
      const event = data.event as string;
      if (event === "start") {
        const names = data.models as string[];
        setModelNames(names);
        // Seed all slots as "queued" so status renders immediately for loading models
        setResponses(Object.fromEntries(names.map((n, i) => [i, { model: n, text: "", tps: null, done: false, status: "queued" as DiffStatus }])));
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
      } else if (event === "complete") setRunning(false);
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
        {selected.length > 0 && (
          <span className="text-xs text-zinc-600 ml-auto font-mono">
            Selected: <span className="text-zinc-300">{fmtGB(selectedBytes)}</span>
            {" · "}Free: <span className={cn(remainingBytes < 5e9 ? "text-amber-400" : "text-zinc-300")}>{fmtGB(remainingBytes)}</span> / {fmtGB(availableBytes)}
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
            ? `Too large — needs ${fmtGB(m.size_bytes ?? 0)}, only ${fmtGB(remainingBytes)} free after selection`
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
        <textarea className="flex-1 bg-zinc-900 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 resize-none"
          rows={2} placeholder="Enter prompt to send to all models…" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <div className="flex flex-col gap-1 self-end">
          <label className="text-[10px] uppercase tracking-wider text-zinc-600">Max tokens</label>
          <input
            type="number"
            min={64}
            step={512}
            value={maxTokens}
            onChange={(e) => setMaxTokens(Math.max(64, parseInt(e.target.value) || 4096))}
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
                  <span className="text-zinc-600 italic">Waiting for model to load…</span>
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
