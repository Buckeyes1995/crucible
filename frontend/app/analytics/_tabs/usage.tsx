"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { DollarSign, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid } from "recharts";

type UsageSummary = {
  days: number;
  totals: { tokens_in: number; tokens_out: number; requests: number };
  per_day: { date: string; tokens_in: number; tokens_out: number; requests: number }[];
  per_key: Record<string, { tokens_in: number; tokens_out: number; requests: number }>;
};

export default function UsageTab() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [days, setDays] = useState(30);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/usage?days=${days}`);
      setSummary(await r.json());
    } catch {}
  }, [days]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col h-full min-h-screen">
      <div className="px-6 py-4 border-b border-white/[0.04]">
        <PageHeader
          icon={<DollarSign className="w-5 h-5" />}
          title="Usage"
          description="Per-day token counts across /v1 proxy clients"
        >
          <select value={days} onChange={(e) => setDays(parseInt(e.target.value))}
            className="bg-zinc-900 border border-white/[0.08] rounded px-2 py-1 text-xs text-zinc-200">
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <Button size="sm" variant="ghost" onClick={load} className="gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> Refresh</Button>
        </PageHeader>
      </div>

      {!summary ? (
        <div className="p-6 text-zinc-500 text-sm">Loading…</div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <div className="grid grid-cols-3 gap-3">
            <Tile label="Requests" value={summary.totals.requests.toLocaleString()} />
            <Tile label="Tokens in" value={summary.totals.tokens_in.toLocaleString()} />
            <Tile label="Tokens out" value={summary.totals.tokens_out.toLocaleString()} />
          </div>

          <section className="rounded-xl border border-white/[0.06] bg-zinc-900/40 p-4">
            <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Daily throughput</h3>
            <div style={{ width: "100%", height: 220 }}>
              <ResponsiveContainer>
                <LineChart data={summary.per_day}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#a1a1aa" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#a1a1aa" }} />
                  <RTooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid rgba(255,255,255,0.1)" }} />
                  <Line type="monotone" dataKey="tokens_out" stroke="#6366f1" strokeWidth={2} dot={false} name="tokens out" />
                  <Line type="monotone" dataKey="requests" stroke="#10b981" strokeWidth={1.5} dot={false} name="requests" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section>
            <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Per-caller ({Object.keys(summary.per_key).length})</h3>
            <div className="rounded-xl border border-white/[0.06] overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto_auto] bg-zinc-900/60 text-xs text-zinc-500 px-3 py-2">
                <span>Key tag</span>
                <span className="w-24 text-right">Requests</span>
                <span className="w-32 text-right">Tokens in</span>
                <span className="w-32 text-right">Tokens out</span>
              </div>
              <div className="divide-y divide-white/[0.04]">
                {Object.entries(summary.per_key).sort(([, a], [, b]) => b.tokens_out - a.tokens_out).map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[1fr_auto_auto_auto] px-3 py-1.5 text-xs">
                    <span className="font-mono text-zinc-300">{k}</span>
                    <span className="w-24 text-right font-mono text-zinc-400">{v.requests}</span>
                    <span className="w-32 text-right font-mono text-zinc-400">{v.tokens_in.toLocaleString()}</span>
                    <span className="w-32 text-right font-mono text-indigo-300">{v.tokens_out.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-zinc-900/40 p-4">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-xl font-mono font-semibold text-zinc-100 mt-1">{value}</div>
    </div>
  );
}
