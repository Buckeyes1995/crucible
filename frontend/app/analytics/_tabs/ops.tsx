"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Activity, RefreshCw, AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "@/components/Toast";

type ProcRow = {
  name: string;
  running: boolean;
  entries: { pid: number; etime: string; rss_kb: number; command: string }[];
};

type AutoRestartPolicy = {
  enabled: boolean;
  services: Record<string, { watch: boolean; max_failures: number; restart_cmd: string }>;
};

export default function OpsTab() {
  const [procs, setProcs] = useState<ProcRow[]>([]);
  const [policy, setPolicy] = useState<AutoRestartPolicy | null>(null);
  const [restarting, setRestarting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, pol] = await Promise.all([
        fetch("/api/ops/processes").then(r => r.json()),
        fetch("/api/ops/auto-restart").then(r => r.json()),
      ]);
      setProcs(p);
      setPolicy(pol);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const restart = async (name: string) => {
    setRestarting(name);
    try {
      const r = await fetch(`/api/ops/run-restart/${encodeURIComponent(name)}`, { method: "POST" });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t);
      }
      const data = await r.json();
      toast(`Restart ${name}: exit ${data.exit_code}`, data.exit_code === 0 ? "success" : "error");
      await load();
    } catch (e) {
      toast(`Restart failed: ${(e as Error).message}`, "error");
    } finally {
      setRestarting(null);
    }
  };

  const toggleAutoRestart = async (enabled: boolean) => {
    if (!policy) return;
    try {
      const next = await fetch("/api/ops/auto-restart", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      }).then(r => r.json());
      setPolicy(next);
    } catch {}
  };

  return (
    <div className="flex flex-col h-full min-h-screen">
      <div className="px-6 py-4 border-b border-white/[0.04]">
        <PageHeader
          icon={<Activity className="w-5 h-5" />}
          title="Ops"
          description="Backend process tree + auto-restart policy"
        >
          <Button variant="ghost" size="sm" onClick={load} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </PageHeader>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        <section>
          <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500 mb-3">Processes</h2>
          <div className="space-y-2">
            {procs.map(p => (
              <div key={p.name} className={cn(
                "rounded-xl border p-3",
                p.running ? "border-emerald-500/20 bg-emerald-950/5" : "border-white/[0.06] bg-zinc-900/30",
              )}>
                <div className="flex items-center gap-2">
                  {p.running ? <Check className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-zinc-500" />}
                  <span className="text-sm font-semibold text-zinc-100">{p.name}</span>
                  <span className="text-[11px] text-zinc-500">
                    {p.running ? `${p.entries.length} process${p.entries.length === 1 ? "" : "es"}` : "not running"}
                  </span>
                  <Button
                    onClick={() => restart(p.name)}
                    variant="ghost"
                    size="xs"
                    className="ml-auto"
                    disabled={restarting === p.name}
                  >
                    {restarting === p.name ? "Restarting…" : "Restart"}
                  </Button>
                </div>
                {p.entries.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {p.entries.map(e => (
                      <div key={e.pid} className="text-[10px] font-mono text-zinc-400 flex gap-3">
                        <span className="w-16 text-zinc-600">pid {e.pid}</span>
                        <span className="w-20 text-zinc-600">{e.etime}</span>
                        <span className="w-20 text-zinc-600">{(e.rss_kb / 1024).toFixed(0)} MB</span>
                        <span className="truncate">{e.command}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {policy && (
          <section>
            <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500 mb-3">Auto-restart policy</h2>
            <div className="rounded-xl border border-white/[0.06] bg-zinc-900/40 p-4">
              <label className="flex items-center gap-2 text-sm text-zinc-200">
                <input
                  type="checkbox"
                  checked={policy.enabled}
                  onChange={(e) => toggleAutoRestart(e.target.checked)}
                  className="accent-indigo-500"
                />
                Enable auto-restart watchdog
              </label>
              <div className="text-xs text-zinc-500 mt-1">
                When enabled, services configured below with <code>watch: true</code> get kicked via their <code>restart_cmd</code> after N consecutive health failures.
              </div>
              <pre className="mt-3 text-[10px] text-zinc-500 bg-black/30 rounded p-2 overflow-x-auto">{JSON.stringify(policy.services, null, 2)}</pre>
              <p className="text-[10px] text-zinc-600 mt-2">
                Edit via <code>PUT /api/ops/auto-restart</code> with a <code>services</code> patch.
              </p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
