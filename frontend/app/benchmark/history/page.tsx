"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { formatTps, cn } from "@/lib/utils";
import { Trash2, ExternalLink, AlertTriangle, Trash } from "lucide-react";
import { toast } from "@/components/Toast";
import Link from "next/link";

type RunSummary = {
  run_id: string;
  created_at: string;
  name?: string;
  model_ids?: string[];
  prompt_count?: number;
  best_tps?: number;
  has_regression?: boolean;
};

export default function HistoryPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.benchmark.history() as RunSummary[];
      setRuns(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this benchmark run? This can't be undone.")) return;
    setDeleting(id);
    try {
      await api.benchmark.delete(id);
      setRuns((r) => r.filter((x) => x.run_id !== id));
    } catch (e) {
      toast(`Delete failed: ${(e as Error).message}`, "error");
    } finally {
      setDeleting(null);
    }
  };

  const [wiping, setWiping] = useState(false);
  const handleDeleteAll = async () => {
    if (runs.length === 0) return;
    if (!confirm(`Delete ALL ${runs.length} benchmark runs? This can't be undone.`)) return;
    setWiping(true);
    try {
      const r = await api.benchmark.deleteAll();
      setRuns([]);
      toast(`Removed ${r.count} runs`, "success");
    } catch (e) {
      toast(`Delete all failed: ${(e as Error).message}`, "error");
    } finally {
      setWiping(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-zinc-100">Benchmark History</h1>
        <div className="flex items-center gap-2">
          {runs.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleDeleteAll} disabled={wiping} className="gap-1.5 text-red-400 hover:text-red-300">
              <Trash className="w-3.5 h-3.5" /> {wiping ? "Deleting…" : "Delete all"}
            </Button>
          )}
          <Link href="/benchmark/new">
            <Button variant="primary" size="sm">+ New Run</Button>
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-zinc-900/60 rounded-lg animate-pulse border border-white/5" />
          ))}
        </div>
      ) : runs.length === 0 ? (
        <div className="text-center text-zinc-500 py-20">
          No benchmark runs yet. <Link href="/benchmark/new" className="text-indigo-400 hover:underline">Run one now →</Link>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-4 px-4 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wide">
            <span>Name / Date</span>
            <span>Models</span>
            <span>Prompts</span>
            <span>Best tok/s</span>
            <span />
            <span />
          </div>
          {runs.map((run) => (
            <Link
              key={run.run_id}
              href={`/benchmark/run/${run.run_id}`}
              className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-4 items-center px-4 py-3 rounded-lg border border-white/8 bg-zinc-900/40 hover:border-white/20 transition-all group"
            >
              <div>
                <div className="text-sm font-medium text-zinc-100">
                  {run.name || "Untitled run"}
                </div>
                <div className="text-xs text-zinc-500 font-mono">
                  {new Date(run.created_at).toLocaleString()}
                </div>
              </div>
              <span className="text-sm text-zinc-400">{run.model_ids?.length ?? "?"}</span>
              <span className="text-sm text-zinc-400">{run.prompt_count ?? "?"}</span>
              <span className={cn("text-sm font-mono", run.best_tps ? "text-indigo-300" : "text-zinc-600")}>
                {formatTps(run.best_tps)}
              </span>
              {run.has_regression ? (
                <span title="Performance regression detected (>10% drop vs. historical baseline)"
                      className="flex items-center gap-1 text-xs text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5" />
                </span>
              ) : <span />}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                <button
                  onClick={(e) => { e.preventDefault(); handleDelete(run.run_id); }}
                  disabled={deleting === run.run_id}
                  className="p-1 hover:text-red-400 text-zinc-600 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
