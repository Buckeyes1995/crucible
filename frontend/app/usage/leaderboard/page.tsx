"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Trophy, MessageSquare, BarChart3, Swords, Zap, Hash, Clock } from "lucide-react";

type UsageRow = {
  model_id: string;
  chat_sessions?: number;
  benchmark_runs?: number;
  arena_battles?: number;
  arena_wins?: number;
  avg_tps?: number;
  total_output_tokens?: number;
  tokens_24h?: number;
  hours_loaded?: number;
  hours_loaded_24h?: number;
};

type SortKey =
  | "total"
  | "chat_sessions"
  | "benchmark_runs"
  | "arena_battles"
  | "avg_tps"
  | "total_output_tokens"
  | "tokens_24h"
  | "hours_loaded"
  | "hours_loaded_24h";

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return n.toString();
}

export default function UsageLeaderboardPage() {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("total_output_tokens");

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch("/api/model-usage-stats");
        if (resp.ok) setRows(await resp.json());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const sorted = useMemo(() => {
    const score = (r: UsageRow) =>
      sortKey === "total"
        ? (r.chat_sessions ?? 0) + (r.benchmark_runs ?? 0) + (r.arena_battles ?? 0)
        : (r[sortKey] ?? 0);
    return [...rows].sort((a, b) => score(b) - score(a));
  }, [rows, sortKey]);

  const maxSort = useMemo(() => {
    const score = (r: UsageRow): number =>
      sortKey === "total"
        ? (r.chat_sessions ?? 0) + (r.benchmark_runs ?? 0) + (r.arena_battles ?? 0)
        : ((r[sortKey as keyof UsageRow] as number | undefined) ?? 0);
    return Math.max(1, ...rows.map(score));
  }, [rows, sortKey]);

  const barScore = (r: UsageRow): number =>
    sortKey === "total"
      ? (r.chat_sessions ?? 0) + (r.benchmark_runs ?? 0) + (r.arena_battles ?? 0)
      : ((r[sortKey as keyof UsageRow] as number | undefined) ?? 0);

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-white/[0.04]">
        <PageHeader
          icon={<Trophy className="w-5 h-5" />}
          title="Model Usage Leaderboard"
          description="Which models you actually use — chat, benchmarks, arena battles."
        />
        <div className="mt-3 flex gap-1 text-xs flex-wrap">
          {([
            ["total_output_tokens", "Tokens (lifetime)"],
            ["tokens_24h", "Tokens (24h)"],
            ["hours_loaded", "Hours (lifetime)"],
            ["hours_loaded_24h", "Hours (24h)"],
            ["total", "Interactions"],
            ["chat_sessions", "Chat"],
            ["benchmark_runs", "Bench"],
            ["arena_battles", "Arena"],
            ["avg_tps", "tok/s"],
          ] as [SortKey, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setSortKey(k)}
              className={
                "px-2.5 py-1 rounded transition-colors " +
                (sortKey === k
                  ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                  : "bg-zinc-800/60 text-zinc-400 border border-white/10 hover:text-zinc-100")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        {loading ? (
          <p className="text-zinc-500 text-sm">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="text-zinc-500 text-sm">No usage recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {sorted.map((r, i) => {
              const total = (r.chat_sessions ?? 0) + (r.benchmark_runs ?? 0) + (r.arena_battles ?? 0);
              const winRate = r.arena_battles ? ((r.arena_wins ?? 0) / r.arena_battles) * 100 : null;
              const score = barScore(r);
              const headline =
                sortKey === "total_output_tokens"
                  ? `${fmtTokens(r.total_output_tokens ?? 0)} tokens`
                  : sortKey === "tokens_24h"
                    ? `${fmtTokens(r.tokens_24h ?? 0)} tokens today`
                    : sortKey === "hours_loaded"
                      ? `${(r.hours_loaded ?? 0).toFixed(1)} h loaded`
                      : sortKey === "hours_loaded_24h"
                        ? `${(r.hours_loaded_24h ?? 0).toFixed(1)} h today`
                        : sortKey === "avg_tps"
                          ? `${(r.avg_tps ?? 0).toFixed(1)} tok/s`
                          : `${total} interactions`;
              return (
                <li
                  key={r.model_id}
                  className="rounded-lg border border-white/[0.06] bg-zinc-950 hover:bg-zinc-900/60 px-4 py-3"
                >
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xl font-mono text-zinc-600 w-8 text-center">{i + 1}</span>
                    <span className="font-mono text-zinc-200 flex-1 truncate">
                      {r.model_id.replace(/^mlx:/, "")}
                    </span>
                    <span className="text-[11px] text-zinc-400">{headline}</span>
                  </div>
                  <div className="relative h-1.5 rounded bg-zinc-900 overflow-hidden mb-2">
                    <div
                      className="absolute inset-y-0 left-0 bg-indigo-500/70"
                      style={{ width: `${(score / maxSort) * 100}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-3 text-[11px] text-zinc-400">
                    <span className="flex items-center gap-1">
                      <Hash className="w-3 h-3 text-zinc-500" />
                      {fmtTokens(r.total_output_tokens ?? 0)} tokens
                      {r.tokens_24h ? <span className="text-indigo-400">· {fmtTokens(r.tokens_24h)} today</span> : null}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-zinc-500" />
                      {(r.hours_loaded ?? 0).toFixed(1)}h loaded
                      {r.hours_loaded_24h ? <span className="text-indigo-400">· {r.hours_loaded_24h.toFixed(1)}h today</span> : null}
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageSquare className="w-3 h-3 text-zinc-500" />
                      {r.chat_sessions ?? 0} chats
                    </span>
                    <span className="flex items-center gap-1">
                      <BarChart3 className="w-3 h-3 text-zinc-500" />
                      {r.benchmark_runs ?? 0} benches
                    </span>
                    <span className="flex items-center gap-1">
                      <Swords className="w-3 h-3 text-zinc-500" />
                      {r.arena_battles ?? 0} battles
                      {winRate !== null && <span className="text-emerald-400">· {winRate.toFixed(0)}% win</span>}
                    </span>
                    {r.avg_tps != null && (
                      <span className="flex items-center gap-1">
                        <Zap className="w-3 h-3 text-zinc-500" />
                        {r.avg_tps.toFixed(1)} tok/s
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
