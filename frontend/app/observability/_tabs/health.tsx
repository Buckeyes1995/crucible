"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { HeartPulse, RefreshCw } from "lucide-react";

type Service = { name: string; url: string; status: string; code?: number; error?: string; active_model?: string };
type HealthData = { overall: string; services: Service[] };

export default function HealthTab() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const load = () => { setLoading(true); fetch("/api/health/check").then(r => r.json()).then(setData).finally(() => setLoading(false)); };
  useEffect(() => { load(); const id = setInterval(load, 30000); return () => clearInterval(id); }, []);

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HeartPulse className="w-6 h-6 text-emerald-400" />
          <h1 className="text-xl font-semibold text-zinc-100">Health Check</h1>
          {data && <span className={cn("text-xs px-2 py-0.5 rounded font-medium",
            data.overall === "healthy" ? "bg-emerald-900/30 text-emerald-400" : "bg-amber-900/30 text-amber-400")}>{data.overall}</span>}
        </div>
        <Button variant="ghost" onClick={load} disabled={loading} className="gap-1.5 text-xs"><RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} /> Refresh</Button>
      </div>
      {data?.services.map((s) => (
        <div key={s.name} className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-white/[0.06] bg-zinc-900/40">
          <div className={cn("w-3 h-3 rounded-full", s.status === "up" ? "bg-emerald-400" : "bg-red-400")} />
          <div className="flex-1">
            <div className="text-sm font-medium text-zinc-200">{s.name}</div>
            <div className="text-xs font-mono text-zinc-500">{s.url}</div>
            {s.active_model && <div className="text-xs text-indigo-300 mt-0.5">Active: {s.active_model}</div>}
            {s.error && <div className="text-xs text-red-400 mt-0.5">{s.error}</div>}
          </div>
          <span className={cn("text-xs font-medium", s.status === "up" ? "text-emerald-400" : "text-red-400")}>{s.status}</span>
        </div>
      ))}
    </div>
  );
}
