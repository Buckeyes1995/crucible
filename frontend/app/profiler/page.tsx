"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Timer, BarChart3, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from "recharts";

const BASE = "/api";

type Profile = {
  id: number;
  model_id: string;
  model_name: string;
  created_at: string;
  prompt_tokens: number | null;
  output_tokens: number | null;
  total_ms: number | null;
  ttft_ms: number | null;
  prefill_ms: number | null;
  decode_ms: number | null;
  tps: number | null;
  prompt_tps: number | null;
  memory_pressure_start: number | null;
  thermal_state: string | null;
  source: string;
};

type ModelStat = {
  model_id: string;
  model_name: string;
  request_count: number;
  avg_tps: number | null;
  max_tps: number | null;
  min_tps: number | null;
  avg_ttft_ms: number | null;
  avg_total_ms: number | null;
  avg_prefill_ms: number | null;
  avg_decode_ms: number | null;
  total_tokens: number | null;
  avg_memory: number | null;
};

export default function ProfilerPage() {
  const [stats, setStats] = useState<ModelStat[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${BASE}/profiler/stats`).then((r) => r.json()),
      fetch(`${BASE}/profiler/profiles?limit=50`).then((r) => r.json()),
    ]).then(([s, p]) => {
      setStats(s);
      setProfiles(p);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selectedModel) {
      fetch(`${BASE}/profiler/profiles?model_id=${encodeURIComponent(selectedModel)}&limit=50`)
        .then((r) => r.json())
        .then(setProfiles);
    }
  }, [selectedModel]);

  const tpsChartData = stats
    .filter((s) => s.avg_tps)
    .map((s) => ({ name: s.model_name.slice(0, 20), avg: s.avg_tps, max: s.max_tps, min: s.min_tps }));

  // Time breakdown for selected model or all
  const filtered = selectedModel ? profiles.filter((p) => p.model_id === selectedModel) : profiles;
  const avgPrefill = filtered.reduce((sum, p) => sum + (p.prefill_ms ?? 0), 0) / (filtered.length || 1);
  const avgDecode = filtered.reduce((sum, p) => sum + (p.decode_ms ?? 0), 0) / (filtered.length || 1);
  const pieData = [
    { name: "Prefill", value: Math.round(avgPrefill), fill: "#6366f1" },
    { name: "Decode", value: Math.round(avgDecode), fill: "#f59e0b" },
  ];

  if (loading) return (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto px-8 py-8 space-y-6 animate-fade-in">
      <PageHeader icon={<Timer className="w-5 h-5" />} title="Inference Profiler"
        description={`${profiles.length} requests profiled`} />

      {stats.length === 0 ? (
        <EmptyState icon={<Timer className="w-10 h-10" />} title="No profiler data yet"
          description="Use the Chat page to generate inference profiles. Every request is automatically recorded." />
      ) : (
        <>
          {/* Model filter */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setSelectedModel(null)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                !selectedModel ? "bg-indigo-500/15 text-indigo-300 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.2)]" : "bg-zinc-800/60 text-zinc-500 hover:text-zinc-200"
              )}
            >
              All models
            </button>
            {stats.map((s) => (
              <button
                key={s.model_id}
                onClick={() => setSelectedModel(s.model_id === selectedModel ? null : s.model_id)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  selectedModel === s.model_id ? "bg-indigo-500/15 text-indigo-300 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.2)]" : "bg-zinc-800/60 text-zinc-500 hover:text-zinc-200"
                )}
              >
                {s.model_name.slice(0, 25)} ({s.request_count})
              </button>
            ))}
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-2 gap-4">
            {/* Throughput chart */}
            <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4">
              <h3 className="text-sm font-medium text-zinc-400 mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4" /> Avg Throughput (tok/s)
              </h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={tpsChartData} layout="vertical">
                  <XAxis type="number" tick={{ fill: "#a1a1aa", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => Number(v).toFixed(1)} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "#a1a1aa", fontSize: 11 }} width={150} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }} formatter={(v) => typeof v === "number" ? v.toFixed(1) : String(v)} />
                  <Bar dataKey="avg" fill="#6366f1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Time breakdown pie */}
            <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4">
              <h3 className="text-sm font-medium text-zinc-400 mb-3">Avg Time Breakdown</h3>
              <div className="flex items-center justify-center gap-8">
                <ResponsiveContainer width={160} height={160}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2}>
                      {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2">
                  {pieData.map((d) => (
                    <div key={d.name} className="flex items-center gap-2 text-sm">
                      <div className="w-3 h-3 rounded" style={{ backgroundColor: d.fill }} />
                      <span className="text-zinc-400">{d.name}</span>
                      <span className="font-mono text-zinc-200">{d.value}ms</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Model stats table */}
          <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-zinc-500 text-xs uppercase tracking-wider">
                  <th className="px-4 py-3 text-left">Model</th>
                  <th className="px-4 py-3 text-right">Requests</th>
                  <th className="px-4 py-3 text-right">Avg tok/s</th>
                  <th className="px-4 py-3 text-right">Max tok/s</th>
                  <th className="px-4 py-3 text-right">Avg TTFT</th>
                  <th className="px-4 py-3 text-right">Avg Prefill</th>
                  <th className="px-4 py-3 text-right">Avg Decode</th>
                  <th className="px-4 py-3 text-right">Total Tokens</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr
                    key={s.model_id}
                    className={cn(
                      "border-b border-white/5 cursor-pointer transition-colors",
                      selectedModel === s.model_id ? "bg-indigo-900/20" : "hover:bg-white/5"
                    )}
                    onClick={() => setSelectedModel(s.model_id === selectedModel ? null : s.model_id)}
                  >
                    <td className="px-4 py-2.5 text-zinc-200 font-medium">{s.model_name}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-zinc-400">{s.request_count}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-indigo-300">{s.avg_tps != null ? s.avg_tps.toFixed(1) : "—"}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-zinc-300">{s.max_tps != null ? s.max_tps.toFixed(1) : "—"}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-zinc-400">{s.avg_ttft_ms ? `${s.avg_ttft_ms}ms` : "—"}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-zinc-400">{s.avg_prefill_ms ? `${s.avg_prefill_ms}ms` : "—"}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-zinc-400">{s.avg_decode_ms ? `${s.avg_decode_ms}ms` : "—"}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-zinc-500">{s.total_tokens?.toLocaleString() ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Recent profiles */}
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Recent Requests</h2>
            <div className="space-y-1">
              {filtered.slice(0, 20).map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2 rounded-lg bg-zinc-900/30 text-xs">
                  <span className="text-zinc-500 w-32 shrink-0 font-mono">
                    {new Date(p.created_at).toLocaleTimeString()}
                  </span>
                  <span className="text-zinc-300 w-48 truncate">{p.model_name}</span>
                  {/* Time breakdown bar */}
                  <div className="flex-1 flex items-center gap-1">
                    {p.prefill_ms != null && (
                      <div
                        className="h-3 rounded-sm bg-indigo-500/70"
                        style={{ width: `${Math.min((p.prefill_ms / (p.total_ms || 1)) * 100, 100)}%`, minWidth: 2 }}
                        title={`Prefill: ${p.prefill_ms}ms`}
                      />
                    )}
                    {p.decode_ms != null && (
                      <div
                        className="h-3 rounded-sm bg-amber-500/70"
                        style={{ width: `${Math.min((p.decode_ms / (p.total_ms || 1)) * 100, 100)}%`, minWidth: 2 }}
                        title={`Decode: ${p.decode_ms}ms`}
                      />
                    )}
                  </div>
                  <span className="font-mono text-indigo-300 w-20 text-right">{p.tps != null ? `${p.tps.toFixed(1)} t/s` : "—"}</span>
                  <span className="font-mono text-zinc-500 w-20 text-right">{p.total_ms ? `${Math.round(p.total_ms)}ms` : "—"}</span>
                  <span className="text-zinc-600 w-12">{p.source}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
