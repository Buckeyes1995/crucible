"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Cpu, MessageSquare, Zap, Trophy, Swords, Timer, Sparkles,
  BarChart3, Activity, ArrowUpRight, Loader2,
} from "lucide-react";
import Link from "next/link";

const BASE = "/api";

type Dashboard = {
  active_model: string | null;
  memory_pressure: number | null;
  thermal_state: string;
  model_count: number;
  today_inferences: number;
  today_tokens: number;
  total_inferences: number;
  arena_top: { model_id: string; elo: number; wins: number; battles: number }[];
  recent_benchmarks: { id: string; name: string; created_at: string }[];
};

function StatCard({ label, value, sub, icon, color, href }: {
  label: string; value: string | number; sub?: string;
  icon: React.ReactNode; color: string; href?: string;
}) {
  const inner = (
    <div className={cn(
      "relative overflow-hidden rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-5 transition-all duration-200",
      href && "hover:border-white/[0.12] hover:bg-zinc-900/60 cursor-pointer group"
    )}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-1">{label}</p>
          <p className={cn("text-3xl font-bold font-mono tracking-tight", color)}>{value}</p>
          {sub && <p className="text-xs text-zinc-600 mt-1">{sub}</p>}
        </div>
        <div className={cn("p-2 rounded-xl bg-zinc-800/50", color.replace("text-", "text-"))}>
          {icon}
        </div>
      </div>
      {href && (
        <ArrowUpRight className="absolute top-3 right-3 w-3.5 h-3.5 text-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function QuickAction({ href, icon, label, description }: {
  href: string; icon: React.ReactNode; label: string; description: string;
}) {
  return (
    <Link href={href}
      className="flex items-start gap-3 p-4 rounded-xl border border-white/[0.06] bg-zinc-900/30 hover:bg-zinc-900/60 hover:border-white/[0.12] transition-all duration-200 group">
      <div className="p-2 rounded-lg bg-zinc-800/80 text-zinc-400 group-hover:text-indigo-400 transition-colors">
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">{label}</p>
        <p className="text-xs text-zinc-600 mt-0.5">{description}</p>
      </div>
    </Link>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${BASE}/dashboard`).then((r) => r.json()).then(setData).finally(() => setLoading(false));
    const id = setInterval(() => {
      fetch(`${BASE}/dashboard`).then((r) => r.json()).then(setData);
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-screen">
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mx-auto" />
          <p className="text-sm text-zinc-600">Loading dashboard…</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const activeModelName = data.active_model?.replace(/^mlx:/, "") ?? null;

  return (
    <div className="max-w-6xl mx-auto px-8 py-8 space-y-8 animate-fade-in">
      {/* Hero: Active Model */}
      <div className="relative rounded-2xl border border-white/[0.06] bg-zinc-900/30 p-6 overflow-hidden">
        <div className="relative z-10 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-2">Active Model</p>
            {activeModelName ? (
              <div className="flex items-center gap-3">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-400" />
                </span>
                <h1 className="text-2xl font-bold text-zinc-100 tracking-tight">{activeModelName}</h1>
              </div>
            ) : (
              <p className="text-lg text-zinc-600">No model loaded</p>
            )}
          </div>
          <div className="flex items-center gap-6">
            {data.memory_pressure != null && (
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wider text-zinc-600">Memory</p>
                <p className={cn("text-xl font-bold font-mono",
                  data.memory_pressure > 0.8 ? "text-red-400" : data.memory_pressure > 0.6 ? "text-amber-400" : "text-emerald-400"
                )}>{Math.round(data.memory_pressure * 100)}%</p>
              </div>
            )}
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wider text-zinc-600">Thermal</p>
              <p className={cn("text-xl font-bold capitalize",
                data.thermal_state === "nominal" ? "text-emerald-400" :
                data.thermal_state === "fair" ? "text-amber-400" : "text-red-400"
              )}>{data.thermal_state}</p>
            </div>
          </div>
        </div>
        {/* Subtle gradient background */}
        <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/[0.03] via-transparent to-emerald-500/[0.03]" />
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Today" value={data.today_inferences} sub={`${data.today_tokens.toLocaleString()} tokens`}
          icon={<MessageSquare className="w-5 h-5" />} color="text-indigo-400" href="/profiler" />
        <StatCard label="All Time" value={data.total_inferences.toLocaleString()}
          icon={<BarChart3 className="w-5 h-5" />} color="text-zinc-300" href="/token-analytics" />
        <StatCard label="Models" value={data.model_count}
          icon={<Cpu className="w-5 h-5" />} color="text-emerald-400" href="/models" />
        <StatCard label="Arena Battles" value={data.arena_top.reduce((s, m) => s + m.battles, 0) || "—"}
          icon={<Swords className="w-5 h-5" />} color="text-amber-400" href="/arena" />
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-3">Quick Actions</h2>
        <div className="grid grid-cols-3 gap-3">
          <QuickAction href="/chat" icon={<MessageSquare className="w-4 h-4" />}
            label="Chat" description="Talk to the active model" />
          <QuickAction href="/arena" icon={<Swords className="w-4 h-4" />}
            label="Arena" description="Blind model battle" />
          <QuickAction href="/benchmark2" icon={<Zap className="w-4 h-4" />}
            label="Benchmark" description="Test model performance" />
          <QuickAction href="/profiler" icon={<Timer className="w-4 h-4" />}
            label="Profiler" description="Inference breakdown" />
          <QuickAction href="/recommender" icon={<Sparkles className="w-4 h-4" />}
            label="Recommender" description="Optimize your library" />
          <QuickAction href="/health" icon={<Activity className="w-4 h-4" />}
            label="Health Check" description="System status" />
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-2 gap-4">
        {/* Arena Leaders */}
        <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/30 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-zinc-200">Arena Leaders</h3>
            </div>
            <Link href="/arena/leaderboard" className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors">
              View all →
            </Link>
          </div>
          {data.arena_top.length === 0 ? (
            <p className="text-sm text-zinc-600">No battles yet</p>
          ) : (
            <div className="space-y-2.5">
              {data.arena_top.map((m, i) => {
                const medals = ["🥇", "🥈", "🥉"];
                return (
                  <div key={m.model_id} className="flex items-center gap-3">
                    <span className="text-base w-6 text-center">{medals[i] ?? ""}</span>
                    <span className="text-sm text-zinc-300 flex-1 truncate">{m.model_id}</span>
                    <span className="text-sm font-mono font-semibold text-indigo-400">{m.elo}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Benchmarks */}
        <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/30 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-semibold text-zinc-200">Recent Benchmarks</h3>
            </div>
            <Link href="/benchmark/history" className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors">
              View all →
            </Link>
          </div>
          {data.recent_benchmarks.length === 0 ? (
            <p className="text-sm text-zinc-600">No benchmarks yet</p>
          ) : (
            <div className="space-y-2">
              {data.recent_benchmarks.map((b) => (
                <Link key={b.id} href={`/benchmark/run/${b.id}`}
                  className="flex items-center justify-between py-1.5 px-2 -mx-2 rounded-lg hover:bg-white/[0.03] transition-colors">
                  <span className="text-sm text-zinc-300 truncate">{b.name || "Untitled"}</span>
                  <span className="text-[11px] text-zinc-600 shrink-0 ml-4">
                    {new Date(b.created_at).toLocaleDateString()}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
