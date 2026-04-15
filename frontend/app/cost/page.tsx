"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { DollarSign, Zap } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const BASE = "/api";

type CostModel = { model_name: string; requests: number; total_tokens: number; avg_tps: number | null; kwh: number; cost_usd: number; cost_per_million_tokens: number; tps_per_watt: number };
type CostData = { models: CostModel[]; totals: { tokens: number; cost_usd: number; kwh: number }; config: { watts: number; rate_per_kwh: number } };

export default function CostPage() {
  const [data, setData] = useState<CostData | null>(null);
  useEffect(() => { fetch(`${BASE}/cost/stats`).then((r) => r.json()).then(setData); }, []);

  if (!data) return <div className="p-8 text-zinc-500">Loading…</div>;

  const efficiencyData = data.models.filter((m) => m.tps_per_watt > 0)
    .sort((a, b) => b.tps_per_watt - a.tps_per_watt)
    .map((m) => ({ name: m.model_name.slice(0, 20), value: m.tps_per_watt }));

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <DollarSign className="w-6 h-6 text-emerald-400" />
        <h1 className="text-xl font-semibold text-zinc-100">Cost Calculator</h1>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4 text-center">
          <div className="text-3xl font-bold text-emerald-400 font-mono">{data.totals.tokens.toLocaleString()}</div>
          <div className="text-xs text-zinc-500 mt-1">Total Tokens</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4 text-center">
          <div className="text-3xl font-bold text-amber-400 font-mono">{data.totals.kwh}</div>
          <div className="text-xs text-zinc-500 mt-1">Total kWh</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4 text-center">
          <div className="text-3xl font-bold text-indigo-400 font-mono">${data.totals.cost_usd}</div>
          <div className="text-xs text-zinc-500 mt-1">Total Cost (est.)</div>
        </div>
      </div>

      {efficiencyData.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
          <h3 className="text-sm font-medium text-zinc-400 mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" /> Efficiency (tok/s per watt)
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={efficiencyData} layout="vertical">
              <XAxis type="number" tick={{ fill: "#a1a1aa", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fill: "#a1a1aa", fontSize: 11 }} width={150} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }} />
              <Bar dataKey="value" fill="#f59e0b" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-zinc-900/50 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-zinc-500 text-xs uppercase tracking-wider">
              <th className="px-4 py-3 text-left">Model</th>
              <th className="px-4 py-3 text-right">Tokens</th>
              <th className="px-4 py-3 text-right">tok/s</th>
              <th className="px-4 py-3 text-right">kWh</th>
              <th className="px-4 py-3 text-right">$/1M tokens</th>
              <th className="px-4 py-3 text-right">tok/s/W</th>
            </tr>
          </thead>
          <tbody>
            {data.models.map((m) => (
              <tr key={m.model_name} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-2.5 text-zinc-200">{m.model_name}</td>
                <td className="px-4 py-2.5 text-right font-mono text-zinc-400">{m.total_tokens.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right font-mono text-indigo-300">{m.avg_tps ?? "—"}</td>
                <td className="px-4 py-2.5 text-right font-mono text-zinc-400">{m.kwh}</td>
                <td className="px-4 py-2.5 text-right font-mono text-emerald-300">${m.cost_per_million_tokens}</td>
                <td className="px-4 py-2.5 text-right font-mono text-amber-300">{m.tps_per_watt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-600">
        Estimates based on {data.config.watts}W system draw at ${data.config.rate_per_kwh}/kWh.
      </p>
    </div>
  );
}
