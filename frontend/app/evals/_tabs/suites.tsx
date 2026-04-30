"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/Toast";
import { cn } from "@/lib/utils";
import { useModelsStore } from "@/lib/stores/models";
import {
  FlaskConical, Play, Loader2, X as XIcon, Trophy, TrendingUp,
  ExternalLink, CheckCircle2, XCircle,
} from "lucide-react";

type Suite = {
  id: string;
  name: string;
  description: string;
  size_available: number;
  size_default: number;
  run_endpoint: string;
  history_endpoint: string;
  route?: string;
  docs_url?: string;
};

type HistoryEntry = {
  run_id: string;
  suite: string;
  model_id?: string | null;
  correct: number;
  total: number;
  accuracy: number;
  elapsed_ms?: number;
  finished_at?: number;
};

type LiveItem = {
  i: number;
  question: string;
  expected: string;
  response: string;
  got: string | null;
  correct: boolean;
  running_accuracy: number;
};

export default function SuitesTab() {
  const [suites, setSuites] = useState<Suite[]>([]);
  const [history, setHistory] = useState<Record<string, HistoryEntry[]>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [liveItems, setLiveItems] = useState<LiveItem[]>([]);
  const [liveSummary, setLiveSummary] = useState<string>("");
  const [liveSuite, setLiveSuite] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const activeModelId = useModelsStore((s) => s.activeModelId);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/evals/suites");
      if (!r.ok) return;
      const sx: Suite[] = await r.json();
      setSuites(sx);
      const hist: Record<string, HistoryEntry[]> = {};
      await Promise.all(sx.map(async s => {
        try {
          const hr = await fetch(s.history_endpoint);
          if (hr.ok) {
            const rows = await hr.json();
            hist[s.id] = Array.isArray(rows) ? rows : [];
          }
        } catch {}
      }));
      setHistory(hist);
    } catch {}
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const runGsm8k = async (limit: number) => {
    if (!activeModelId) {
      toast("Load a model first", "error");
      return;
    }
    setRunning("gsm8k");
    setLiveSuite("gsm8k");
    setLiveItems([]);
    setLiveSummary("starting…");
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const r = await fetch("/api/evals/gsm8k/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit }),
        signal: ctl.signal,
      });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        if (value) buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of chunk.split("\n")) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const payload = t.slice(5).trim();
            if (!payload) continue;
            try {
              const evt = JSON.parse(payload);
              if (evt.event === "started") {
                setLiveSummary(`0 / ${evt.total}`);
              } else if (evt.event === "item") {
                setLiveItems(cur => [...cur, evt as LiveItem]);
                setLiveSummary(`${evt.i} / ? · acc ${(evt.running_accuracy * 100).toFixed(0)}%`);
              } else if (evt.event === "finished") {
                setLiveSummary(`done — ${evt.correct}/${evt.total} · acc ${(evt.accuracy * 100).toFixed(1)}%`);
                toast(`GSM8K: ${evt.correct}/${evt.total} (${(evt.accuracy * 100).toFixed(1)}%)`, "success");
              }
            } catch {}
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast(`GSM8K failed: ${(e as Error).message}`, "error");
    } finally {
      abortRef.current = null;
      setRunning(null);
      refresh();
    }
  };

  const stopLive = () => abortRef.current?.abort();

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-white/[0.04]">
        <PageHeader
          icon={<FlaskConical className="w-5 h-5" />}
          title="Evals"
          description="Run standard benchmarks against the active model"
        />
        {!activeModelId && (
          <div className="mt-2 text-xs text-amber-400">
            No model loaded — evals will fail. Load one from /models first.
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {suites.map(s => {
          const isGsm = s.id === "gsm8k";
          const suiteHistory = history[s.id] ?? [];
          const last = suiteHistory.length > 0 ? suiteHistory[suiteHistory.length - 1] : null;
          const best = suiteHistory.reduce<HistoryEntry | null>((b, h) => !b || h.accuracy > b.accuracy ? h : b, null);
          return (
            <section key={s.id} className="rounded-xl border border-white/10 bg-zinc-950 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h2 className="text-base font-semibold text-zinc-100">{s.name}</h2>
                  <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{s.description}</p>
                  {s.docs_url && (
                    <a href={s.docs_url} target="_blank" rel="noreferrer"
                       className="text-[11px] text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1 mt-1">
                      Reference <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  {isGsm ? (
                    running === "gsm8k" ? (
                      <Button variant="destructive" size="sm" onClick={stopLive} className="gap-1.5">
                        <XIcon className="w-3.5 h-3.5" /> Stop
                      </Button>
                    ) : (
                      <Button
                        variant="primary" size="sm"
                        onClick={() => runGsm8k(s.size_default)}
                        disabled={!activeModelId || !!running}
                        className="gap-1.5"
                      >
                        <Play className="w-3.5 h-3.5" /> Run {s.size_default}
                      </Button>
                    )
                  ) : (
                    s.route && (
                      <Link href={s.route}>
                        <Button variant="primary" size="sm" className="gap-1.5">
                          <Play className="w-3.5 h-3.5" /> Open runner
                        </Button>
                      </Link>
                    )
                  )}
                </div>
              </div>

              {/* Live trace only for the currently-running suite */}
              {isGsm && running === "gsm8k" && (
                <div className="mt-3 rounded-lg border border-indigo-500/30 bg-indigo-950/15 p-3">
                  <div className="text-[11px] text-indigo-300 font-mono mb-2 flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" /> {liveSummary || "running…"}
                  </div>
                  <div className="space-y-1 max-h-[260px] overflow-y-auto font-mono text-[10px]">
                    {liveItems.slice(-20).map(item => (
                      <div key={item.i} className="flex items-start gap-2">
                        {item.correct
                          ? <CheckCircle2 className="w-3 h-3 mt-0.5 text-emerald-400 shrink-0" />
                          : <XCircle className="w-3 h-3 mt-0.5 text-red-400 shrink-0" />}
                        <span className="text-zinc-500 shrink-0">#{item.i}</span>
                        <span className="text-zinc-300 truncate flex-1" title={item.question}>{item.question}</span>
                        <span className="text-zinc-500 shrink-0">expect={item.expected}</span>
                        <span className={cn("shrink-0", item.correct ? "text-emerald-400" : "text-red-400")}>got={item.got ?? "—"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* History strip */}
              {suiteHistory.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 items-center">
                  {best && (
                    <span className="text-[11px] bg-amber-900/20 text-amber-300 border border-amber-500/30 rounded px-2 py-0.5 flex items-center gap-1 font-mono">
                      <Trophy className="w-3 h-3" />
                      best {(best.accuracy * 100).toFixed(1)}% · {best.model_id?.replace(/^mlx:/, "") ?? "?"}
                    </span>
                  )}
                  {last && (
                    <span className="text-[11px] bg-zinc-900 text-zinc-300 border border-white/10 rounded px-2 py-0.5 flex items-center gap-1 font-mono">
                      <TrendingUp className="w-3 h-3" />
                      last {(last.accuracy * 100).toFixed(1)}% · {last.model_id?.replace(/^mlx:/, "") ?? "?"} · {new Date((last.finished_at ?? 0) * 1000).toLocaleDateString()}
                    </span>
                  )}
                  <span className="text-[10px] text-zinc-600">{suiteHistory.length} run{suiteHistory.length === 1 ? "" : "s"} total</span>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
