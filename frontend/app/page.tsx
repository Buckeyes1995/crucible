"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Activity, Cpu, Zap, Trophy, BarChart2, MessageSquare, Swords, GitBranch, Timer, Sparkles } from "lucide-react";
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

const QUICK_LINKS = [
  { href: "/models", label: "Models", icon: <Cpu className="w-5 h-5" />, color: "text-indigo-400" },
  { href: "/chat", label: "Chat", icon: <MessageSquare className="w-5 h-5" />, color: "text-emerald-400" },
  { href: "/arena", label: "Arena", icon: <Swords className="w-5 h-5" />, color: "text-amber-400" },
  { href: "/benchmark2", label: "Benchmark", icon: <Zap className="w-5 h-5" />, color: "text-cyan-400" },
  { href: "/profiler", label: "Profiler", icon: <Timer className="w-5 h-5" />, color: "text-purple-400" },
  { href: "/recommender", label: "Recommender", icon: <Sparkles className="w-5 h-5" />, color: "text-pink-400" },
];

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);

  useEffect(() => {
    fetch(`${BASE}/dashboard`).then((r) => r.json()).then(setData);
    const id = setInterval(() => {
      fetch(`${BASE}/dashboard`).then((r) => r.json()).then(setData);
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  if (!data) return <div className="p-8 text-zinc-500">Loading dashboard…</div>;

  const thermalColor = {
    nominal: "text-green-400", fair: "text-yellow-400",
    serious: "text-orange-400", critical: "text-red-400",
  }[data.thermal_state] ?? "text-zinc-500";

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Activity className="w-6 h-6 text-indigo-400" />
        <h1 className="text-xl font-semibold text-zinc-100">Dashboard</h1>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
          <div className="text-xs text-zinc-500 mb-1">Active Model</div>
          <div className="text-sm font-medium text-zinc-200 truncate">
            {data.active_model ? (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                {data.active_model.replace(/^mlx:/, "")}
              </span>
            ) : (
              <span className="text-zinc-600">None loaded</span>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
          <div className="text-xs text-zinc-500 mb-1">System</div>
          <div className="flex items-center gap-3">
            {data.memory_pressure != null && (
              <div className="text-sm font-mono text-zinc-200">
                Mem: {Math.round(data.memory_pressure * 100)}%
              </div>
            )}
            <div className={cn("text-sm capitalize", thermalColor)}>⬡ {data.thermal_state}</div>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
          <div className="text-xs text-zinc-500 mb-1">Today</div>
          <div className="text-2xl font-bold text-indigo-400 font-mono">{data.today_inferences}</div>
          <div className="text-xs text-zinc-500">{data.today_tokens.toLocaleString()} tokens</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
          <div className="text-xs text-zinc-500 mb-1">All Time</div>
          <div className="text-2xl font-bold text-zinc-300 font-mono">{data.total_inferences}</div>
          <div className="text-xs text-zinc-500">{data.model_count} models</div>
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-6 gap-3">
        {QUICK_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border border-white/10 bg-zinc-900/30 hover:bg-zinc-800/50 hover:border-white/20 transition-colors"
          >
            <span className={link.color}>{link.icon}</span>
            <span className="text-xs text-zinc-400">{link.label}</span>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Arena top 3 */}
        <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-400">
            <Trophy className="w-4 h-4 text-amber-400" /> Arena Leaders
          </div>
          {data.arena_top.length === 0 ? (
            <div className="text-xs text-zinc-600">No battles yet</div>
          ) : (
            <div className="space-y-2">
              {data.arena_top.map((m, i) => (
                <div key={m.model_id} className="flex items-center gap-3">
                  <span className={cn("text-sm font-bold font-mono w-6",
                    i === 0 ? "text-amber-400" : i === 1 ? "text-zinc-300" : "text-amber-600"
                  )}>
                    #{i + 1}
                  </span>
                  <span className="text-sm text-zinc-200 flex-1 truncate">{m.model_id}</span>
                  <span className="text-sm font-mono text-indigo-400">{m.elo}</span>
                </div>
              ))}
            </div>
          )}
          <Link href="/arena/leaderboard" className="text-xs text-indigo-400 hover:text-indigo-300">
            View full leaderboard →
          </Link>
        </div>

        {/* Recent benchmarks */}
        <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-400">
            <BarChart2 className="w-4 h-4 text-cyan-400" /> Recent Benchmarks
          </div>
          {data.recent_benchmarks.length === 0 ? (
            <div className="text-xs text-zinc-600">No benchmarks yet</div>
          ) : (
            <div className="space-y-2">
              {data.recent_benchmarks.map((b) => (
                <Link
                  key={b.id}
                  href={`/benchmark/run/${b.id}`}
                  className="flex items-center justify-between text-sm hover:bg-white/5 rounded px-2 py-1 -mx-2"
                >
                  <span className="text-zinc-200 truncate">{b.name || "Untitled"}</span>
                  <span className="text-xs text-zinc-500 shrink-0">{new Date(b.created_at).toLocaleDateString()}</span>
                </Link>
              ))}
            </div>
          )}
          <Link href="/benchmark/history" className="text-xs text-indigo-400 hover:text-indigo-300">
            View all runs →
          </Link>
        </div>
      </div>
    </div>
  );
}
