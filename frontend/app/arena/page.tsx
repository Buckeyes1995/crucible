"use client";

import { useEffect, useRef, useState } from "react";
import { api, readSSE, type ArenaVoteResult, type PromptTemplate } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Send, Trophy, RotateCcw, Swords, Loader2, ThumbsUp, Minus, ChevronLeft, ChevronRight, BookOpen, ChevronDown, Square } from "lucide-react";
import Link from "next/link";
import { toast } from "@/components/Toast";
import { SaveCodeButton } from "@/components/SaveCodeButton";

type Phase = "idle" | "ready" | "streaming" | "done" | "voted";
type SlotPhase = "idle" | "loading" | "generating" | "done";
type SlotStats = { tps: number | null; ttft_ms: number | null; load_ms?: number | null };

export default function ArenaPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [battleId, setBattleId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [slotCount, setSlotCount] = useState(2);
  // slot ids (canonical from backend): "model_a", "model_b", "slot_2", "slot_3"
  const [slotIds, setSlotIds] = useState<string[]>(["model_a", "model_b"]);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<Record<string, SlotStats>>({});
  const [slotPhases, setSlotPhases] = useState<Record<string, SlotPhase>>({});
  const slotRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Back-compat aliases so nothing below has to be rewritten.
  const responseA = responses["model_a"] ?? "";
  const responseB = responses["model_b"] ?? "";
  const statsA = stats["model_a"] ?? { tps: null, ttft_ms: null };
  const statsB = stats["model_b"] ?? { tps: null, ttft_ms: null };
  const phaseA = slotPhases["model_a"] ?? "idle";
  const phaseB = slotPhases["model_b"] ?? "idle";
  const streamingA = phaseA === "loading" || phaseA === "generating";
  const streamingB = phaseB === "loading" || phaseB === "generating";
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
  const [maxTokens, setMaxTokens] = useState(4096);
  // "uniform"  = fair: thinking disabled, baseline sampling on both slots
  // "per_model" = each model runs with its own saved params (realistic)
  const [normMode, setNormMode] = useState<"uniform" | "per_model">("uniform");
  // Back-compat aliases for legacy refs used deeper in the file.
  const aRef = { current: slotRefs.current["model_a"] ?? null } as React.MutableRefObject<HTMLDivElement | null>;
  const bRef = { current: slotRefs.current["model_b"] ?? null } as React.MutableRefObject<HTMLDivElement | null>;
  void aRef; void bRef;
  const abortRef = useRef<AbortController | null>(null);

  function resetBattleState(ids: string[]) {
    setSlotIds(ids);
    setResponses(Object.fromEntries(ids.map(id => [id, ""])));
    setStats(Object.fromEntries(ids.map(id => [id, { tps: null, ttft_ms: null, load_ms: null }])));
    setSlotPhases(Object.fromEntries(ids.map(id => [id, "idle" as SlotPhase])));
  }

  async function startBattle() {
    setError(null);
    setVoteResult(null); setPrompt("");
    try {
      const result = await api.arena.startBattle(slotCount);
      setBattleId(result.battle_id);
      const ids = result.slots?.map(s => s.slot_id) ?? ["model_a", "model_b"];
      resetBattleState(ids);
      setPhase("ready");
      toast(`Battle ready — ${ids.length} models waiting`, "info");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start battle");
      toast("Failed to start battle", "error");
    }
  }

  async function sendPrompt() {
    if (!battleId || !prompt.trim()) return;
    setPhase("streaming");
    // Reset response + stats for all slots; first slot starts "loading"
    setResponses(Object.fromEntries(slotIds.map(id => [id, ""])));
    setStats(Object.fromEntries(slotIds.map(id => [id, { tps: null, ttft_ms: null, load_ms: null }])));
    setSlotPhases(Object.fromEntries(slotIds.map((id, i) => [id, i === 0 ? "loading" : "idle"])));
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const resp = await api.arena.chat(
        battleId,
        { prompt: prompt.trim(), temperature, max_tokens: maxTokens, norm_mode: normMode },
        controller.signal,
      );
      await readSSE(resp, (data) => {
        const slot = data.slot as string;
        const event = data.event as string;
        if (!slot && event !== "complete") return;
        if (event === "slot_start") {
          setSlotPhases(prev => ({ ...prev, [slot]: "loading" }));
        } else if (event === "heartbeat") {
          const ph: SlotPhase = (data.phase as string) === "generating" ? "generating" : "loading";
          setSlotPhases(prev => ({ ...prev, [slot]: ph }));
        } else if (event === "token") {
          const token = data.token as string;
          setResponses(prev => ({ ...prev, [slot]: (prev[slot] ?? "") + token }));
          setSlotPhases(prev => ({ ...prev, [slot]: "generating" }));
          const el = slotRefs.current[slot];
          el?.scrollTo(0, el.scrollHeight);
        } else if (event === "done") {
          setStats(prev => ({ ...prev, [slot]: {
            tps: data.tps as number | null,
            ttft_ms: data.ttft_ms as number | null,
            load_ms: (data.load_ms as number | null) ?? null,
          }}));
          setSlotPhases(prev => ({ ...prev, [slot]: "done" }));
        } else if (event === "cancelled") {
          setSlotPhases(prev => ({ ...prev, [slot]: "idle" }));
        } else if (event === "error") {
          setSlotPhases(prev => ({ ...prev, [slot]: "idle" }));
          setError(`${slot}: ${(data.message as string) || "error"}`);
        } else if (event === "complete") {
          setPhase("done");
        }
      });
      setPhase("done");
    } catch (e) {
      const err = e as Error;
      const aborted = err.name === "AbortError" || controller.signal.aborted;
      if (aborted) {
        setPhase("ready");
        toast("Battle cancelled", "info");
      } else {
        setError(err.message || "Stream failed");
        setPhase("ready");
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function stopPrompt() {
    abortRef.current?.abort();
  }

  async function vote(winner: string) {
    if (!battleId) return;
    try {
      const result = await api.arena.vote(battleId, winner);
      setVoteResult(result);
      setPhase("voted");
      if (winner === "tie") {
        toast("Tie — ELO held steady on all slots", "success");
      } else {
        const ws = result.slots?.find(s => s.slot_id === winner);
        const name = ws?.display
          ?? (winner === "model_a" ? result.model_a : winner === "model_b" ? result.model_b : winner);
        const d = ws ? Math.round((ws.elo_after - ws.elo_before) * 10) / 10 : null;
        const prefix = d != null ? ` (${d >= 0 ? "+" : ""}${d} ELO)` : "";
        toast(`${name} wins!${prefix}`, "success");
      }
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
              <span className="ml-2">Max</span>
              <input type="number" min="128" max="32768" step="512"
                className="w-20 bg-zinc-900 border border-white/[0.08] rounded-lg px-2 py-1.5 text-xs text-zinc-400 font-mono"
                value={maxTokens} onChange={(e) => setMaxTokens(parseInt(e.target.value) || 4096)} />
              <select
                value={normMode}
                onChange={(e) => setNormMode(e.target.value as "uniform" | "per_model")}
                title="uniform: fair (thinking off, baseline sampling on both) · per_model: each uses its own params"
                className="ml-2 bg-zinc-900 border border-white/[0.08] rounded-lg px-2 py-1.5 text-xs text-zinc-400"
              >
                <option value="uniform">fair</option>
                <option value="per_model">per-model</option>
              </select>
              <span className="ml-2">Slots</span>
              <select
                value={slotCount}
                onChange={(e) => setSlotCount(parseInt(e.target.value))}
                disabled={phase === "streaming"}
                title="Number of models per battle — takes effect on the next New Battle."
                className="bg-zinc-900 border border-white/[0.08] rounded-lg px-2 py-1.5 text-xs text-zinc-400 disabled:opacity-50"
              >
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
              </select>
            </div>
            {phase === "streaming" ? (
              <Button onClick={stopPrompt} variant="destructive" className="gap-1.5 self-end">
                <Square className="w-3.5 h-3.5 fill-current" /> Stop
              </Button>
            ) : (
              <Button onClick={sendPrompt} disabled={phase !== "ready" || !prompt.trim()} variant="primary" className="gap-1.5 self-end">
                <Send className="w-4 h-4" /> Send
              </Button>
            )}
          </div>

          {/* Response panels — N-slot grid (2: side-by-side, 3: row, 4: 2x2) */}
          <div className={cn(
            "flex-1 grid gap-0 min-h-0",
            slotIds.length === 2 ? "grid-cols-2" :
            slotIds.length === 3 ? "grid-cols-3" :
            "grid-cols-2 grid-rows-2",
          )}>
            {slotIds.map((slot, i) => {
              const response = responses[slot] ?? "";
              const phaseX = slotPhases[slot] ?? "idle";
              const streaming = phaseX === "loading" || phaseX === "generating";
              const stx = stats[slot] ?? { tps: null, ttft_ms: null };
              const isWinner = voteResult?.winner === slot;
              const isTie = voteResult?.winner === "tie";
              const revealed = phase === "voted" && voteResult;
              const resultSlot = voteResult?.slots?.find(s => s.slot_id === slot);
              const modelName = revealed ? (
                resultSlot?.display ?? (
                  slot === "model_a" ? voteResult.model_a :
                  slot === "model_b" ? voteResult.model_b : null
                )
              ) : null;
              const eloBefore = revealed ? (
                resultSlot?.elo_before ?? (
                  slot === "model_a" ? voteResult.elo_before.a :
                  slot === "model_b" ? voteResult.elo_before.b : null
                )
              ) : null;
              const eloAfter = revealed ? (
                resultSlot?.elo_after ?? (
                  slot === "model_a" ? voteResult.elo_after.a :
                  slot === "model_b" ? voteResult.elo_after.b : null
                )
              ) : null;
              // Visible label: A/B/C/D
              const letter = String.fromCharCode(65 + i);

              return (
                <div key={slot} className={cn(
                  "flex flex-col border-white/[0.04] transition-colors duration-500 min-h-0",
                  // Grid lines between slots
                  i < slotIds.length - 1 && "border-r",
                  isWinner && "bg-indigo-950/10",
                  isTie && "bg-amber-950/5",
                )}>
                  {/* Panel header */}
                  <div className="px-5 py-3 border-b border-white/[0.04] flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold",
                        isWinner ? "bg-indigo-500/20 text-indigo-300" :
                        isTie ? "bg-amber-500/10 text-amber-300" :
                        "bg-zinc-800/50 text-zinc-500",
                      )}>
                        {letter}
                      </span>
                      <div>
                        <span className="text-sm font-medium text-zinc-300">
                          {revealed && modelName ? modelName : `Model ${letter}`}
                        </span>
                        {streaming && (() => {
                          const label =
                            phaseX === "loading" ? "loading weights…"
                            : phaseX === "generating" ? "generating…"
                            : "starting…";
                          return <span className="ml-2 text-[10px] text-indigo-400">{label}</span>;
                        })()}
                        {phase === "streaming" && !streaming && !response && (
                          <span className="ml-2 text-[10px] text-zinc-500">waiting…</span>
                        )}
                        {isWinner && <span className="ml-2 text-[10px] text-indigo-400 font-semibold">WINNER</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs font-mono text-zinc-600">
                      {stx.load_ms != null && stx.load_ms > 100 && (
                        <span title="Cold model load time before inference — excluded from TTFT below">
                          Load <span className="text-zinc-400">{(stx.load_ms / 1000).toFixed(1)}s</span>
                        </span>
                      )}
                      {stx.ttft_ms != null && <span>TTFT <span className="text-zinc-400">{stx.ttft_ms}ms</span></span>}
                      {stx.tps != null && <span className="text-indigo-400">{stx.tps} tok/s</span>}
                      {!streaming && response && battleId && (
                        <SaveCodeButton
                          text={response}
                          source="arena"
                          runId={battleId}
                          subdir={slot}
                          filenamePrefix="code"
                        />
                      )}
                    </div>
                  </div>

                  {/* ELO reveal bar */}
                  {revealed && eloBefore != null && eloAfter != null && (
                    <div className={cn(
                      "px-5 py-2 border-b border-white/[0.04] flex items-center justify-between animate-fade-in",
                      eloAfter > eloBefore ? "bg-emerald-950/20" : eloAfter < eloBefore ? "bg-red-950/20" : "bg-zinc-900/20",
                    )}>
                      <span className="text-xs text-zinc-400">ELO</span>
                      <span className={cn("text-sm font-mono font-semibold",
                        eloAfter > eloBefore ? "text-emerald-400" : eloAfter < eloBefore ? "text-red-400" : "text-zinc-400",
                      )}>
                        {Math.round(eloBefore)} → {Math.round(eloAfter)}
                        <span className="ml-1.5 text-xs">({eloDelta(eloBefore, eloAfter)})</span>
                      </span>
                    </div>
                  )}

                  {/* Response body */}
                  <div
                    ref={(el) => { slotRefs.current[slot] = el; }}
                    className="flex-1 overflow-y-auto px-5 py-4 text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap"
                  >
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
              <div className="flex items-center justify-center gap-2 flex-wrap">
                {slotIds.map((slot, i) => {
                  const letter = String.fromCharCode(65 + i);
                  return (
                    <Button
                      key={slot}
                      onClick={() => vote(slot)}
                      variant="secondary"
                      size="lg"
                      className="gap-2 min-w-[140px]"
                    >
                      {i === 0 && <ChevronLeft className="w-4 h-4" />}
                      {letter} is Better
                      {i === slotIds.length - 1 && <ChevronRight className="w-4 h-4" />}
                    </Button>
                  );
                })}
                <Button onClick={() => vote("tie")} variant="ghost" size="lg" className="gap-2 min-w-[100px]">
                  <Minus className="w-4 h-4" /> Tie
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
