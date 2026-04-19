"use client";

// Disk reclaim — shows local models sorted by idleness, lets you bulk-delete
// the ones you haven't used in a while. Never-loaded models float to the top
// so you can decide if they're worth keeping.

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { formatBytes, cn } from "@/lib/utils";
import { HardDrive, AlertTriangle, Check, Trash } from "lucide-react";
import { toast } from "@/components/Toast";

type Row = Awaited<ReturnType<typeof api.disk.summary>>["models"][number];
type Summary = Awaited<ReturnType<typeof api.disk.summary>>;

export default function DiskPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [threshold, setThreshold] = useState<number>(30);
  const [working, setWorking] = useState(false);

  const load = useCallback(() => {
    api.disk.summary().then(setSummary).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const suggested = useMemo<Row[]>(() => {
    if (!summary) return [];
    return summary.models.filter(m => m.never_loaded || (m.days_since_loaded ?? 0) >= threshold);
  }, [summary, threshold]);

  const potentialFree = useMemo(
    () => suggested.filter(m => selected.has(m.id)).reduce((a, m) => a + m.size_bytes, 0),
    [suggested, selected],
  );

  const selectAllSuggested = () => setSelected(new Set(suggested.map(m => m.id)));
  const clearSelection = () => setSelected(new Set());

  const reclaim = async () => {
    if (selected.size === 0) return;
    if (!confirm(
      `Delete ${selected.size} model${selected.size === 1 ? "" : "s"} from disk? ` +
      `This will free approximately ${formatBytes(potentialFree)}. Cannot be undone.`,
    )) return;
    setWorking(true);
    try {
      const r = await api.disk.reclaim([...selected]);
      const ok = r.results.filter(x => x.ok).length;
      const bad = r.results.length - ok;
      toast(
        bad === 0
          ? `Freed ${formatBytes(r.bytes_freed_total)} across ${ok} model${ok === 1 ? "" : "s"}`
          : `Freed ${formatBytes(r.bytes_freed_total)} · ${bad} failed`,
        bad === 0 ? "success" : "error",
      );
      clearSelection();
      load();
    } catch (e) {
      toast(`Reclaim failed: ${(e as Error).message}`, "error");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-screen">
      <div className="px-6 py-4 border-b border-white/[0.04] flex items-center gap-3">
        <HardDrive className="w-5 h-5 text-indigo-400" />
        <h1 className="text-lg font-semibold text-zinc-100">Disk usage</h1>
        {summary?.volume && (
          <span className="text-xs text-zinc-500 font-mono ml-auto">
            {formatBytes(summary.volume.free_bytes)} free on {summary.volume.path}
          </span>
        )}
      </div>

      {!summary ? (
        <div className="p-6 text-sm text-zinc-500 animate-pulse">Loading…</div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
          {/* Kind breakdown */}
          <div className="flex flex-wrap gap-2">
            {Object.entries(summary.by_kind).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-white/[0.06] bg-zinc-900/40 px-3 py-2 text-xs font-mono">
                <span className="text-zinc-500 uppercase tracking-wide">{k}</span>
                <span className="ml-2 text-zinc-100 font-semibold">{formatBytes(v)}</span>
              </div>
            ))}
            <div className="rounded-lg border border-indigo-500/30 bg-indigo-950/20 px-3 py-2 text-xs font-mono">
              <span className="text-indigo-300 uppercase tracking-wide">total</span>
              <span className="ml-2 text-indigo-100 font-semibold">{formatBytes(summary.total_bytes_used_by_models)}</span>
            </div>
          </div>

          {/* Threshold + bulk actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-xs text-zinc-500">
              Suggest models idle for at least
              <input
                type="number" min={1} max={365} value={threshold}
                onChange={(e) => setThreshold(Math.max(1, Number(e.target.value) || 30))}
                className="mx-2 w-16 rounded border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 font-mono"
              />
              days
            </label>
            <span className="text-xs text-zinc-500">
              {suggested.length} candidate{suggested.length === 1 ? "" : "s"}
            </span>
            <button
              onClick={selectAllSuggested}
              disabled={suggested.length === 0}
              className="ml-auto text-xs text-indigo-400 hover:text-indigo-300 disabled:text-zinc-700"
            >
              Select all candidates
            </button>
            <button
              onClick={reclaim}
              disabled={working || selected.size === 0}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                selected.size === 0
                  ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                  : "bg-red-900/40 border border-red-500/40 text-red-200 hover:bg-red-900/60",
              )}
            >
              <Trash className="w-3.5 h-3.5" />
              {working
                ? "Deleting…"
                : selected.size > 0
                  ? `Reclaim ${formatBytes(potentialFree)} (${selected.size})`
                  : "Nothing selected"}
            </button>
          </div>

          {/* Table */}
          <div className="rounded-xl border border-white/[0.06] overflow-hidden">
            <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 px-4 py-2 text-[10px] uppercase tracking-wider text-zinc-500 border-b border-white/[0.04]">
              <span></span>
              <span>Model</span>
              <span className="text-right">Size</span>
              <span className="text-right">Last loaded</span>
              <span className="text-right">Kind</span>
            </div>
            {summary.models.length === 0 ? (
              <div className="px-4 py-8 text-xs text-zinc-500 text-center">No local models.</div>
            ) : (
              summary.models.map(m => {
                const sel = selected.has(m.id);
                const candidate = m.never_loaded || (m.days_since_loaded ?? 0) >= threshold;
                return (
                  <button
                    key={m.id}
                    onClick={() => toggle(m.id)}
                    className={cn(
                      "grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 px-4 py-2 items-center border-b border-white/[0.03] text-left transition-colors w-full",
                      sel ? "bg-red-950/25" : candidate ? "bg-amber-950/10" : "bg-zinc-900/20 hover:bg-zinc-900/40",
                    )}
                  >
                    <div className={cn(
                      "w-4 h-4 rounded border shrink-0 flex items-center justify-center",
                      sel ? "bg-red-500 border-red-400" : "border-zinc-600",
                    )}>
                      {sel && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm text-zinc-100 truncate">{m.name}</div>
                      <div className="text-[10px] text-zinc-600 font-mono truncate">{m.path}</div>
                    </div>
                    <div className="text-right text-xs font-mono text-zinc-300">{formatBytes(m.size_bytes)}</div>
                    <div className="text-right text-xs text-zinc-500 whitespace-nowrap">
                      {m.never_loaded
                        ? <span className="text-amber-400 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" />never</span>
                        : m.days_since_loaded != null
                          ? <span>{m.days_since_loaded.toFixed(0)}d ago</span>
                          : "—"
                      }
                    </div>
                    <div className="text-right text-[10px] uppercase tracking-wider text-zinc-500">{m.kind}</div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
