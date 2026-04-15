"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sparkles, AlertTriangle, Info, Lightbulb, Trash2, Zap, Clock, RefreshCw } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

const BASE = "/api";

type Recommendation = {
  type: string;
  model: string;
  reason: string;
  action: string;
  priority: number;
};

type Insight = {
  type: string;
  title: string;
  detail: string;
};

type Analysis = {
  model_count: number;
  total_size_gb: number;
  total_ram_gb: number;
  insights: Insight[];
  recommendations: Recommendation[];
  size_tiers: { small: number; medium: number; large: number; xlarge: number };
};

const TYPE_STYLES: Record<string, { icon: React.ReactNode; border: string; bg: string }> = {
  redundant: { icon: <Trash2 className="w-4 h-4 text-amber-400" />, border: "border-amber-500/30", bg: "bg-amber-900/10" },
  unused: { icon: <Clock className="w-4 h-4 text-zinc-400" />, border: "border-zinc-500/30", bg: "bg-zinc-800/30" },
  slow: { icon: <Zap className="w-4 h-4 text-red-400" />, border: "border-red-500/30", bg: "bg-red-900/10" },
};

const INSIGHT_ICONS: Record<string, React.ReactNode> = {
  info: <Info className="w-4 h-4 text-indigo-400" />,
  warning: <AlertTriangle className="w-4 h-4 text-amber-400" />,
  tip: <Lightbulb className="w-4 h-4 text-emerald-400" />,
};

const PIE_COLORS = ["#6366f1", "#f59e0b", "#ef4444", "#8b5cf6"];

export default function RecommenderPage() {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    fetch(`${BASE}/recommender`)
      .then((r) => r.json())
      .then(setAnalysis)
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  if (loading) return <div className="p-8 text-zinc-500">Analyzing your model library…</div>;
  if (!analysis) return <div className="p-8 text-zinc-500">Failed to load analysis</div>;

  const tierData = [
    { name: "Small (<10GB)", value: analysis.size_tiers.small },
    { name: "Medium (10-30GB)", value: analysis.size_tiers.medium },
    { name: "Large (30-60GB)", value: analysis.size_tiers.large },
    { name: "XL (>60GB)", value: analysis.size_tiers.xlarge },
  ].filter((d) => d.value > 0);

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Sparkles className="w-6 h-6 text-indigo-400" />
          <h1 className="text-xl font-semibold text-zinc-100">Model Recommender</h1>
        </div>
        <Button onClick={load} variant="ghost" className="gap-1.5 text-xs">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4 text-center">
          <div className="text-3xl font-bold text-indigo-400 font-mono">{analysis.model_count}</div>
          <div className="text-xs text-zinc-500 mt-1">Models</div>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4 text-center">
          <div className="text-3xl font-bold text-amber-400 font-mono">{analysis.total_size_gb}</div>
          <div className="text-xs text-zinc-500 mt-1">Total GB</div>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4 text-center">
          <div className="text-3xl font-bold text-emerald-400 font-mono">{analysis.total_ram_gb.toFixed(0)}</div>
          <div className="text-xs text-zinc-500 mt-1">RAM (GB)</div>
        </div>
      </div>

      {/* Size distribution */}
      <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4 flex items-center gap-8">
        <div className="flex-1">
          <h3 className="text-sm font-medium text-zinc-400 mb-2">Size Distribution</h3>
          <div className="space-y-1">
            {tierData.map((d, i) => (
              <div key={d.name} className="flex items-center gap-2 text-sm">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: PIE_COLORS[i] }} />
                <span className="text-zinc-400">{d.name}</span>
                <span className="font-mono text-zinc-200">{d.value}</span>
              </div>
            ))}
          </div>
        </div>
        <ResponsiveContainer width={120} height={120}>
          <PieChart>
            <Pie data={tierData} dataKey="value" cx="50%" cy="50%" innerRadius={30} outerRadius={55} paddingAngle={3}>
              {tierData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
            </Pie>
            <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Insights */}
      {analysis.insights.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Insights</h2>
          {analysis.insights.map((ins, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3 rounded-lg border border-white/[0.06] bg-zinc-900/30">
              {INSIGHT_ICONS[ins.type] ?? INSIGHT_ICONS.info}
              <div>
                <div className="text-sm font-medium text-zinc-200">{ins.title}</div>
                <div className="text-xs text-zinc-500 mt-0.5">{ins.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recommendations */}
      {analysis.recommendations.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
            Recommendations ({analysis.recommendations.length})
          </h2>
          {analysis.recommendations.map((rec, i) => {
            const style = TYPE_STYLES[rec.type] ?? TYPE_STYLES.unused;
            return (
              <div key={i} className={cn("flex items-start gap-3 px-4 py-3 rounded-lg border", style.border, style.bg)}>
                {style.icon}
                <div className="flex-1">
                  <div className="text-sm font-medium text-zinc-200">{rec.model}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{rec.reason}</div>
                  <div className="text-xs text-indigo-400 mt-1">{rec.action}</div>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 capitalize">{rec.type}</span>
              </div>
            );
          })}
        </div>
      )}

      {analysis.recommendations.length === 0 && (
        <div className="text-center py-8 text-zinc-500">
          Your model library looks great! No recommendations at this time.
        </div>
      )}
    </div>
  );
}
