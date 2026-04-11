"use client";

import { Fragment, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMs, formatTps, cn } from "@/lib/utils";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { ChevronDown, ChevronRight } from "lucide-react";

type Metrics = {
  ttft_ms?: number;
  throughput_tps?: number;
  p50_tps?: number;
  p90_tps?: number;
  p99_tps?: number;
  total_ms?: number;
  output_tokens?: number;
  token_timestamps?: number[];
  thermal_state?: string;
};

type Result = {
  model_id: string;
  model_name: string;
  backend_kind: string;
  prompt_id: string;
  prompt_text: string;
  rep: number;
  metrics: Metrics;
  response_text?: string;
};

type RunDetail = {
  run_id: string;
  created_at: string;
  name?: string;
  config: Record<string, unknown>;
  summary: Record<string, unknown>;
  results: Result[];
};

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [view, setView] = useState<"charts" | "compare">("charts");

  useEffect(() => {
    api.benchmark.getrun(id)
      .then((d) => { setRun(d as RunDetail); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-6 text-zinc-500">Loading…</div>;
  if (!run) return <div className="p-6 text-red-400">Run not found.</div>;

  // Aggregate per model
  const modelMap: Record<string, { name: string; kind: string; tps: number[]; ttft: number[] }> = {};
  for (const r of run.results) {
    if (!modelMap[r.model_id]) {
      modelMap[r.model_id] = { name: r.model_name, kind: r.backend_kind, tps: [], ttft: [] };
    }
    if (r.metrics.throughput_tps) modelMap[r.model_id].tps.push(r.metrics.throughput_tps);
    if (r.metrics.ttft_ms) modelMap[r.model_id].ttft.push(r.metrics.ttft_ms);
  }

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const tpsData = Object.entries(modelMap).map(([mid, v]) => ({
    name: v.name.length > 28 ? v.name.slice(0, 28) + "…" : v.name,
    model_id: mid,
    kind: v.kind,
    tps: parseFloat(avg(v.tps).toFixed(2)),
    ttft: parseFloat(avg(v.ttft).toFixed(0)),
  }));

  const baselineTps = baseline ? tpsData.find((d) => d.model_id === baseline)?.tps : null;

  // Group results by prompt for compare view
  const promptGroups: Record<string, Result[]> = {};
  for (const r of run.results) {
    if (!promptGroups[r.prompt_id]) promptGroups[r.prompt_id] = [];
    promptGroups[r.prompt_id].push(r);
  }

  const modelIds = [...new Set(run.results.map((r) => r.model_id))];

  return (
    <div className="p-6 max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">
            {run.name || "Benchmark Results"}
          </h1>
          <p className="text-sm text-zinc-500 font-mono mt-1">
            {new Date(run.created_at).toLocaleString()} · {run.run_id.slice(0, 8)}
          </p>
          {run.summary.best_tps != null && (
            <p className="text-sm text-indigo-300 mt-1">
              Best: {formatTps(run.summary.best_tps as number)}
            </p>
          )}
        </div>

        {/* View toggle */}
        <div className="flex rounded-lg border border-white/10 overflow-hidden text-sm">
          {(["charts", "compare"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "px-4 py-2 font-medium capitalize transition-colors",
                view === v
                  ? "bg-indigo-600 text-white"
                  : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
              )}
            >
              {v === "compare" ? "Side by Side" : "Charts"}
            </button>
          ))}
        </div>
      </div>

      {/* ── CHARTS VIEW ── */}
      {view === "charts" && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Throughput chart */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Throughput (tok/s)</CardTitle>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">Baseline:</span>
                    <select
                      className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-300"
                      value={baseline ?? ""}
                      onChange={(e) => setBaseline(e.target.value || null)}
                    >
                      <option value="">None</option>
                      {tpsData.map((d) => (
                        <option key={d.model_id} value={d.model_id}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={Math.max(200, tpsData.length * 44)}>
                  <BarChart data={tpsData} layout="vertical" margin={{ left: 8, right: 48 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
                    <XAxis type="number" tick={{ fill: "#71717a", fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fill: "#a1a1aa", fontSize: 10 }} width={160} />
                    <Tooltip
                      contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }}
                      formatter={(val) => {
                        const num = Number(val);
                        if (baselineTps) {
                          const delta = ((num - baselineTps) / baselineTps * 100).toFixed(1);
                          const sign = Number(delta) >= 0 ? "+" : "";
                          return [`${num} tok/s (${sign}${delta}%)`, ""];
                        }
                        return [`${num} tok/s`, ""];
                      }}
                    />
                    <Bar dataKey="tps" radius={[0, 4, 4, 0]} fill="#6366f1"
                      label={{ position: "right", fill: "#a1a1aa", fontSize: 10, formatter: (v: unknown) => `${v}` }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* TTFT chart */}
            <Card>
              <CardHeader><CardTitle>Time to First Token (ms)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={Math.max(200, tpsData.length * 44)}>
                  <BarChart data={tpsData} layout="vertical" margin={{ left: 8, right: 48 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
                    <XAxis type="number" tick={{ fill: "#71717a", fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fill: "#a1a1aa", fontSize: 10 }} width={160} />
                    <Tooltip
                      contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }}
                      formatter={(v) => [`${v}ms`, "TTFT"]}
                    />
                    <Bar dataKey="ttft" fill="#f59e0b" radius={[0, 4, 4, 0]}
                      label={{ position: "right", fill: "#a1a1aa", fontSize: 10, formatter: (v: unknown) => `${v}ms` }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Results table */}
          <Card>
            <CardHeader><CardTitle>Results</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm text-zinc-300">
                <thead>
                  <tr className="border-b border-white/10 text-xs text-zinc-500">
                    {["Model", "Backend", "Prompt", "Rep", "TTFT", "tok/s", "p90 tok/s", "Tokens", "Thermal"].map((h) => (
                      <th key={h} className="text-left py-2 px-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {run.results.map((r, i) => (
                    <Fragment key={i}>
                      <tr
                        className="border-b border-white/5 hover:bg-zinc-800/30 font-mono text-xs cursor-pointer"
                        onClick={() => setExpandedRow(expandedRow === i ? null : i)}
                      >
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-1">
                            {expandedRow === i
                              ? <ChevronDown className="w-3 h-3 text-zinc-500 shrink-0" />
                              : <ChevronRight className="w-3 h-3 text-zinc-500 shrink-0" />}
                            <span className="max-w-36 truncate">{r.model_name}</span>
                          </div>
                        </td>
                        <td className="py-2 px-3">
                          <Badge variant={r.backend_kind as "mlx" | "gguf" | "ollama"}>{r.backend_kind}</Badge>
                        </td>
                        <td className="py-2 px-3 max-w-32 truncate text-zinc-500" title={r.prompt_text}>{r.prompt_id}</td>
                        <td className="py-2 px-3">{r.rep}</td>
                        <td className="py-2 px-3">{formatMs(r.metrics.ttft_ms)}</td>
                        <td className={cn("py-2 px-3 font-semibold", r.metrics.throughput_tps ? "text-indigo-300" : "text-zinc-600")}>
                          {formatTps(r.metrics.throughput_tps)}
                        </td>
                        <td className="py-2 px-3">{formatTps(r.metrics.p90_tps)}</td>
                        <td className="py-2 px-3">{r.metrics.output_tokens ?? "—"}</td>
                        <td className="py-2 px-3 capitalize text-zinc-500">{r.metrics.thermal_state ?? "—"}</td>
                      </tr>
                      {expandedRow === i && (
                        <tr className="border-b border-white/5 bg-zinc-950/60">
                          <td colSpan={9} className="px-4 py-3">
                            <div className="text-xs text-zinc-500 mb-1 font-sans">
                              <span className="font-medium text-zinc-400">Prompt:</span> {r.prompt_text}
                            </div>
                            <div className="text-xs font-medium text-zinc-400 mb-1.5 font-sans">Response:</div>
                            <pre className="text-xs text-zinc-300 font-mono whitespace-pre-wrap bg-zinc-900 rounded-lg p-3 max-h-64 overflow-y-auto border border-white/5">
                              {r.response_text || <span className="text-zinc-600 italic">No response captured</span>}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}

      {/* ── COMPARE VIEW ── */}
      {view === "compare" && (
        <div className="space-y-8">
          {Object.entries(promptGroups).map(([promptId, results]) => {
            const promptText = results[0].prompt_text;
            // Best tps across models for this prompt (for highlighting)
            const bestTps = Math.max(...results.map((r) => r.metrics.throughput_tps ?? 0));

            return (
              <div key={promptId}>
                {/* Prompt header */}
                <div className="mb-3">
                  <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Prompt</span>
                  <p className="mt-1 text-sm text-zinc-300 bg-zinc-900/60 border border-white/10 rounded-lg px-3 py-2">
                    {promptText}
                  </p>
                </div>

                {/* Model columns */}
                <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(results.length, 3)}, minmax(0, 1fr))` }}>
                  {results.map((r, i) => {
                    const isBest = r.metrics.throughput_tps === bestTps && bestTps > 0;
                    return (
                      <div
                        key={i}
                        className={cn(
                          "rounded-xl border bg-zinc-900/60 overflow-hidden",
                          isBest ? "border-indigo-500/50" : "border-white/10"
                        )}
                      >
                        {/* Model header */}
                        <div className={cn(
                          "px-3 py-2 flex items-center justify-between gap-2 border-b",
                          isBest ? "bg-indigo-950/40 border-indigo-500/30" : "bg-zinc-950/40 border-white/5"
                        )}>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-zinc-100 truncate" title={r.model_name}>
                              {r.model_name}
                            </div>
                            {isBest && (
                              <div className="text-xs text-indigo-400 font-medium">⚡ Fastest</div>
                            )}
                          </div>
                          <Badge variant={r.backend_kind as "mlx" | "gguf" | "ollama"}>
                            {r.backend_kind}
                          </Badge>
                        </div>

                        {/* Metrics strip */}
                        <div className="grid grid-cols-3 divide-x divide-white/5 border-b border-white/5">
                          <MetricCell label="tok/s" value={formatTps(r.metrics.throughput_tps)} highlight={isBest} />
                          <MetricCell label="TTFT" value={formatMs(r.metrics.ttft_ms)} />
                          <MetricCell label="Tokens" value={String(r.metrics.output_tokens ?? "—")} />
                        </div>

                        {/* Response text */}
                        <div className="p-3">
                          <pre className="text-xs text-zinc-300 font-mono whitespace-pre-wrap max-h-52 overflow-y-auto leading-relaxed">
                            {r.response_text
                              ? r.response_text
                              : <span className="text-zinc-600 italic">No response</span>
                            }
                          </pre>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MetricCell({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="px-3 py-2 text-center">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={cn("text-sm font-mono font-semibold", highlight ? "text-indigo-300" : "text-zinc-200")}>
        {value}
      </div>
    </div>
  );
}
