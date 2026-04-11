"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useStatusStore } from "@/lib/stores/status";
import { cn } from "@/lib/utils";
import { Play, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";

const BASE = "http://localhost:7777/api";

type ProblemResult = {
  task_id: string;
  entry_point: string;
  category: string;
  passed: boolean;
  fail_reason: string;
  error: string;
  completion: string;
  elapsed_ms: number;
};

type RunSummary = {
  run_id: string;
  model_id: string;
  total: number;
  completed: number;
  passed: number;
  pass_at_1: number;
  elapsed_s: number;
  by_category: Record<string, { passed: number; total: number }>;
  by_fail_reason: Record<string, number>;
  infra_fails: number;
  legit_fails: number;
  status: string;
  error: string;
};

type LiveResult = ProblemResult & {
  completed: number;
  total: number;
  passed_count: number;
};

const CATEGORY_COLORS: Record<string, string> = {
  Strings:         "text-blue-400",
  Math:            "text-purple-400",
  Algorithms:      "text-indigo-400",
  "Data Structures": "text-cyan-400",
};

export default function HumanEvalPage() {
  const { status } = useStatusStore();
  const [temperature, setTemperature] = useState(0.0);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [running, setRunning] = useState(false);
  const [liveResults, setLiveResults] = useState<LiveResult[]>([]);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [pastRuns, setPastRuns] = useState<RunSummary[]>([]);
  const [selectedRun, setSelectedRun] = useState<(RunSummary & { results: ProblemResult[] }) | null>(null);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [tab, setTab] = useState<"run" | "history">("run");
  const abortRef = useRef<AbortController | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/humaneval/runs`);
      if (r.ok) setPastRuns(await r.json());
    } catch {}
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const runAll = async () => {
    setRunning(true);
    setLiveResults([]);
    setSummary(null);
    abortRef.current = new AbortController();

    try {
      // Start run
      const r = await fetch(`${BASE}/humaneval/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ temperature, max_tokens: maxTokens }),
      });
      if (!r.ok) throw new Error(await r.text());
      const { run_id } = await r.json();

      // Stream results
      const stream = await fetch(`${BASE}/humaneval/run/${run_id}/stream`, {
        signal: abortRef.current.signal,
      });
      const reader = stream.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.replace(/^data: /, "").trim();
          if (!line) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.event === "result") {
              setLiveResults(prev => [...prev, evt as LiveResult]);
            } else if (evt.event === "done") {
              setSummary(evt as RunSummary);
              loadHistory();
            }
          } catch {}
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== "AbortError") console.error(e);
    } finally {
      setRunning(false);
    }
  };

  const loadRunDetail = async (run_id: string) => {
    try {
      const r = await fetch(`${BASE}/humaneval/run/${run_id}`);
      if (r.ok) setSelectedRun(await r.json());
    } catch {}
  };

  const activeModel = status?.active_model_id;
  const liveLatest = liveResults[liveResults.length - 1];
  const liveCompleted = liveLatest?.completed ?? 0;
  const liveTotal = liveLatest?.total ?? 164;
  const livePassed = liveLatest?.passed_count ?? 0;
  const livePct = liveTotal > 0 ? Math.round((liveCompleted / liveTotal) * 100) : 0;
  const livePassPct = liveCompleted > 0 ? ((livePassed / liveCompleted) * 100).toFixed(1) : "—";

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">HumanEval</h1>
          <p className="text-sm text-zinc-500 mt-1">164 Python coding problems · pass@1 vs published leaderboard</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setTab("run")}
            className={cn("px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
              tab === "run" ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-zinc-100")}
          >Run</button>
          <button
            onClick={() => { setTab("history"); loadHistory(); }}
            className={cn("px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
              tab === "history" ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-zinc-100")}
          >History ({pastRuns.length})</button>
        </div>
      </div>

      {tab === "run" && (
        <>
          {/* Config */}
          <div className="border border-white/5 rounded-xl bg-zinc-900/40 p-4">
            <div className="flex items-center gap-6 flex-wrap">
              <div className="space-y-1">
                <label className="text-xs text-zinc-500">Model</label>
                <div className={cn("text-sm font-medium", activeModel ? "text-zinc-100" : "text-zinc-600")}>
                  {activeModel ?? "No model loaded"}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-500">Temperature</label>
                <div className="flex items-center gap-2">
                  <input type="range" min="0" max="1" step="0.05" value={temperature}
                    onChange={e => setTemperature(Number(e.target.value))}
                    className="w-24 accent-indigo-500" disabled={running} />
                  <span className="text-sm font-mono text-zinc-300 w-8">{temperature.toFixed(2)}</span>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-500">Max tokens</label>
                <input
                  type="number" min={256} max={2048} step={128} value={maxTokens}
                  onChange={e => setMaxTokens(Number(e.target.value))}
                  disabled={running}
                  className="w-24 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm font-mono text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div className="ml-auto">
                <button
                  onClick={runAll}
                  disabled={!activeModel || running}
                  className={cn(
                    "flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all",
                    activeModel && !running
                      ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                      : "bg-zinc-800 text-zinc-600 cursor-default"
                  )}
                >
                  <Play className="w-4 h-4" />
                  {running ? "Running…" : "Run HumanEval"}
                </button>
              </div>
            </div>
          </div>

          {/* Live progress */}
          {(running || liveResults.length > 0) && (
            <div className="space-y-3">
              {/* Progress bar + score */}
              <div className="border border-white/5 rounded-xl bg-zinc-900/40 p-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-400">
                    {liveCompleted} / {liveTotal} problems
                    {running && <span className="ml-2 w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse inline-block" />}
                  </span>
                  <span className="font-mono text-zinc-100">
                    {livePassPct}% pass@1
                    <span className="text-zinc-500 ml-2">({livePassed}/{liveCompleted})</span>
                  </span>
                </div>
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                    style={{ width: `${livePct}%` }}
                  />
                </div>
              </div>

              {/* Live results table */}
              <ResultsTable
                results={liveResults}
                expandedTask={expandedTask}
                onToggle={id => setExpandedTask(v => v === id ? null : id)}
              />

              {/* Final summary */}
              {summary && !running && (
                <SummaryCard summary={summary} />
              )}
            </div>
          )}
        </>
      )}

      {tab === "history" && (
        <div className="space-y-3">
          {pastRuns.length === 0 && (
            <div className="text-center text-zinc-600 py-16">No runs yet</div>
          )}
          {pastRuns.map(run => (
            <button
              key={run.run_id}
              onClick={() => { loadRunDetail(run.run_id); }}
              className="w-full text-left border border-white/5 rounded-xl bg-zinc-900/40 hover:border-white/15 p-4 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-zinc-100 truncate">{run.model_id}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{run.completed}/{run.total} problems · {run.elapsed_s}s</div>
                </div>
                <div className="text-right">
                  <div className={cn("text-2xl font-bold font-mono", scoreColor(run.pass_at_1))}>
                    {(run.pass_at_1 * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-zinc-500">pass@1</div>
                </div>
              </div>
            </button>
          ))}

          {/* Run detail modal */}
          {selectedRun && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center pt-12 px-4"
              onClick={() => setSelectedRun(null)}>
              <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col"
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 border-b border-white/5">
                  <div>
                    <div className="text-sm font-semibold text-zinc-100">{selectedRun.model_id}</div>
                    <div className="text-xs text-zinc-500">{selectedRun.completed} problems · {selectedRun.elapsed_s}s</div>
                  </div>
                  <div className={cn("text-3xl font-bold font-mono", scoreColor(selectedRun.pass_at_1))}>
                    {(selectedRun.pass_at_1 * 100).toFixed(1)}%
                  </div>
                </div>
                <div className="p-4 border-b border-white/5">
                  <CategoryBreakdown byCategory={selectedRun.by_category} />
                </div>
                <div className="overflow-y-auto flex-1 p-4">
                  <ResultsTable
                    results={selectedRun.results.map(r => ({ ...r, completed: selectedRun.completed, total: selectedRun.total, passed_count: selectedRun.passed }))}
                    expandedTask={expandedTask}
                    onToggle={id => setExpandedTask(v => v === id ? null : id)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function scoreColor(pct: number) {
  if (pct >= 0.85) return "text-green-400";
  if (pct >= 0.70) return "text-yellow-400";
  if (pct >= 0.50) return "text-orange-400";
  return "text-red-400";
}

const FAIL_REASON_META: Record<string, { label: string; color: string; desc: string }> = {
  assertion: { label: "Wrong answer",  color: "text-red-400 bg-red-900/20 border-red-500/20",    desc: "Code ran but produced incorrect output — genuine model failure" },
  runtime:   { label: "Runtime error", color: "text-orange-400 bg-orange-900/20 border-orange-500/20", desc: "NameError, TypeError, etc. — likely wrong implementation" },
  timeout:   { label: "Timeout",       color: "text-yellow-400 bg-yellow-900/20 border-yellow-500/20", desc: "Infinite loop or too slow" },
  truncated: { label: "Truncated",     color: "text-zinc-400 bg-zinc-800 border-zinc-700",        desc: "Output cut off — infrastructure issue, not model ability" },
  syntax:    { label: "Syntax error",  color: "text-zinc-400 bg-zinc-800 border-zinc-700",        desc: "Code didn't parse — extraction issue" },
  adapter:   { label: "Adapter error", color: "text-zinc-400 bg-zinc-800 border-zinc-700",        desc: "Model inference failed" },
};

function SummaryCard({ summary }: { summary: RunSummary }) {
  const adjustedPass = summary.passed + summary.infra_fails;
  const adjustedPct = summary.completed > 0 ? adjustedPass / summary.completed : 0;

  return (
    <div className="border border-white/10 rounded-xl bg-zinc-900/60 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-zinc-500 mb-1">Final Score</div>
          <div className={cn("text-4xl font-bold font-mono", scoreColor(summary.pass_at_1))}>
            {(summary.pass_at_1 * 100).toFixed(1)}%
          </div>
          <div className="text-sm text-zinc-400 mt-1">
            {summary.passed} / {summary.completed} pass@1
          </div>
          {summary.infra_fails > 0 && (
            <div className="text-xs text-zinc-500 mt-1">
              Best case (infra fixed): ~{(adjustedPct * 100).toFixed(1)}%
            </div>
          )}
        </div>
        <div className="text-right text-xs text-zinc-500 space-y-1">
          <div>Model: <span className="text-zinc-300 font-medium">{summary.model_id.split(":").pop()}</span></div>
          <div>Time: <span className="text-zinc-300">{summary.elapsed_s}s</span></div>
          <div className="text-xs text-zinc-600 mt-2">GPT-4o ~90% · Sonnet ~85% · Llama-3 70B ~70%</div>
        </div>
      </div>

      <CategoryBreakdown byCategory={summary.by_category} />

      {/* Fail breakdown */}
      {Object.keys(summary.by_fail_reason ?? {}).length > 0 && (
        <div>
          <div className="text-xs text-zinc-500 mb-2">Failure breakdown</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(summary.by_fail_reason).map(([reason, count]) => {
              const meta = FAIL_REASON_META[reason];
              return (
                <span
                  key={reason}
                  title={meta?.desc}
                  className={cn("text-xs px-2 py-0.5 rounded border", meta?.color ?? "text-zinc-400 bg-zinc-800 border-zinc-700")}
                >
                  {meta?.label ?? reason}: {count}
                </span>
              );
            })}
          </div>
          {summary.infra_fails > 0 && (
            <div className="text-xs text-zinc-600 mt-1">
              {summary.infra_fails} infra failures (syntax/truncated) don't reflect model ability
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CategoryBreakdown({ byCategory }: { byCategory: Record<string, { passed: number; total: number }> }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {Object.entries(byCategory).map(([cat, stats]) => {
        const pct = stats.total > 0 ? stats.passed / stats.total : 0;
        return (
          <div key={cat} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className={CATEGORY_COLORS[cat] ?? "text-zinc-400"}>{cat}</span>
              <span className="text-zinc-500">{stats.passed}/{stats.total}</span>
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full", pct >= 0.8 ? "bg-green-500" : pct >= 0.6 ? "bg-yellow-500" : "bg-red-500")}
                style={{ width: `${Math.round(pct * 100)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ResultsTable({ results, expandedTask, onToggle }: {
  results: LiveResult[];
  expandedTask: string | null;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="border border-white/5 rounded-xl overflow-hidden">
      <div className="grid grid-cols-[1fr_auto_auto_auto] text-xs text-zinc-500 px-3 py-2 border-b border-white/5 bg-zinc-900/60">
        <span>Problem</span>
        <span className="text-center w-20">Category</span>
        <span className="text-right w-16">Time</span>
        <span className="text-center w-24">Result</span>
      </div>
      <div className="divide-y divide-white/5 max-h-96 overflow-y-auto">
        {results.map(r => (
          <div key={r.task_id}>
            <button
              onClick={() => onToggle(r.task_id)}
              className="w-full grid grid-cols-[1fr_auto_auto_auto] items-center px-3 py-2 hover:bg-zinc-800/40 transition-colors text-left"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {expandedTask === r.task_id
                  ? <ChevronDown className="w-3 h-3 text-zinc-600 shrink-0" />
                  : <ChevronRight className="w-3 h-3 text-zinc-600 shrink-0" />}
                <span className="text-xs font-mono text-zinc-300 truncate">{r.entry_point}</span>
                <span className="text-xs text-zinc-600 shrink-0">{r.task_id}</span>
              </div>
              <span className={cn("text-xs text-center w-20 shrink-0", CATEGORY_COLORS[r.category] ?? "text-zinc-500")}>
                {r.category}
              </span>
              <span className="text-xs font-mono text-zinc-500 text-right w-16 shrink-0">
                {r.elapsed_ms < 1000 ? `${r.elapsed_ms}ms` : `${(r.elapsed_ms / 1000).toFixed(1)}s`}
              </span>
              <div className="flex justify-center w-24 shrink-0">
                {r.passed
                  ? <span className="text-xs font-medium text-green-400 bg-green-900/20 px-2 py-0.5 rounded">PASS</span>
                  : r.fail_reason
                    ? (() => {
                        const meta = FAIL_REASON_META[r.fail_reason];
                        return (
                          <span title={meta?.desc} className={cn("text-xs px-2 py-0.5 rounded border", meta?.color ?? "text-red-400 bg-red-900/20 border-red-500/20")}>
                            {meta?.label ?? r.fail_reason}
                          </span>
                        );
                      })()
                    : <span className="text-xs font-medium text-red-400 bg-red-900/20 px-2 py-0.5 rounded">FAIL</span>}
              </div>
            </button>
            {expandedTask === r.task_id && (
              <div className="px-4 pb-3 space-y-2 bg-zinc-950/50">
                {r.error && (
                  <div>
                    <div className="text-xs text-zinc-500 mb-1">Error</div>
                    <pre className="text-xs text-red-400 bg-red-950/20 rounded p-2 overflow-x-auto whitespace-pre-wrap">{r.error}</pre>
                  </div>
                )}
                {r.completion && (
                  <div>
                    <div className="text-xs text-zinc-500 mb-1">Model output</div>
                    <pre className="text-xs text-zinc-300 bg-zinc-900 rounded p-2 overflow-x-auto whitespace-pre-wrap">{r.completion}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
