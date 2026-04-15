"use client";
import { useState } from "react";
import { readSSE } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ListOrdered, Play, Plus, Trash2, Loader2 } from "lucide-react";

type Result = { index: number; prompt: string; response: string; tps: number | null; tokens: number };

export default function BatchInferencePage() {
  const [prompts, setPrompts] = useState<string[]>(["", ""]);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Result[]>([]);

  const add = () => setPrompts([...prompts, ""]);
  const remove = (i: number) => prompts.length > 1 && setPrompts(prompts.filter((_, j) => j !== i));
  const update = (i: number, v: string) => { const p = [...prompts]; p[i] = v; setPrompts(p); };

  async function run() {
    const valid = prompts.filter((p) => p.trim());
    if (!valid.length) return;
    setRunning(true); setResults([]); setProgress(0);
    const resp = await fetch("/api/batch/run", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompts: valid, system_prompt: systemPrompt, temperature: 0.7, max_tokens: 1024 }) });
    const collected: Result[] = [];
    await readSSE(resp, (data) => {
      if (data.event === "progress") setProgress((data.index as number) + 1);
      else if (data.event === "result") { collected.push(data as unknown as Result); setResults([...collected]); }
    });
    setRunning(false);
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <ListOrdered className="w-6 h-6 text-indigo-400" />
        <h1 className="text-xl font-semibold text-zinc-100">Batch Inference</h1>
      </div>
      <input className="w-full bg-zinc-900 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
        placeholder="System prompt (optional)" value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} />
      <div className="space-y-2">
        {prompts.map((p, i) => (
          <div key={i} className="flex gap-2">
            <span className="w-6 text-xs font-mono text-zinc-600 pt-2">{i + 1}</span>
            <textarea className="flex-1 bg-zinc-900 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-zinc-100 resize-none" rows={2}
              value={p} onChange={(e) => update(i, e.target.value)} placeholder={`Prompt ${i + 1}…`} disabled={running} />
            <Button variant="ghost" className="px-2" onClick={() => remove(i)} disabled={prompts.length <= 1}><Trash2 className="w-3.5 h-3.5" /></Button>
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        <Button variant="ghost" onClick={add} className="gap-1.5 text-xs"><Plus className="w-3.5 h-3.5" /> Add</Button>
        <Button variant="primary" onClick={run} disabled={running} className="gap-1.5">
          {running ? <><Loader2 className="w-4 h-4 animate-spin" /> {progress}/{prompts.filter(p => p.trim()).length}</> : <><Play className="w-4 h-4" /> Run Batch</>}
        </Button>
      </div>
      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((r) => (
            <div key={r.index} className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4 space-y-2">
              <div className="flex justify-between text-xs"><span className="text-zinc-500">Prompt {r.index + 1}</span>
                <span className="font-mono text-indigo-300">{r.tps} tok/s · {r.tokens} tokens</span></div>
              <div className="text-xs text-zinc-400 truncate">{r.prompt}</div>
              <div className="text-sm text-zinc-300 whitespace-pre-wrap max-h-40 overflow-y-auto">{r.response}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
