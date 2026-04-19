"use client";

// Memory pressure planner — answer "if I load all of these at once, does it fit?"
// Pulls per-model size from the registry and the live memory reading from the
// planner endpoint. Useful before arena / smart-router / multi-slot setups
// where oMLX's engine pool could hold several models concurrently.

import { useEffect, useMemo, useState } from "react";
import { api, type ModelEntry } from "@/lib/api";
import { formatBytes, cn } from "@/lib/utils";
import { Cpu, AlertTriangle, Check } from "lucide-react";
import { useModelsStore } from "@/lib/stores/models";

type PlanResult = Awaited<ReturnType<typeof api.memPlan.plan>>;

export default function PlannerPage() {
  const { models, fetchModels } = useModelsStore();
  const [selected, setSelected] = useState<string[]>([]);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { fetchModels(); }, [fetchModels]);

  const visible = useMemo(
    () => models.filter((m: ModelEntry) => !m.hidden && m.node === "local" && (m.size_bytes ?? 0) > 0),
    [models],
  );

  // Re-plan whenever selection changes. Empty selection still hits the endpoint
  // to show the memory budget baseline.
  useEffect(() => {
    if (selected.length === 0) { setPlan(null); return; }
    api.memPlan
      .plan(selected)
      .then((r) => { setPlan(r); setError(null); })
      .catch((e) => setError((e as Error).message));
  }, [selected]);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="flex flex-col h-full min-h-screen">
      <div className="px-6 py-4 border-b border-white/[0.04] flex items-center gap-3">
        <Cpu className="w-5 h-5 text-indigo-400" />
        <h1 className="text-lg font-semibold text-zinc-100">Memory planner</h1>
        <span className="text-xs text-zinc-500">
          Pick models to preview whether they'd all fit in RAM simultaneously.
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-0 flex-1 min-h-0">
        <div className="overflow-y-auto p-5 space-y-1">
          {visible.length === 0 && (
            <div className="text-xs text-zinc-600 py-12 text-center">No local models to plan against.</div>
          )}
          {visible.map((m) => {
            const sel = selected.includes(m.id);
            return (
              <button
                key={m.id}
                onClick={() => toggle(m.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-colors",
                  sel ? "border-indigo-500/50 bg-indigo-950/20" : "border-white/[0.06] bg-zinc-900/40 hover:border-white/20",
                )}
              >
                <div className={cn(
                  "w-4 h-4 rounded border shrink-0 flex items-center justify-center",
                  sel ? "bg-indigo-500 border-indigo-400" : "border-zinc-600",
                )}>
                  {sel && <Check className="w-3 h-3 text-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-zinc-100 truncate">{m.name}</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">{m.kind.toUpperCase()} · {formatBytes(m.size_bytes ?? 0)}</div>
                </div>
              </button>
            );
          })}
        </div>

        <aside className="border-l border-white/[0.04] p-5 overflow-y-auto bg-zinc-950/60">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">Plan</h2>
          {error && <div className="text-xs text-red-400 mb-3">{error}</div>}
          {selected.length === 0 ? (
            <p className="text-xs text-zinc-600">Pick one or more models on the left.</p>
          ) : !plan ? (
            <p className="text-xs text-zinc-600 animate-pulse">Calculating…</p>
          ) : (
            <div className="space-y-3">
              <div className={cn(
                "rounded-lg border px-3 py-3 flex items-start gap-2",
                plan.fits ? "border-emerald-500/30 bg-emerald-900/20 text-emerald-200"
                          : "border-red-500/40 bg-red-950/30 text-red-200",
              )}>
                {plan.fits ? <Check className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
                <div>
                  <div className="text-sm font-semibold">
                    {plan.fits
                      ? `Fits — ${formatBytes(Math.max(0, plan.headroom_bytes))} headroom`
                      : `Over by ${formatBytes(Math.abs(plan.headroom_bytes))}`}
                  </div>
                  <div className="text-[11px] mt-0.5 opacity-80">
                    {formatBytes(plan.required_bytes)} needed · {formatBytes(plan.budget_bytes)} budget
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-zinc-500 space-y-1 font-mono">
                <div className="flex justify-between"><span>Total RAM</span><span>{formatBytes(plan.total_bytes)}</span></div>
                <div className="flex justify-between"><span>Free right now</span><span>{formatBytes(plan.available_bytes)}</span></div>
                <div className="flex justify-between"><span>OS headroom</span><span>{formatBytes(plan.system_headroom_bytes)}</span></div>
                <div className="flex justify-between"><span>Budget</span><span>{formatBytes(plan.budget_bytes)}</span></div>
                <div className="flex justify-between"><span>Per-model overhead</span><span>{formatBytes(plan.overhead_per_model_bytes)}</span></div>
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5 mt-3">Selection</h3>
                <ul className="text-[11px] text-zinc-400 space-y-1">
                  {plan.models.map((m) => (
                    <li key={m.id} className="flex justify-between gap-2">
                      <span className="truncate">{m.name}</span>
                      <span className="font-mono text-zinc-500 shrink-0">{formatBytes(m.size_bytes + m.overhead_bytes)}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <p className="text-[10px] text-zinc-600 leading-relaxed pt-2 border-t border-white/[0.04]">
                Per-model overhead is a rough KV-cache + activations estimate. Actual resident size
                can be slightly lower if weights page-in lazily; don't trust the headroom below ~1 GB.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
