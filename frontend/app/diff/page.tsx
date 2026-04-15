"use client";

import { useEffect, useRef, useState } from "react";
import { api, readSSE, type ModelEntry } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GitCompare, Play, Loader2 } from "lucide-react";

export default function DiffPage() {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [responses, setResponses] = useState<Record<number, { model: string; text: string; tps: number | null; done: boolean }>>({});
  const [modelNames, setModelNames] = useState<string[]>([]);

  useEffect(() => {
    api.models.list().then((all) => setModels(all.filter((m) => m.kind === "mlx" && m.node === "local" && !m.hidden)));
  }, []);

  const toggleModel = (id: string) => {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 6 ? [...prev, id] : prev);
  };

  async function runDiff() {
    if (selected.length < 2 || !prompt.trim()) return;
    setRunning(true);
    setResponses({});

    const resp = await fetch("/api/diff/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model_ids: selected, prompt: prompt.trim(), temperature: 0.7, max_tokens: 1024 }),
    });

    await readSSE(resp, (data) => {
      const event = data.event as string;
      if (event === "start") setModelNames(data.models as string[]);
      else if (event === "token") {
        const idx = data.index as number;
        setResponses((prev) => ({
          ...prev,
          [idx]: { ...prev[idx], text: (prev[idx]?.text ?? "") + (data.token as string), model: prev[idx]?.model ?? "", done: false },
        }));
      } else if (event === "done") {
        const idx = data.index as number;
        setResponses((prev) => ({
          ...prev,
          [idx]: { model: data.model as string, text: data.response as string, tps: data.tps as number | null, done: true },
        }));
      } else if (event === "complete") setRunning(false);
    });
    setRunning(false);
  }

  const cols = Math.min(selected.length || 2, 4);

  return (
    <div className="flex flex-col h-full min-h-screen">
      <div className="px-6 py-4 border-b border-white/[0.04] flex items-center gap-3">
        <GitCompare className="w-5 h-5 text-indigo-400" />
        <h1 className="text-lg font-semibold text-zinc-100">Model Diff</h1>
        <span className="text-xs text-zinc-500">{selected.length} selected</span>
      </div>

      <div className="px-6 py-3 border-b border-white/[0.04] flex gap-2 flex-wrap">
        {models.map((m) => (
          <button key={m.id} onClick={() => toggleModel(m.id)}
            className={cn("px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
              selected.includes(m.id) ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-400 hover:text-zinc-100")}>
            {m.name.slice(0, 30)}
          </button>
        ))}
      </div>

      <div className="px-6 py-3 border-b border-white/[0.04] flex gap-3">
        <textarea className="flex-1 bg-zinc-900 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 resize-none"
          rows={2} placeholder="Enter prompt to send to all models…" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <Button onClick={runDiff} disabled={running || selected.length < 2 || !prompt.trim()} variant="primary" className="gap-1.5 self-end">
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Run
        </Button>
      </div>

      <div className={`flex-1 grid gap-3 p-4`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {(modelNames.length > 0 ? modelNames : selected.map((id) => models.find((m) => m.id === id)?.name ?? id)).map((name, i) => {
          const r = responses[i];
          return (
            <div key={i} className="flex flex-col rounded-2xl border border-white/[0.06] bg-zinc-900/40 overflow-hidden">
              <div className="px-3 py-2 border-b border-white/[0.04] flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-300 truncate">{name}</span>
                {r?.tps && <span className="text-xs font-mono text-indigo-400">{r.tps} tok/s</span>}
              </div>
              <div className="flex-1 overflow-y-auto p-3 text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
                {r?.text ?? ""}
                {!r?.done && running && <span className="inline-block w-1.5 h-4 bg-indigo-400 animate-pulse ml-0.5" />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
