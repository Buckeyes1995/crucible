"use client";

import { useRef, useState } from "react";
import { api, readSSE, type ArenaVoteResult } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Send, Trophy, RotateCcw, Swords } from "lucide-react";
import Link from "next/link";

type Phase = "idle" | "ready" | "streaming" | "done" | "voted";

export default function ArenaPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [battleId, setBattleId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [responseA, setResponseA] = useState("");
  const [responseB, setResponseB] = useState("");
  const [streamingA, setStreamingA] = useState(false);
  const [streamingB, setStreamingB] = useState(false);
  const [statsA, setStatsA] = useState<{ tps: number | null; ttft_ms: number | null }>({ tps: null, ttft_ms: null });
  const [statsB, setStatsB] = useState<{ tps: number | null; ttft_ms: number | null }>({ tps: null, ttft_ms: null });
  const [voteResult, setVoteResult] = useState<ArenaVoteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);
  const aRef = useRef<HTMLDivElement>(null);
  const bRef = useRef<HTMLDivElement>(null);

  async function startBattle() {
    setError(null);
    setResponseA("");
    setResponseB("");
    setStatsA({ tps: null, ttft_ms: null });
    setStatsB({ tps: null, ttft_ms: null });
    setVoteResult(null);
    setPrompt("");
    try {
      const result = await api.arena.startBattle();
      setBattleId(result.battle_id);
      setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start battle");
    }
  }

  async function sendPrompt() {
    if (!battleId || !prompt.trim()) return;
    setPhase("streaming");
    setStreamingA(true);
    setStreamingB(true);
    setResponseA("");
    setResponseB("");

    try {
      const resp = await api.arena.chat(battleId, {
        prompt: prompt.trim(),
        temperature,
        max_tokens: maxTokens,
      });
      await readSSE(resp, (data) => {
        const slot = data.slot as string;
        const event = data.event as string;
        if (event === "token") {
          const token = data.token as string;
          if (slot === "a") {
            setResponseA((prev) => prev + token);
            aRef.current?.scrollTo(0, aRef.current.scrollHeight);
          } else {
            setResponseB((prev) => prev + token);
            bRef.current?.scrollTo(0, bRef.current.scrollHeight);
          }
        } else if (event === "done") {
          if (slot === "a") {
            setStreamingA(false);
            setStatsA({ tps: data.tps as number | null, ttft_ms: data.ttft_ms as number | null });
          } else {
            setStreamingB(false);
            setStatsB({ tps: data.tps as number | null, ttft_ms: data.ttft_ms as number | null });
          }
        } else if (event === "complete") {
          setPhase("done");
        } else if (event === "error") {
          setError(`${slot.toUpperCase()}: ${data.message}`);
        }
      });
      setPhase("done");
      setStreamingA(false);
      setStreamingB(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Stream failed");
      setPhase("ready");
    }
  }

  async function vote(winner: string) {
    if (!battleId) return;
    try {
      const result = await api.arena.vote(battleId, winner);
      setVoteResult(result);
      setPhase("voted");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Vote failed");
    }
  }

  const eloDelta = (before: number, after: number) => {
    const d = Math.round((after - before) * 10) / 10;
    return d >= 0 ? `+${d}` : `${d}`;
  };

  return (
    <div className="flex flex-col h-full min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <Swords className="w-5 h-5 text-indigo-400" />
          <h1 className="text-lg font-semibold text-zinc-100">Model Arena</h1>
          {phase !== "idle" && (
            <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 capitalize">{phase}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link href="/arena/leaderboard">
            <Button variant="ghost" className="gap-1.5 text-xs">
              <Trophy className="w-3.5 h-3.5" /> Leaderboard
            </Button>
          </Link>
          <Button onClick={startBattle} variant="primary" className="gap-1.5 text-xs">
            <RotateCcw className="w-3.5 h-3.5" /> New Battle
          </Button>
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-3 px-3 py-2 rounded bg-red-900/30 border border-red-500/30 text-red-300 text-sm">
          {error}
        </div>
      )}

      {phase === "idle" ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <Swords className="w-16 h-16 text-zinc-700 mx-auto" />
            <p className="text-zinc-500 text-lg">Blind A/B model testing with ELO ratings</p>
            <Button onClick={startBattle} variant="primary" className="gap-2">
              <Swords className="w-4 h-4" /> Start Battle
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Prompt input */}
          <div className="px-6 py-3 border-b border-white/10 flex gap-3">
            <input
              className="flex-1 bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50"
              placeholder="Enter a prompt for both models…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && phase === "ready" && sendPrompt()}
              disabled={phase !== "ready"}
            />
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <label>T:</label>
              <input
                type="number" step="0.1" min="0" max="2"
                className="w-14 bg-zinc-900 border border-white/10 rounded px-1.5 py-1 text-xs text-zinc-300"
                value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value) || 0.7)}
              />
              <label>Max:</label>
              <input
                type="number" step="256" min="64" max="32768"
                className="w-20 bg-zinc-900 border border-white/10 rounded px-1.5 py-1 text-xs text-zinc-300"
                value={maxTokens} onChange={(e) => setMaxTokens(parseInt(e.target.value) || 1024)}
              />
            </div>
            <Button
              onClick={sendPrompt}
              disabled={phase !== "ready" || !prompt.trim()}
              variant="primary"
              className="gap-1.5"
            >
              <Send className="w-4 h-4" /> Send
            </Button>
          </div>

          {/* Response panels */}
          <div className="flex-1 flex gap-4 p-6 min-h-0">
            {(["a", "b"] as const).map((slot) => {
              const response = slot === "a" ? responseA : responseB;
              const streaming = slot === "a" ? streamingA : streamingB;
              const stats = slot === "a" ? statsA : statsB;
              const ref = slot === "a" ? aRef : bRef;
              const isWinner = voteResult?.winner === `model_${slot}`;
              const isTie = voteResult?.winner === "tie";
              const revealed = phase === "voted" && voteResult;
              const modelName = revealed
                ? slot === "a" ? voteResult.model_a : voteResult.model_b
                : null;
              const eloBefore = revealed
                ? slot === "a" ? voteResult.elo_before.a : voteResult.elo_before.b
                : null;
              const eloAfter = revealed
                ? slot === "a" ? voteResult.elo_after.a : voteResult.elo_after.b
                : null;

              return (
                <div
                  key={slot}
                  className={cn(
                    "flex-1 flex flex-col rounded-xl border bg-zinc-900/50 backdrop-blur overflow-hidden transition-colors",
                    isWinner ? "border-indigo-500/50" : isTie ? "border-amber-500/30" : "border-white/10"
                  )}
                >
                  {/* Panel header */}
                  <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-300">
                        Model {slot.toUpperCase()}
                      </span>
                      {streaming && (
                        <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                      )}
                      {isWinner && <span className="text-xs text-indigo-400 font-medium">Winner</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs font-mono text-zinc-500">
                      {stats.ttft_ms != null && <span>TTFT: {stats.ttft_ms}ms</span>}
                      {stats.tps != null && <span>{stats.tps} tok/s</span>}
                    </div>
                  </div>

                  {/* Revealed model name + ELO */}
                  {revealed && modelName && (
                    <div className="px-4 py-2 bg-zinc-800/50 border-b border-white/5 flex items-center justify-between">
                      <span className="text-sm font-medium text-indigo-300">{modelName}</span>
                      {eloBefore != null && eloAfter != null && (
                        <span className={cn(
                          "text-xs font-mono",
                          eloAfter > eloBefore ? "text-green-400" : eloAfter < eloBefore ? "text-red-400" : "text-zinc-400"
                        )}>
                          {Math.round(eloBefore)} → {Math.round(eloAfter)} ({eloDelta(eloBefore, eloAfter)})
                        </span>
                      )}
                    </div>
                  )}

                  {/* Response body */}
                  <div ref={ref} className="flex-1 overflow-y-auto p-4 text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
                    {response || (
                      <span className="text-zinc-600 italic">
                        {phase === "ready" ? "Waiting for prompt…" : ""}
                      </span>
                    )}
                    {streaming && <span className="inline-block w-1.5 h-4 bg-indigo-400 animate-pulse ml-0.5" />}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Vote bar */}
          {phase === "done" && (
            <div className="px-6 py-4 border-t border-white/10 flex items-center justify-center gap-4">
              <Button onClick={() => vote("model_a")} variant="primary" className="min-w-[140px]">
                👈 A is Better
              </Button>
              <Button onClick={() => vote("tie")} variant="ghost" className="min-w-[100px]">
                🤝 Tie
              </Button>
              <Button onClick={() => vote("model_b")} variant="primary" className="min-w-[140px]">
                B is Better 👉
              </Button>
            </div>
          )}

          {phase === "voted" && (
            <div className="px-6 py-3 border-t border-white/10 flex items-center justify-center">
              <Button onClick={startBattle} variant="primary" className="gap-2">
                <RotateCcw className="w-4 h-4" /> New Battle
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
