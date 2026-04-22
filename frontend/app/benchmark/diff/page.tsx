"use client";

import { useEffect, useState, useMemo } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { GitCompare, ArrowRight } from "lucide-react";

type RunSummary = { run_id: string; created_at: string; name?: string | null };

type Cell = {
  model_id: string;
  model_name: string;
  prompt_id: string;
  a: { tps: number | null; ttft_ms: number | null };
  b: { tps: number | null; ttft_ms: number | null };
  delta_tps_pct: number | null;
  delta_ttft_pct: number | null;
};

type DiffResult = {
  a: { id: string; name?: string | null; created_at?: string };
  b: { id: string; name?: string | null; created_at?: string };
  cells: Cell[];
};

export default function BenchDiffPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [a, setA] = useState<string>("");
  const [b, setB] = useState<string>("");
  const [result, setResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/benchmark/history")
      .then((r) => r.json())
      .then((rows) => {
        setRuns(rows);
        if (rows.length >= 2) { setA(rows[1].run_id); setB(rows[0].run_id); }
      });
  }, []);

  const compare = async () => {
    if (!a || !b) return;
    setLoading(true);
    try {
      const resp = await fetch(`/api/benchmark/diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
      setResult(await resp.json());
    } finally {
      setLoading(false);
    }
  };

  const flatCells = useMemo(() => {
    if (!result) return [] as (Cell & { source: "A" | "B" | "A+B" })[];
    return result.cells.map((c) => {
      const inA = c.a.tps != null || c.a.ttft_ms != null;
      const inB = c.b.tps != null || c.b.ttft_ms != null;
      const source: "A" | "B" | "A+B" = inA && inB ? "A+B" : inA ? "A" : "B";
      return { ...c, source };
    })
    // Shared rows first so overlap is obvious, then A-only, then B-only
    .sort((x, y) => {
      const rank = { "A+B": 0, "A": 1, "B": 2 } as const;
      if (rank[x.source] !== rank[y.source]) return rank[x.source] - rank[y.source];
      if (x.model_name !== y.model_name) return (x.model_name || "").localeCompare(y.model_name || "");
      return (x.prompt_id || "").localeCompare(y.prompt_id || "");
    });
  }, [result]);

  const counts = useMemo(() => {
    const base = { A: 0, B: 0, "A+B": 0 };
    for (const c of flatCells) base[c.source] += 1;
    return base;
  }, [flatCells]);

  const deltaClass = (pct: number | null, higherIsBetter: boolean): string => {
    if (pct === null) return "text-zinc-500";
    const improved = higherIsBetter ? pct > 2 : pct < -2;
    const regressed = higherIsBetter ? pct < -2 : pct > 2;
    if (improved) return "text-emerald-400";
    if (regressed) return "text-red-400";
    return "text-zinc-400";
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-white/[0.04]">
        <PageHeader
          icon={<GitCompare className="w-5 h-5" />}
          title="Benchmark Diff"
          description="Side-by-side comparison of two benchmark runs, with per-cell deltas."
        />
        <div className="mt-3 flex items-center gap-2 text-sm">
          <select
            value={a}
            onChange={(e) => setA(e.target.value)}
            className="bg-zinc-900 border border-white/10 rounded px-2 py-1 text-zinc-200 max-w-[260px] truncate"
          >
            <option value="" disabled>Baseline run…</option>
            {runs.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                {(r.name || r.run_id.slice(0, 8)) + " · " + new Date(r.created_at).toLocaleDateString()}
              </option>
            ))}
          </select>
          <ArrowRight className="w-4 h-4 text-zinc-500" />
          <select
            value={b}
            onChange={(e) => setB(e.target.value)}
            className="bg-zinc-900 border border-white/10 rounded px-2 py-1 text-zinc-200 max-w-[260px] truncate"
          >
            <option value="" disabled>Compare run…</option>
            {runs.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                {(r.name || r.run_id.slice(0, 8)) + " · " + new Date(r.created_at).toLocaleDateString()}
              </option>
            ))}
          </select>
          <button
            onClick={compare}
            disabled={!a || !b || a === b || loading}
            className="ml-2 px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs disabled:opacity-40"
          >
            {loading ? "Comparing…" : "Compare"}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        {!result ? (
          <p className="text-zinc-500 text-sm">Pick two runs and click Compare.</p>
        ) : flatCells.length === 0 ? (
          <p className="text-zinc-500 text-sm">No cells in either run.</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-2 text-[11px] text-zinc-400">
              <span className="px-2 py-0.5 rounded bg-emerald-900/25 border border-emerald-500/30 text-emerald-300">
                {counts["A+B"]} shared
              </span>
              <span className="px-2 py-0.5 rounded bg-blue-900/25 border border-blue-500/30 text-blue-300">
                {counts.A} A-only
              </span>
              <span className="px-2 py-0.5 rounded bg-purple-900/25 border border-purple-500/30 text-purple-300">
                {counts.B} B-only
              </span>
              {counts["A+B"] === 0 && (
                <span className="text-amber-400">
                  No shared (model, prompt) pairs — nothing to diff. Pick runs that overlap for Δ columns.
                </span>
              )}
            </div>

            <div className="rounded-lg border border-white/10 bg-zinc-950 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="text-zinc-500 bg-black/30">
                  <tr>
                    <th className="text-left px-3 py-1.5 w-14">Src</th>
                    <th className="text-left px-3 py-1.5">Model</th>
                    <th className="text-left px-3 py-1.5">Prompt</th>
                    <th className="text-right px-3 py-1.5">A tok/s</th>
                    <th className="text-right px-3 py-1.5">B tok/s</th>
                    <th className="text-right px-3 py-1.5">Δ tok/s</th>
                    <th className="text-right px-3 py-1.5">A ttft</th>
                    <th className="text-right px-3 py-1.5">B ttft</th>
                    <th className="text-right px-3 py-1.5">Δ ttft</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {flatCells.map((c, i) => {
                    const rowBg =
                      c.source === "A+B"
                        ? "bg-emerald-950/10"
                        : c.source === "A"
                          ? "bg-blue-950/10"
                          : "bg-purple-950/10";
                    const pillCls =
                      c.source === "A+B"
                        ? "bg-emerald-900/30 text-emerald-300 border-emerald-500/30"
                        : c.source === "A"
                          ? "bg-blue-900/30 text-blue-300 border-blue-500/30"
                          : "bg-purple-900/30 text-purple-300 border-purple-500/30";
                    return (
                      <tr key={i} className={"border-t border-white/[0.04] " + rowBg}>
                        <td className="px-3 py-1.5">
                          <span className={"inline-block text-[10px] px-1.5 py-0.5 rounded border font-sans " + pillCls}>
                            {c.source}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-zinc-300 truncate max-w-[260px]" title={c.model_id}>
                          {c.model_name || c.model_id}
                        </td>
                        <td className="px-3 py-1.5 text-zinc-400">{c.prompt_id}</td>
                        <td className="px-3 py-1.5 text-right text-zinc-300">{c.a.tps?.toFixed(1) ?? "—"}</td>
                        <td className="px-3 py-1.5 text-right text-zinc-300">{c.b.tps?.toFixed(1) ?? "—"}</td>
                        <td className={"px-3 py-1.5 text-right " + deltaClass(c.delta_tps_pct, true)}>
                          {c.delta_tps_pct === null ? "—" : (c.delta_tps_pct > 0 ? "+" : "") + c.delta_tps_pct + "%"}
                        </td>
                        <td className="px-3 py-1.5 text-right text-zinc-300">{c.a.ttft_ms?.toFixed(0) ?? "—"}</td>
                        <td className="px-3 py-1.5 text-right text-zinc-300">{c.b.ttft_ms?.toFixed(0) ?? "—"}</td>
                        <td className={"px-3 py-1.5 text-right " + deltaClass(c.delta_ttft_pct, false)}>
                          {c.delta_ttft_pct === null ? "—" : (c.delta_ttft_pct > 0 ? "+" : "") + c.delta_ttft_pct + "%"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
