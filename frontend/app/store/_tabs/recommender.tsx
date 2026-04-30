"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { Sparkles, AlertTriangle, Info, Lightbulb, Trash2, Zap, Clock, RefreshCw, FlaskConical } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

const BASE = "/api";

type Recommendation = {
  type: string;
  model: string;
  model_id?: string;
  kind?: string;
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

export default function RecommenderTab() {
  const router = useRouter();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<Recommendation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetch(`${BASE}/recommender`)
      .then((r) => r.json())
      .then(setAnalysis)
      .finally(() => setLoading(false));
  }

  async function confirmDelete() {
    if (!pendingDelete?.model_id) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.models.deleteFromDisk(pendingDelete.model_id);
      setPendingDelete(null);
      load();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  function openBenchmark(rec: Recommendation) {
    if (!rec.model_id) return;
    router.push(`/benchmark?tab=run&models=${encodeURIComponent(rec.model_id)}`);
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
            const canAct = Boolean(rec.model_id);
            const deletable = canAct && (rec.kind === "mlx" || rec.kind === "gguf" || rec.kind === "vllm");
            return (
              <div key={i} className={cn("flex items-start gap-3 px-4 py-3 rounded-lg border", style.border, style.bg)}>
                {style.icon}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-zinc-200 truncate">{rec.model}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{rec.reason}</div>
                  <div className="text-xs text-indigo-400 mt-1">{rec.action}</div>
                  {canAct && (
                    <div className="flex gap-2 mt-2">
                      <Button
                        variant="ghost"
                        className="gap-1 text-xs h-7 px-2"
                        onClick={() => openBenchmark(rec)}
                      >
                        <FlaskConical className="w-3 h-3" /> Benchmark
                      </Button>
                      {deletable && (
                        <Button
                          variant="ghost"
                          className="gap-1 text-xs h-7 px-2 text-red-400 hover:text-red-300 hover:bg-red-900/20"
                          onClick={() => setPendingDelete(rec)}
                        >
                          <Trash2 className="w-3 h-3" /> Delete from disk
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 capitalize shrink-0">{rec.type}</span>
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

      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget && !deleting) setPendingDelete(null); }}
        >
          <div className="bg-zinc-900 border border-red-500/30 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center gap-2 mb-3">
              <Trash2 className="w-5 h-5 text-red-400" />
              <h2 className="text-base font-semibold text-zinc-100">Delete model from disk?</h2>
            </div>
            <p className="text-sm text-zinc-400">
              Permanently remove <span className="font-mono text-zinc-200">{pendingDelete.model}</span> from the filesystem?
              This cannot be undone. If the model is currently loaded, it will be unloaded first.
            </p>
            {deleteError && (
              <div className="mt-3 px-3 py-2 rounded bg-red-900/30 border border-red-500/30 text-red-300 text-xs">{deleteError}</div>
            )}
            <div className="flex justify-end gap-2 mt-5">
              <Button variant="secondary" size="sm" onClick={() => setPendingDelete(null)} disabled={deleting}>Cancel</Button>
              <Button
                variant="primary"
                size="sm"
                onClick={confirmDelete}
                disabled={deleting}
                className="bg-red-600 hover:bg-red-700"
              >
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
