"use client";

import { useState } from "react";
import { readSSE } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FlaskConical, Plus, Play, Loader2, Trash2, Trophy } from "lucide-react";

type Result = { tps: number | null; ttft_ms: number | null; output_tokens: number; total_ms: number; output_length: number; response_preview: string };

export default function OptimizerPage() {
  const [prompts, setPrompts] = useState<string[]>(["", ""]);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(-1);
  const [results, setResults] = useState<(Result | null)[]>([]);
  const [bestTps, setBestTps] = useState(-1);
  const [bestTtft, setBestTtft] = useState(-1);

  const addPrompt = () => prompts.length < 10 && setPrompts([...prompts, ""]);
  const removePrompt = (i: number) => prompts.length > 2 && setPrompts(prompts.filter((_, j) => j !== i));
  const updatePrompt = (i: number, v: string) => { const p = [...prompts]; p[i] = v; setPrompts(p); };

  async function run() {
    if (prompts.filter((p) => p.trim()).length < 2) return;
    setRunning(true);
    setResults([]);
    setBestTps(-1);
    setBestTtft(-1);
    setStep(0);

    const resp = await fetch("/api/optimizer/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompts: prompts.filter((p) => p.trim()), temperature: 0.7, max_tokens: 512 }),
    });

    const collected: (Result | null)[] = [];
    await readSSE(resp, (data) => {
      const event = data.event as string;
      if (event === "progress") setStep(data.index as number);
      else if (event === "result") {
        const r = data as unknown as Result;
        collected[data.index as number] = r;
        setResults([...collected]);
      } else if (event === "done") {
        setBestTps(data.best_tps_index as number);
        setBestTtft(data.best_ttft_index as number);
      }
    });
    setRunning(false);
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <FlaskConical className="w-6 h-6 text-indigo-400" />
        <h1 className="text-xl font-semibold text-zinc-100">Prompt Optimizer</h1>
      </div>

      <div className="space-y-3">
        {prompts.map((p, i) => (
          <div key={i} className="flex gap-2">
            <div className="w-8 flex items-center justify-center text-xs font-mono text-zinc-500">#{i + 1}</div>
            <textarea className="flex-1 bg-zinc-900 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-zinc-100 resize-none placeholder:text-zinc-600"
              rows={2} value={p} onChange={(e) => updatePrompt(i, e.target.value)}
              placeholder={`Prompt variation ${i + 1}…`} disabled={running} />
            {results[i] && (
              <div className={cn("w-32 flex flex-col items-end justify-center text-xs font-mono",
                bestTps === i ? "text-emerald-400" : "text-zinc-400")}>
                {bestTps === i && <Trophy className="w-3.5 h-3.5 text-amber-400 mb-0.5" />}
                <span>{results[i]?.tps ?? "—"} tok/s</span>
                <span className="text-zinc-600">{results[i]?.ttft_ms ?? "—"}ms TTFT</span>
              </div>
            )}
            <Button variant="ghost" className="px-2 text-zinc-600" onClick={() => removePrompt(i)} disabled={prompts.length <= 2}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <Button variant="ghost" onClick={addPrompt} disabled={prompts.length >= 10} className="gap-1.5 text-xs">
          <Plus className="w-3.5 h-3.5" /> Add Variation
        </Button>
        <Button variant="primary" onClick={run} disabled={running || prompts.filter((p) => p.trim()).length < 2} className="gap-1.5">
          {running ? <><Loader2 className="w-4 h-4 animate-spin" /> Testing {step + 1}/{prompts.length}…</> : <><Play className="w-4 h-4" /> Run</>}
        </Button>
      </div>

      {results.filter(Boolean).length > 0 && (
        <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.04] text-zinc-500 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-left w-10">#</th>
                <th className="px-4 py-3 text-right">tok/s</th>
                <th className="px-4 py-3 text-right">TTFT</th>
                <th className="px-4 py-3 text-right">Tokens</th>
                <th className="px-4 py-3 text-right">Total ms</th>
                <th className="px-4 py-3 text-left">Preview</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => r && (
                <tr key={i} className={cn("border-b border-white/[0.04]", bestTps === i && "bg-emerald-900/10")}>
                  <td className="px-4 py-2.5 font-mono text-zinc-500">{i + 1}{bestTps === i && " 🏆"}</td>
                  <td className={cn("px-4 py-2.5 text-right font-mono", bestTps === i ? "text-emerald-400 font-semibold" : "text-zinc-300")}>{r.tps ?? "—"}</td>
                  <td className={cn("px-4 py-2.5 text-right font-mono", bestTtft === i ? "text-cyan-400" : "text-zinc-400")}>{r.ttft_ms ?? "—"}ms</td>
                  <td className="px-4 py-2.5 text-right font-mono text-zinc-400">{r.output_tokens}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-zinc-500">{r.total_ms}</td>
                  <td className="px-4 py-2.5 text-zinc-500 text-xs truncate max-w-xs">{r.response_preview.slice(0, 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
