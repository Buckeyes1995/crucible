"use client";

import { useEffect, useState } from "react";
import { api, type ArenaLeaderboardEntry, type ArenaBattleHistory } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Trophy, Swords, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

const RANK_COLORS = ["text-amber-400", "text-zinc-300", "text-amber-600"];

export default function LeaderboardTab() {
  const [entries, setEntries] = useState<ArenaLeaderboardEntry[]>([]);
  const [history, setHistory] = useState<ArenaBattleHistory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.arena.leaderboard(),
      api.arena.history(20),
    ]).then(([lb, hist]) => {
      setEntries(lb);
      setHistory(hist);
    }).finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Trophy className="w-6 h-6 text-amber-400" />
          <h1 className="text-xl font-semibold text-zinc-100">Arena Leaderboard</h1>
        </div>
        <Link href="/arena">
          <Button variant="ghost" className="gap-1.5 text-xs">
            <Swords className="w-3.5 h-3.5" /> Battle
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="text-zinc-500 text-center py-16">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <Swords className="w-12 h-12 text-zinc-700 mx-auto" />
          <p className="text-zinc-500">No battles yet. Start one in the Arena!</p>
          <Link href="/arena">
            <Button variant="primary">Go to Arena</Button>
          </Link>
        </div>
      ) : (
        <>
          {/* Rankings table */}
          <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 backdrop-blur overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-zinc-500 text-xs uppercase tracking-wider">
                  <th className="px-4 py-3 text-left w-12">#</th>
                  <th className="px-4 py-3 text-left">Model</th>
                  <th className="px-4 py-3 text-right">ELO</th>
                  <th className="px-4 py-3 text-right">Win Rate</th>
                  <th className="px-4 py-3 text-right">W / L / T</th>
                  <th className="px-4 py-3 text-right">Battles</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => (
                  <tr key={entry.model_id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className={cn("px-4 py-3 font-mono font-bold", RANK_COLORS[i] ?? "text-zinc-600")}>
                      {i + 1}
                    </td>
                    <td className="px-4 py-3 font-medium text-zinc-200">{entry.model_id}</td>
                    <td className="px-4 py-3 text-right font-mono text-indigo-400 font-semibold">
                      {entry.elo}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-300">
                      {entry.win_rate}%
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-500">
                      <span className="text-green-400">{entry.wins}</span>
                      {" / "}
                      <span className="text-red-400">{entry.losses}</span>
                      {" / "}
                      <span className="text-zinc-400">{entry.ties}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-500">{entry.battles}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Recent battles */}
          {history.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Recent Battles</h2>
              <div className="space-y-2">
                {history.map((b) => {
                  const winnerName = b.winner === "model_a" ? b.model_a : b.winner === "model_b" ? b.model_b : "Tie";
                  const deltaA = b.elo_after_a - b.elo_before_a;
                  const deltaB = b.elo_after_b - b.elo_before_b;
                  return (
                    <div key={b.id} className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-white/5 bg-zinc-900/30 text-sm">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn("font-medium", b.winner === "model_a" ? "text-indigo-300" : "text-zinc-400")}>
                            {b.model_a}
                          </span>
                          <span className={cn("text-xs font-mono", deltaA >= 0 ? "text-green-400" : "text-red-400")}>
                            {deltaA >= 0 ? "+" : ""}{Math.round(deltaA * 10) / 10}
                          </span>
                          <span className="text-zinc-600">vs</span>
                          <span className={cn("font-medium", b.winner === "model_b" ? "text-indigo-300" : "text-zinc-400")}>
                            {b.model_b}
                          </span>
                          <span className={cn("text-xs font-mono", deltaB >= 0 ? "text-green-400" : "text-red-400")}>
                            {deltaB >= 0 ? "+" : ""}{Math.round(deltaB * 10) / 10}
                          </span>
                        </div>
                        <div className="text-xs text-zinc-600 truncate mt-0.5">{b.prompt}</div>
                      </div>
                      <span className="text-xs text-zinc-500 shrink-0">
                        {new Date(b.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
