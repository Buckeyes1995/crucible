"use client";
import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { Hash } from "lucide-react";

type DailyData = { date: string; tokens: number; requests: number };
type ModelData = { model: string; tokens: number; requests: number; avg_tps: number | null };

export default function TokenAnalyticsPage() {
  const [daily, setDaily] = useState<DailyData[]>([]);
  const [byModel, setByModel] = useState<ModelData[]>([]);
  useEffect(() => {
    fetch("/api/analytics/tokens").then(r => r.json()).then(d => { setDaily(d.daily); setByModel(d.by_model); });
  }, []);

  const totalTokens = byModel.reduce((s, m) => s + m.tokens, 0);

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Hash className="w-6 h-6 text-indigo-400" />
        <h1 className="text-xl font-semibold text-zinc-100">Token Analytics</h1>
        <span className="text-xs text-zinc-500">{totalTokens.toLocaleString()} total tokens</span>
      </div>

      {daily.length > 0 && (
        <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4">
          <h3 className="text-sm font-medium text-zinc-400 mb-3">Daily Token Generation</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={daily}>
              <XAxis dataKey="date" tick={{ fill: "#a1a1aa", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#a1a1aa", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }} />
              <Line type="monotone" dataKey="tokens" stroke="#6366f1" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {byModel.length > 0 && (
        <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4">
          <h3 className="text-sm font-medium text-zinc-400 mb-3">Tokens by Model</h3>
          <ResponsiveContainer width="100%" height={Math.max(200, byModel.length * 30)}>
            <BarChart data={byModel.map(m => ({...m, model: m.model.slice(0,25)}))} layout="vertical">
              <XAxis type="number" tick={{ fill: "#a1a1aa", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="model" tick={{ fill: "#a1a1aa", fontSize: 10 }} width={180} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }} />
              <Bar dataKey="tokens" fill="#6366f1" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {daily.length === 0 && <div className="text-center py-16 text-zinc-500">No token data yet. Use Chat to generate tokens.</div>}
    </div>
  );
}
