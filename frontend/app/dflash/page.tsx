"use client";

import { useEffect, useState } from "react";
import { api, readSSE, type ModelEntry } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Bolt, Play, Loader2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

type BenchResult = {
  tps: number | null;
  ttft_ms: number | null;
  output_tokens: number;
  total_ms: number;
};

type BenchSummary = {
  model: string;
  prompts_count: number;
  normal: { avg_tps: number; avg_ttft_ms: number; results: BenchResult[] };
  dflash: { avg_tps: number; avg_ttft_ms: number; results: BenchResult[] };
  speedup: number;
};

export default function DFlashBenchPage() {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string>("");
  const [step, setStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);
  const [summary, setSummary] = useState<BenchSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveResults, setLiveResults] = useState<{ normal: BenchResult[]; dflash: BenchResult[] }>({ normal: [], dflash: [] });

  useEffect(() => {
    api.models.list().then((all) => {
      const eligible = all.filter((m) => m.dflash_draft);
      setModels(eligible);
      if (eligible.length > 0) setSelectedModel(eligible[0].id);
    });
  }, []);

  async function runBenchmark() {
    if (!selectedModel) return;
    setRunning(true);
    setError(null);
    setSummary(null);
    setStep(0);
    setLiveResults({ normal: [], dflash: [] });

    try {
      const resp = await fetch("/api/dflash/benchmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: selectedModel, max_tokens: 512, temperature: 0.7 }),
      });
      await readSSE(resp, (data) => {
        const event = data.event as string;
        if (event === "start") {
          setTotalSteps(data.total_steps as number);
        } else if (event === "phase") {
          setPhase(data.phase as string);
        } else if (event === "progress") {
          setStep(data.step as number);
        } else if (event === "result") {
          const r = { tps: data.tps, ttft_ms: data.ttft_ms, output_tokens: data.output_tokens, total_ms: data.total_ms } as BenchResult;
          const ph = data.phase as string;
          setLiveResults((prev) => ({
            ...prev,
            [ph === "dflash" ? "dflash" : "normal"]: [
              ...(ph === "dflash" ? prev.dflash : prev.normal),
              r,
            ],
          }));
        } else if (event === "done") {
          setSummary(data as unknown as BenchSummary);
        } else if (event === "error") {
          setError(data.message as string);
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Benchmark failed");
    } finally {
      setRunning(false);
      setPhase("");
    }
  }

  const chartData = summary
    ? [
        { name: "Normal", tps: summary.normal.avg_tps, fill: "#6366f1" },
        { name: "DFlash", tps: summary.dflash.avg_tps, fill: "#f59e0b" },
      ]
    : [];

  const ttftData = summary
    ? [
        { name: "Normal", ttft: summary.normal.avg_ttft_ms, fill: "#6366f1" },
        { name: "DFlash", ttft: summary.dflash.avg_ttft_ms, fill: "#f59e0b" },
      ]
    : [];

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Bolt className="w-6 h-6 text-amber-400" />
        <h1 className="text-xl font-semibold text-zinc-100">DFlash Benchmark</h1>
        <span className="text-xs text-zinc-500">Compare speculative decoding speed</span>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4 p-4 rounded-2xl border border-white/[0.06] bg-zinc-900/40 backdrop-blur">
        <select
          className="flex-1 bg-zinc-800 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-zinc-200"
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          disabled={running}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <Button onClick={runBenchmark} disabled={running || !selectedModel} variant="primary" className="gap-2 min-w-[160px]">
          {running ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> {phase === "dflash" ? "DFlash…" : "Normal…"}</>
          ) : (
            <><Play className="w-4 h-4" /> Run Benchmark</>
          )}
        </Button>
      </div>

      {/* Progress */}
      {running && totalSteps > 0 && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-zinc-500">
            <span>{phase === "dflash" ? "⚡ DFlash mode" : "📊 Normal mode"}</span>
            <span>{step}/{totalSteps}</span>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all"
              style={{ width: `${(step / totalSteps) * 100}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="px-3 py-2 rounded bg-red-900/30 border border-red-500/30 text-red-300 text-sm">{error}</div>
      )}

      {/* Results */}
      {summary && (
        <div className="space-y-6">
          {/* Speedup hero */}
          <div className="text-center py-6 rounded-xl border border-amber-500/20 bg-amber-900/10">
            <div className="text-5xl font-bold text-amber-400 font-mono">{summary.speedup}x</div>
            <div className="text-sm text-zinc-400 mt-1">DFlash speedup on {summary.model}</div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4">
              <h3 className="text-sm font-medium text-zinc-400 mb-3">Throughput (tok/s)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData}>
                  <XAxis dataKey="name" tick={{ fill: "#a1a1aa", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#a1a1aa", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }} />
                  <Bar dataKey="tps" radius={[6, 6, 0, 0]}>
                    {chartData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4">
              <h3 className="text-sm font-medium text-zinc-400 mb-3">Time to First Token (ms)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={ttftData}>
                  <XAxis dataKey="name" tick={{ fill: "#a1a1aa", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#a1a1aa", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }} />
                  <Bar dataKey="ttft" radius={[6, 6, 0, 0]}>
                    {ttftData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Per-prompt table */}
          <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.04] text-zinc-500 text-xs uppercase tracking-wider">
                  <th className="px-4 py-3 text-left">Prompt</th>
                  <th className="px-4 py-3 text-right">Normal tok/s</th>
                  <th className="px-4 py-3 text-right">DFlash tok/s</th>
                  <th className="px-4 py-3 text-right">Speedup</th>
                </tr>
              </thead>
              <tbody>
                {summary.normal.results.map((nr, i) => {
                  const dr = summary.dflash.results[i];
                  const sp = nr.tps && dr?.tps ? (dr.tps / nr.tps).toFixed(2) : "—";
                  return (
                    <tr key={i} className="border-b border-white/[0.04]">
                      <td className="px-4 py-2.5 text-zinc-400">Prompt {i + 1}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-indigo-300">{nr.tps ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-amber-300">{dr?.tps ?? "—"}</td>
                      <td className={cn("px-4 py-2.5 text-right font-mono font-semibold", sp !== "—" && parseFloat(sp) > 1 ? "text-green-400" : "text-zinc-400")}>
                        {sp}x
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!summary && !running && models.length === 0 && (
        <div className="text-center py-16 text-zinc-500">
          No DFlash-eligible models found. DFlash requires a matching *-DFlash draft model directory.
        </div>
      )}
    </div>
  );
}
