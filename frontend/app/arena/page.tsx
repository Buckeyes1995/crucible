"use client";

import { useEffect, useRef, useState } from "react";
import { api, readSSE, type ArenaVoteResult, type PromptTemplate } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Send, Trophy, RotateCcw, Swords, Loader2, ThumbsUp, Minus, ChevronLeft, ChevronRight, BookOpen, ChevronDown } from "lucide-react";
import Link from "next/link";
import { toast } from "@/components/Toast";

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
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const templateRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.templates.list().then(setTemplates).catch(() => {});
  }, []);

  useEffect(() => {
    if (!showTemplates) return;
    const handler = (e: MouseEvent) => {
      if (templateRef.current && !templateRef.current.contains(e.target as Node)) {
        setShowTemplates(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showTemplates]);
  const [error, setError] = useState<string | null>(null);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);
  const aRef = useRef<HTMLDivElement>(null);
  const bRef = useRef<HTMLDivElement>(null);

  async function startBattle() {
    setError(null); setResponseA(""); setResponseB("");
    setStatsA({ tps: null, ttft_ms: null }); setStatsB({ tps: null, ttft_ms: null });
    setVoteResult(null); setPrompt("");
    try {
      const result = await api.arena.startBattle();
      setBattleId(result.battle_id);
      setPhase("ready");
      toast("Battle ready — two models are waiting", "info");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start battle");
      toast("Failed to start battle", "error");
    }
  }

  async function sendPrompt() {
    if (!battleId || !prompt.trim()) return;
    setPhase("streaming"); setStreamingA(true); setStreamingB(true);
    setResponseA(""); setResponseB("");
    try {
      const resp = await api.arena.chat(battleId, { prompt: prompt.trim(), temperature, max_tokens: maxTokens });
      await readSSE(resp, (data) => {
        const slot = data.slot as string;
        const event = data.event as string;
        if (event === "token") {
          const token = data.token as string;
          if (slot === "a") { setResponseA((p) => p + token); aRef.current?.scrollTo(0, aRef.current.scrollHeight); }
          else { setResponseB((p) => p + token); bRef.current?.scrollTo(0, bRef.current.scrollHeight); }
        } else if (event === "done") {
          if (slot === "a") { setStreamingA(false); setStatsA({ tps: data.tps as number | null, ttft_ms: data.ttft_ms as number | null }); }
          else { setStreamingB(false); setStatsB({ tps: data.tps as number | null, ttft_ms: data.ttft_ms as number | null }); }
        } else if (event === "complete") setPhase("done");
      });
      setPhase("done"); setStreamingA(false); setStreamingB(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Stream failed"); setPhase("ready"); }
  }

  async function vote(winner: string) {
    if (!battleId) return;
    try {
      const result = await api.arena.vote(battleId, winner);
      setVoteResult(result);
      setPhase("voted");
      const winnerName = winner === "model_a" ? result.model_a : winner === "model_b" ? result.model_b : "Tie";
      const deltaA = Math.round((result.elo_after.a - result.elo_before.a) * 10) / 10;
      const deltaB = Math.round((result.elo_after.b - result.elo_before.b) * 10) / 10;
      toast(
        winner === "tie" ? `Tie! Both models ${deltaA >= 0 ? "+" : ""}${deltaA} ELO` :
        `${winnerName} wins! (${deltaA >= 0 ? "+" : ""}${deltaA} / ${deltaB >= 0 ? "+" : ""}${deltaB} ELO)`,
        "success"
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Vote failed");
      toast("Vote failed", "error");
    }
  }

  const eloDelta = (before: number, after: number) => {
    const d = Math.round((after - before) * 10) / 10;
    return d >= 0 ? `+${d}` : `${d}`;
  };

  return (
    <div className="flex flex-col h-full min-h-screen">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/[0.04]">
        <PageHeader icon={<Swords className="w-5 h-5" />} title="Model Arena" description="Blind A/B testing with ELO ratings">
          <Link href="/arena/leaderboard">
            <Button variant="ghost" size="sm" className="gap-1.5">
              <Trophy className="w-3.5 h-3.5 text-amber-400" /> Leaderboard
            </Button>
          </Link>
          <Button onClick={startBattle} variant={phase === "idle" ? "glow" : "primary"} size="sm" className="gap-1.5">
            <RotateCcw className="w-3.5 h-3.5" /> {phase === "idle" ? "Start Battle" : "New Battle"}
          </Button>
        </PageHeader>
      </div>

      {error && (
        <div className="mx-6 mt-3 px-4 py-2.5 rounded-xl bg-red-950/40 border border-red-500/20 text-red-300 text-sm animate-fade-in">
          {error}
        </div>
      )}

      {phase === "idle" ? (
        <EmptyState
          icon={<Swords className="w-12 h-12" />}
          title="Ready to rumble?"
          description="Two random models will compete anonymously. You enter a prompt, both generate responses, and you pick the winner."
          action={<Button onClick={startBattle} variant="glow" size="lg" className="gap-2"><Swords className="w-4 h-4" /> Start Battle</Button>}
          className="flex-1"
        />
      ) : (
        <>
          {/* Prompt input */}
          <div className="px-6 py-3 border-b border-white/[0.04] flex gap-3 items-start">
            <div className="flex-1 flex flex-col gap-1.5">
              <div ref={templateRef} className="relative">
                <button
                  onClick={() => setShowTemplates((v) => !v)}
                  disabled={phase !== "ready"}
                  className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded border border-zinc-700/50 hover:border-zinc-600 bg-zinc-800/60 transition-colors disabled:opacity-50"
                >
                  <BookOpen className="w-3 h-3" />
                  Templates
                  <ChevronDown className={cn("w-3 h-3 transition-transform", showTemplates && "rotate-180")} />
                </button>
                {showTemplates && (
                  <div className="absolute top-full left-0 mt-1 w-96 max-h-80 overflow-y-auto bg-zinc-900 border border-white/10 rounded-lg shadow-2xl z-20">
                    {templates.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-zinc-500">No templates saved. Create some in the Templates page.</div>
                    ) : (
                      templates.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => { setPrompt(t.content); setShowTemplates(false); }}
                          className="w-full text-left px-3 py-2 hover:bg-zinc-800 border-b border-white/5 last:border-0"
                        >
                          <div className="text-xs font-medium text-zinc-100 truncate">{t.name}</div>
                          {t.description && <div className="text-[10px] text-zinc-500 truncate mt-0.5">{t.description}</div>}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              <input
                className="w-full bg-zinc-900/60 border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/20 transition-all"
                placeholder="Enter a prompt for both models…"
                value={prompt} onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && phase === "ready" && sendPrompt()}
                disabled={phase !== "ready"}
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-600 self-end pb-0.5">
              <span>T:</span>
              <input type="number" step="0.1" min="0" max="2"
                className="w-14 bg-zinc-900 border border-white/[0.08] rounded-lg px-2 py-1.5 text-xs text-zinc-400 font-mono"
                value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value) || 0.7)} />
            </div>
            <Button onClick={sendPrompt} disabled={phase !== "ready" || !prompt.trim()} variant="primary" className="gap-1.5 self-end">
              <Send className="w-4 h-4" /> Send
            </Button>
          </div>

          {/* Response panels */}
          <div className="flex-1 flex gap-0 min-h-0">
            {(["a", "b"] as const).map((slot) => {
              const response = slot === "a" ? responseA : responseB;
              const streaming = slot === "a" ? streamingA : streamingB;
              const stats = slot === "a" ? statsA : statsB;
              const ref = slot === "a" ? aRef : bRef;
              const isWinner = voteResult?.winner === `model_${slot}`;
              const isTie = voteResult?.winner === "tie";
              const revealed = phase === "voted" && voteResult;
              const modelName = revealed ? (slot === "a" ? voteResult.model_a : voteResult.model_b) : null;
              const eloBefore = revealed ? (slot === "a" ? voteResult.elo_before.a : voteResult.elo_before.b) : null;
              const eloAfter = revealed ? (slot === "a" ? voteResult.elo_after.a : voteResult.elo_after.b) : null;

              return (
                <div key={slot} className={cn(
                  "flex-1 flex flex-col border-white/[0.04] transition-colors duration-500",
                  slot === "a" ? "border-r" : "",
                  isWinner && "bg-indigo-950/10",
                  isTie && "bg-amber-950/5"
                )}>
                  {/* Panel header */}
                  <div className="px-5 py-3 border-b border-white/[0.04] flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold",
                        isWinner ? "bg-indigo-500/20 text-indigo-300" :
                        isTie ? "bg-amber-500/10 text-amber-300" :
                        "bg-zinc-800/50 text-zinc-500"
                      )}>
                        {slot.toUpperCase()}
                      </span>
                      <div>
                        <span className="text-sm font-medium text-zinc-300">
                          {revealed && modelName ? modelName : `Model ${slot.toUpperCase()}`}
                        </span>
                        {streaming && <span className="ml-2 text-[10px] text-indigo-400">generating…</span>}
                        {isWinner && <span className="ml-2 text-[10px] text-indigo-400 font-semibold">WINNER</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs font-mono text-zinc-600">
                      {stats.ttft_ms != null && <span>TTFT <span className="text-zinc-400">{stats.ttft_ms}ms</span></span>}
                      {stats.tps != null && <span className="text-indigo-400">{stats.tps} tok/s</span>}
                    </div>
                  </div>

                  {/* ELO reveal bar */}
                  {revealed && eloBefore != null && eloAfter != null && (
                    <div className={cn(
                      "px-5 py-2 border-b border-white/[0.04] flex items-center justify-between animate-fade-in",
                      eloAfter > eloBefore ? "bg-emerald-950/20" : eloAfter < eloBefore ? "bg-red-950/20" : "bg-zinc-900/20"
                    )}>
                      <span className="text-xs text-zinc-400">ELO</span>
                      <span className={cn("text-sm font-mono font-semibold",
                        eloAfter > eloBefore ? "text-emerald-400" : eloAfter < eloBefore ? "text-red-400" : "text-zinc-400"
                      )}>
                        {Math.round(eloBefore)} → {Math.round(eloAfter)}
                        <span className="ml-1.5 text-xs">({eloDelta(eloBefore, eloAfter)})</span>
                      </span>
                    </div>
                  )}

                  {/* Response body */}
                  <div ref={ref} className="flex-1 overflow-y-auto px-5 py-4 text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
                    {response || (
                      <span className="text-zinc-700 italic">{phase === "ready" ? "Waiting for prompt…" : ""}</span>
                    )}
                    {streaming && <span className="inline-block w-0.5 h-4 bg-indigo-400 animate-pulse ml-0.5 align-middle" />}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Vote bar */}
          {phase === "done" && (
            <div className="px-6 py-4 border-t border-white/[0.04] bg-zinc-950/80 backdrop-blur-sm animate-fade-in">
              <div className="flex items-center justify-center gap-3">
                <Button onClick={() => vote("model_a")} variant="secondary" size="lg" className="gap-2 min-w-[160px]">
                  <ChevronLeft className="w-4 h-4" /> A is Better
                </Button>
                <Button onClick={() => vote("tie")} variant="ghost" size="lg" className="gap-2 min-w-[100px]">
                  <Minus className="w-4 h-4" /> Tie
                </Button>
                <Button onClick={() => vote("model_b")} variant="secondary" size="lg" className="gap-2 min-w-[160px]">
                  B is Better <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

          {phase === "voted" && (
            <div className="px-6 py-3 border-t border-white/[0.04] flex items-center justify-center animate-fade-in">
              <Button onClick={startBattle} variant="glow" className="gap-2">
                <RotateCcw className="w-4 h-4" /> New Battle
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
