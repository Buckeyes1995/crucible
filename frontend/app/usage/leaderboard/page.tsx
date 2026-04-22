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

// Two orthogonal dimensions: WHAT to measure (metric) and OVER WHAT WINDOW.
// Old UI mashed them into one button row; #164 splits them.
type Metric = "tokens" | "hours" | "interactions" | "chat" | "bench" | "arena" | "tps";
type Window = "lifetime" | "24h";

const METRICS: { key: Metric; label: string; icon: React.ReactNode }[] = [
  { key: "tokens",       label: "Tokens served", icon: <Hash className="w-3 h-3" /> },
  { key: "hours",        label: "Hours loaded",  icon: <Clock className="w-3 h-3" /> },
  { key: "interactions", label: "Interactions",  icon: <Trophy className="w-3 h-3" /> },
  { key: "chat",         label: "Chat",          icon: <MessageSquare className="w-3 h-3" /> },
  { key: "bench",        label: "Bench",         icon: <BarChart3 className="w-3 h-3" /> },
  { key: "arena",        label: "Arena",         icon: <Swords className="w-3 h-3" /> },
  { key: "tps",          label: "tok/s",         icon: <Zap className="w-3 h-3" /> },
];

const WINDOWS: { key: Window; label: string }[] = [
  { key: "lifetime", label: "Lifetime" },
  { key: "24h",      label: "Last 24h" },
];

// Which metrics actually have a 24h breakdown? The rest stay constant
// regardless of window — we grey out the window picker for them.
const HAS_24H: Record<Metric, boolean> = {
  tokens: true, hours: true,
  interactions: false, chat: false, bench: false, arena: false, tps: false,
};

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return n.toString();
}

function score(r: UsageRow, metric: Metric, win: Window): number {
  switch (metric) {
    case "tokens":       return win === "24h" ? (r.tokens_24h ?? 0) : (r.total_output_tokens ?? 0);
    case "hours":        return win === "24h" ? (r.hours_loaded_24h ?? 0) : (r.hours_loaded ?? 0);
    case "interactions": return (r.chat_sessions ?? 0) + (r.benchmark_runs ?? 0) + (r.arena_battles ?? 0);
    case "chat":         return r.chat_sessions ?? 0;
    case "bench":        return r.benchmark_runs ?? 0;
    case "arena":        return r.arena_battles ?? 0;
    case "tps":          return r.avg_tps ?? 0;
  }
}

function headlineFor(r: UsageRow, metric: Metric, win: Window): string {
  switch (metric) {
    case "tokens":       return `${fmtTokens(score(r, metric, win))} tokens${win === "24h" ? " today" : ""}`;
    case "hours":        return `${score(r, metric, win).toFixed(1)} h${win === "24h" ? " today" : " loaded"}`;
    case "tps":          return `${(r.avg_tps ?? 0).toFixed(1)} tok/s`;
    case "interactions": return `${score(r, metric, win)} interactions`;
    case "chat":         return `${r.chat_sessions ?? 0} chats`;
    case "bench":        return `${r.benchmark_runs ?? 0} benches`;
    case "arena":        return `${r.arena_battles ?? 0} battles`;
  }
}

export default function UsageLeaderboardPage() {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<Metric>("tokens");
  const [win, setWin] = useState<Window>("lifetime");

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

  const winApplies = HAS_24H[metric];
  const effectiveWin: Window = winApplies ? win : "lifetime";

  const sorted = useMemo(
    () => [...rows].sort((a, b) => score(b, metric, effectiveWin) - score(a, metric, effectiveWin)),
    [rows, metric, effectiveWin],
  );

  const maxScore = useMemo(
    () => Math.max(1, ...rows.map(r => score(r, metric, effectiveWin))),
    [rows, metric, effectiveWin],
  );

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-white/[0.04]">
        <PageHeader
          icon={<Trophy className="w-5 h-5" />}
          title="Model Usage Leaderboard"
          description="Which models you actually use — pick a metric and a time window."
        />

        {/* Row 1 — metric picker */}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold w-14 shrink-0">Metric</span>
          {METRICS.map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setMetric(key)}
              className={
                "px-2.5 py-1 text-xs rounded transition-colors flex items-center gap-1.5 " +
                (metric === key
                  ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                  : "bg-zinc-900 text-zinc-400 border border-white/10 hover:text-zinc-100")
              }
            >
              <span className="text-zinc-500">{icon}</span>
              {label}
            </button>
          ))}
        </div>

        {/* Row 2 — window picker; greyed out when metric has no breakdown */}
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold w-14 shrink-0">Window</span>
          {WINDOWS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setWin(key)}
              disabled={!winApplies && key === "24h"}
              className={
                "px-2.5 py-1 text-xs rounded transition-colors " +
                (effectiveWin === key
                  ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                  : "bg-zinc-900 text-zinc-400 border border-white/10 hover:text-zinc-100 ") +
                (!winApplies && key === "24h" ? "opacity-30 cursor-not-allowed" : "")
              }
              title={!winApplies && key === "24h" ? "This metric has no 24-hour breakdown" : undefined}
            >
              {label}
            </button>
          ))}
          {!winApplies && (
            <span className="text-[10px] text-zinc-600 italic">no time window for this metric</span>
          )}
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
              const winRate = r.arena_battles ? ((r.arena_wins ?? 0) / r.arena_battles) * 100 : null;
              const s = score(r, metric, effectiveWin);
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
                    <span className="text-[11px] text-zinc-400">{headlineFor(r, metric, effectiveWin)}</span>
                  </div>
                  <div className="relative h-1.5 rounded bg-zinc-900 overflow-hidden mb-2">
                    <div
                      className="absolute inset-y-0 left-0 bg-indigo-500/70"
                      style={{ width: `${(s / maxScore) * 100}%` }}
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
