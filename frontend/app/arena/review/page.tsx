"use client";

// Review queue for autobattle-generated pending battles. Arrow keys let you
// vote through a stack of battles quickly — ←/→ for A/B, ↓ for tie, space to
// skip. Each vote updates ELO normally, same as a live arena battle.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Swords, ThumbsUp, Minus, SkipForward, Plus, Loader2, StopCircle, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { toast } from "@/components/Toast";

type Pending = {
  id: string; model_a: string; model_b: string; prompt: string;
  response_a: string; response_b: string; created_at: string;
};
type Job = Awaited<ReturnType<typeof api.arena.autobattle.listJobs>>[number];

export default function ReviewPage() {
  const [pending, setPending] = useState<Pending[]>([]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [jobs, setJobs] = useState<Job[]>([]);
  const [count, setCount] = useState(20);
  const [starting, setStarting] = useState(false);
  const [voting, setVoting] = useState<string | null>(null);

  const loadPending = useCallback(() => {
    api.arena.pending().then(setPending).catch(() => {});
  }, []);
  const loadJobs = useCallback(() => {
    api.arena.autobattle.listJobs().then(setJobs).catch(() => {});
  }, []);

  useEffect(() => {
    loadPending();
    loadJobs();
    const id = setInterval(() => { loadPending(); loadJobs(); }, 5000);
    return () => clearInterval(id);
  }, [loadPending, loadJobs]);

  const queue = pending.filter((p) => !skipped.has(p.id));
  const current = queue[0];

  const vote = useCallback(async (winner: "model_a" | "model_b" | "tie") => {
    if (!current || voting) return;
    setVoting(current.id);
    try {
      await api.arena.votePending(current.id, winner);
      toast(
        winner === "tie" ? "Tie recorded"
          : `Voted ${winner === "model_a" ? current.model_a : current.model_b}`,
        "success",
      );
      loadPending();
    } catch (e) {
      toast(`Vote failed: ${(e as Error).message}`, "error");
    } finally {
      setVoting(null);
    }
  }, [current, voting, loadPending]);

  const skip = useCallback(() => {
    if (!current) return;
    setSkipped((s) => new Set(s).add(current.id));
  }, [current]);

  // Keyboard shortcuts: ←/→ vote A/B, ↓ tie, space skip.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (voting) return;
      if (e.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); vote("model_a"); }
      else if (e.key === "ArrowRight") { e.preventDefault(); vote("model_b"); }
      else if (e.key === "ArrowDown") { e.preventDefault(); vote("tie"); }
      else if (e.key === " ") { e.preventDefault(); skip(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [vote, skip, voting]);

  const startBatch = async () => {
    setStarting(true);
    try {
      const r = await api.arena.autobattle.start({ count });
      toast(`Queued ${r.target} battles (job ${r.job_id})`, "success");
      loadJobs();
    } catch (e) {
      toast(`Failed to start: ${(e as Error).message}`, "error");
    } finally {
      setStarting(false);
    }
  };

  const cancelJob = async (id: string) => {
    try { await api.arena.autobattle.cancel(id); loadJobs(); } catch {}
  };

  const activeJob = jobs.find((j) => j.status === "running");

  return (
    <div className="flex flex-col h-full min-h-screen">
      <div className="px-6 py-4 border-b border-white/[0.04] flex items-center gap-3">
        <Swords className="w-5 h-5 text-indigo-400" />
        <h1 className="text-lg font-semibold text-zinc-100">Arena review queue</h1>
        <span className="text-xs text-zinc-500">{queue.length} pending</span>
        <Link href="/arena" className="text-xs text-zinc-500 hover:text-zinc-300 ml-auto">← Arena</Link>
      </div>

      {/* Autobattle control strip */}
      <div className="px-6 py-3 border-b border-white/[0.04] flex items-center gap-3 bg-zinc-950/60">
        <input
          type="number" min={1} max={200} value={count}
          onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 20))}
          className="w-16 rounded border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 font-mono"
        />
        <Button variant="primary" size="sm" onClick={startBatch} disabled={starting} className="gap-1.5">
          {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Queue {count} battles
        </Button>
        {activeJob && (
          <div className="ml-auto flex items-center gap-3 text-xs text-zinc-400">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
              <span className="font-mono">{activeJob.completed}/{activeJob.target}</span>
              {activeJob.errors > 0 && <span className="text-amber-400">· {activeJob.errors} err</span>}
            </span>
            <span className="text-zinc-600 truncate max-w-[320px]">{activeJob.last_message}</span>
            <Button variant="ghost" size="xs" className="gap-1 text-red-400" onClick={() => cancelJob(activeJob.id)}>
              <StopCircle className="w-3 h-3" /> Stop
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {!current ? (
          <div className="flex flex-col items-center justify-center py-24 text-center text-zinc-500">
            {pending.length === 0 ? (
              <>
                <Swords className="w-10 h-10 text-zinc-700 mb-3" />
                <p className="text-sm">No pending battles.</p>
                <p className="text-xs text-zinc-600 mt-1">Queue a batch above to generate some overnight.</p>
              </>
            ) : (
              <>
                <p className="text-sm">Skipped every remaining battle this session.</p>
                <Button variant="ghost" size="sm" className="mt-3" onClick={() => setSkipped(new Set())}>
                  Reset skipped
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-xs text-zinc-500 flex items-center justify-between">
              <span className="truncate">{current.prompt}</span>
              <span className="font-mono shrink-0 ml-3">{queue.length} left</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(["a", "b"] as const).map((slot) => {
                const txt = slot === "a" ? current.response_a : current.response_b;
                return (
                  <div key={slot} className="rounded-2xl border border-white/[0.06] bg-zinc-900/50 overflow-hidden flex flex-col">
                    <div className="px-4 py-2 border-b border-white/[0.04] flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold bg-zinc-800/80 text-zinc-400">
                        {slot.toUpperCase()}
                      </span>
                      <span className="text-sm text-zinc-400">Model {slot.toUpperCase()}</span>
                    </div>
                    <div className="p-4 font-mono text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed flex-1 min-h-[200px]">
                      {txt || <span className="text-zinc-600 italic">(no response)</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-center gap-3 pt-2">
              <Button variant="primary" className="gap-1.5" disabled={!!voting} onClick={() => vote("model_a")}>
                <ThumbsUp className="w-3.5 h-3.5" /> A wins  <kbd className="ml-2 text-[10px] opacity-60">←</kbd>
              </Button>
              <Button variant="secondary" className="gap-1.5" disabled={!!voting} onClick={() => vote("tie")}>
                <Minus className="w-3.5 h-3.5" /> Tie  <kbd className="ml-2 text-[10px] opacity-60">↓</kbd>
              </Button>
              <Button variant="primary" className="gap-1.5" disabled={!!voting} onClick={() => vote("model_b")}>
                <ThumbsUp className="w-3.5 h-3.5" /> B wins  <kbd className="ml-2 text-[10px] opacity-60">→</kbd>
              </Button>
              <Button variant="ghost" className="gap-1.5" disabled={!!voting} onClick={skip}>
                <SkipForward className="w-3.5 h-3.5" /> Skip  <kbd className="ml-2 text-[10px] opacity-60">space</kbd>
              </Button>
            </div>
            <p className="text-center text-[10px] text-zinc-600">
              Model names stay hidden until the battle is persisted; vote on content alone.
            </p>
          </div>
        )}
      </div>

      {jobs.length > 0 && (
        <div className="border-t border-white/[0.04] px-6 py-3 bg-zinc-950/60 text-xs text-zinc-500 flex items-center gap-4 overflow-x-auto">
          <span className="shrink-0">Recent jobs:</span>
          {jobs.slice(0, 8).map((j) => (
            <span key={j.id} className="shrink-0 font-mono">
              <span className={j.status === "running" ? "text-indigo-400"
                : j.status === "done" ? "text-emerald-400"
                : j.status === "cancelled" ? "text-zinc-500"
                : "text-red-400"}>{j.status}</span>
              <span className="text-zinc-600"> · </span>
              <span>{j.completed}/{j.target}</span>
              {j.errors > 0 && <><span className="text-zinc-600"> · </span><span className="text-amber-400"><AlertTriangle className="w-3 h-3 inline mr-0.5" />{j.errors}</span></>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
