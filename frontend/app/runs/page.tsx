"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/Toast";
import { cn } from "@/lib/utils";
import { useModelsStore } from "@/lib/stores/models";
import { useProjectsStore, projectQuery } from "@/lib/stores/projects";
import {
  Bot, Play, Loader2, X as XIcon, ChevronRight, CircleCheck, CircleX,
  Wrench, MessageSquare, Brain, Sparkles, Trash2, PlusCircle,
} from "lucide-react";

type StepKind = "thought" | "tool_call" | "tool_result" | "final" | "error";

type Step = {
  id?: number;
  step_index: number;
  kind: StepKind;
  name?: string | null;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  error?: string | null;
  started_at?: string;
  tokens?: number;
};

type Run = {
  id: string;
  goal: string;
  model_id?: string | null;
  project_id?: string | null;
  status: "running" | "done" | "error" | "cancelled";
  final_answer?: string | null;
  error?: string | null;
  total_tokens?: number;
  elapsed_ms?: number;
  created_at: string;
  finished_at?: string | null;
  tool_allowlist_json?: string | null;
  steps?: Step[];
};

type InstalledMcp = { id: string; name: string };

export default function AgentRunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [liveSteps, setLiveSteps] = useState<Step[]>([]);
  const [liveRunId, setLiveRunId] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const activeProject = useProjectsStore((s) => s.activeId);
  const activeModelId = useModelsStore((s) => s.activeModelId);

  const refresh = useCallback(async () => {
    try {
      const q = projectQuery(activeProject);
      const url = q ? `/api/agents/runs?${q}` : "/api/agents/runs";
      const r = await fetch(url);
      if (r.ok) setRuns(await r.json());
    } finally {
      setLoading(false);
    }
  }, [activeProject]);

  useEffect(() => { refresh(); }, [refresh]);

  const openRun = async (id: string) => {
    try {
      const r = await fetch(`/api/agents/runs/${id}`);
      if (r.ok) setSelected(await r.json());
    } catch {}
  };

  const deleteRun = async (id: string) => {
    if (!confirm("Delete this run?")) return;
    await fetch(`/api/agents/runs/${id}`, { method: "DELETE" });
    if (selected?.id === id) setSelected(null);
    await refresh();
  };

  const startRun = async (body: { goal: string; tool_allowlist: string[] | null; max_steps: number; max_tokens: number }) => {
    if (!activeModelId) {
      toast("Load a model first — the agent uses it for decision-making.", "error");
      return;
    }
    setNewOpen(false);
    setLiveSteps([]);
    setLiveRunId(null);
    setLiveStatus("starting…");
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const proj = activeProject && activeProject !== "__none__" ? activeProject : null;
      const r = await fetch("/api/agents/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, project_id: proj }),
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
            let evt: Record<string, unknown>;
            try { evt = JSON.parse(payload); } catch { continue; }
            if (evt.event === "run_started") {
              setLiveRunId(evt.run_id as string);
              setLiveStatus("running");
            } else if (evt.event === "step") {
              setLiveSteps((cur) => [...cur, evt as unknown as Step]);
            } else if (evt.event === "run_finished") {
              const st = evt.status as string;
              setLiveStatus(st);
              if (st === "done") toast("Agent finished", "success");
              else toast(`Agent ${st}: ${evt.error ?? ""}`, "error");
            }
          }
        }
      }
      await refresh();
      if (liveRunId) await openRun(liveRunId);
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast(`Run failed: ${(e as Error).message}`, "error");
      setLiveStatus("cancelled");
    } finally {
      abortRef.current = null;
    }
  };

  const stopLive = () => abortRef.current?.abort();

  return (
    <div className="flex h-full min-h-screen">
      <div className="w-96 border-r border-white/[0.04] flex flex-col">
        <div className="px-4 py-3 border-b border-white/[0.04]">
          <PageHeader
            icon={<Bot className="w-5 h-5" />}
            title="Agent Runs"
            description="ReAct loops over your installed MCP tools"
          >
            <Button variant="primary" size="sm" onClick={() => setNewOpen(true)} className="gap-1.5">
              <PlusCircle className="w-3.5 h-3.5" /> New run
            </Button>
          </PageHeader>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-4 text-xs text-zinc-500">Loading…</p>
          ) : runs.length === 0 ? (
            <p className="p-6 text-sm text-zinc-500 text-center">
              No runs yet. Click <strong>New run</strong> to set an agent loose on a goal.
            </p>
          ) : (
            <ul>
              {runs.map(r => (
                <li
                  key={r.id}
                  onClick={() => openRun(r.id)}
                  className={cn(
                    "group px-4 py-2.5 border-b border-white/[0.04] cursor-pointer hover:bg-zinc-900/60",
                    selected?.id === r.id && "bg-indigo-950/20",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <StatusDot status={r.status} />
                    <span className="text-sm text-zinc-200 truncate flex-1">{r.goal}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteRun(r.id); }}
                      className="text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100"
                      title="Delete"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="flex gap-2 text-[10px] text-zinc-500 mt-0.5 font-mono">
                    <span>{new Date(r.created_at).toLocaleString()}</span>
                    {r.elapsed_ms != null && <span>· {(r.elapsed_ms / 1000).toFixed(1)}s</span>}
                    {r.total_tokens ? <span>· {r.total_tokens} tok</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {liveRunId && liveStatus !== "done" && liveStatus !== "error" && liveStatus !== "cancelled" ? (
          <LiveTrace
            runId={liveRunId}
            steps={liveSteps}
            status={liveStatus}
            onStop={stopLive}
          />
        ) : selected ? (
          <RunDetail run={selected} />
        ) : liveSteps.length > 0 ? (
          <LiveTrace runId={liveRunId ?? ""} steps={liveSteps} status={liveStatus} onStop={stopLive} />
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
            Pick a run on the left, or click <strong className="mx-1 text-zinc-300">New run</strong> to start one.
          </div>
        )}
      </div>

      {newOpen && (
        <NewRunDialog onClose={() => setNewOpen(false)} onStart={startRun} />
      )}
    </div>
  );
}

function StatusDot({ status }: { status: Run["status"] }) {
  const cls =
    status === "running" ? "bg-indigo-400 animate-pulse"
    : status === "done" ? "bg-emerald-400"
    : status === "error" ? "bg-red-400"
    : "bg-zinc-500";
  return <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", cls)} />;
}

function LiveTrace({ runId, steps, status, onStop }: {
  runId: string; steps: Step[]; status: string; onStop: () => void;
}) {
  return (
    <div className="px-6 py-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
            Running
          </h2>
          <p className="text-[11px] text-zinc-500 font-mono mt-0.5">
            {runId || "starting…"} · {status}
          </p>
        </div>
        <Button variant="destructive" size="sm" onClick={onStop} className="gap-1.5">
          <XIcon className="w-3.5 h-3.5" /> Stop
        </Button>
      </div>
      <StepsList steps={steps} />
    </div>
  );
}

function RunDetail({ run }: { run: Run }) {
  return (
    <div className="px-6 py-5">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
          <StatusDot status={run.status} />
          {run.goal}
        </h2>
        <div className="flex flex-wrap gap-3 text-[11px] text-zinc-500 mt-1 font-mono">
          <span>{new Date(run.created_at).toLocaleString()}</span>
          {run.model_id && <span>· {run.model_id.replace(/^mlx:/, "")}</span>}
          {run.elapsed_ms != null && <span>· {(run.elapsed_ms / 1000).toFixed(1)}s</span>}
          {run.total_tokens ? <span>· {run.total_tokens} tok</span> : null}
        </div>
      </div>

      {run.final_answer && (
        <section className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4">
          <h3 className="text-xs uppercase tracking-wider text-emerald-400 font-semibold mb-2">Final answer</h3>
          <pre className="text-sm text-zinc-100 whitespace-pre-wrap leading-relaxed">{run.final_answer}</pre>
        </section>
      )}
      {run.error && (
        <section className="mb-4 rounded-xl border border-red-500/30 bg-red-950/20 p-4 text-xs text-red-300">
          <strong>Error:</strong> {run.error}
        </section>
      )}

      <StepsList steps={run.steps ?? []} />
    </div>
  );
}

function StepsList({ steps }: { steps: Step[] }) {
  if (steps.length === 0) {
    return <p className="text-sm text-zinc-500">No steps yet.</p>;
  }
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => <StepRow key={s.id ?? `${s.step_index}-${i}`} step={s} />)}
    </ol>
  );
}

function StepRow({ step }: { step: Step }) {
  const [open, setOpen] = useState(step.kind === "final" || step.kind === "error");
  const { icon, accent, label } = useMemo(() => stepVisual(step.kind), [step.kind]);
  const summary = useMemo(() => summaryFor(step), [step]);
  return (
    <li className={cn("rounded-lg border bg-zinc-950 overflow-hidden", accent)}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-white/[0.02]"
      >
        <span className="shrink-0 mt-0.5 text-zinc-500">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider">
            <span className="text-zinc-400">Step {step.step_index}</span>
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-300">{label}</span>
            {step.name && <span className="text-indigo-300 font-mono normal-case tracking-normal">{step.name}</span>}
            {step.error && <span className="text-red-400">· error</span>}
          </div>
          <div className="text-xs text-zinc-300 mt-0.5 truncate">{summary}</div>
        </div>
        <ChevronRight className={cn("w-3.5 h-3.5 text-zinc-600 mt-1 shrink-0 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {step.input != null && (
            <KV label="Input" obj={step.input} />
          )}
          {step.output != null && (
            <KV label="Output" obj={step.output} />
          )}
          {step.error && (
            <KV label="Error" obj={{ error: step.error }} tone="error" />
          )}
        </div>
      )}
    </li>
  );
}

function KV({ label, obj, tone }: { label: string; obj: Record<string, unknown>; tone?: "error" }) {
  const pretty = useMemo(() => {
    try { return JSON.stringify(obj, null, 2); }
    catch { return String(obj); }
  }, [obj]);
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{label}</div>
      <pre className={cn(
        "text-[11px] font-mono rounded p-2 overflow-x-auto max-h-72 overflow-y-auto border whitespace-pre-wrap",
        tone === "error"
          ? "bg-red-950/20 border-red-500/20 text-red-300"
          : "bg-black/30 border-white/[0.06] text-zinc-300",
      )}>{pretty}</pre>
    </div>
  );
}

function stepVisual(k: StepKind) {
  switch (k) {
    case "thought":     return { icon: <Brain className="w-3.5 h-3.5" />, label: "thought",    accent: "border-white/[0.06]" };
    case "tool_call":   return { icon: <Wrench className="w-3.5 h-3.5" />, label: "tool call",  accent: "border-indigo-500/20" };
    case "tool_result": return { icon: <MessageSquare className="w-3.5 h-3.5" />, label: "result", accent: "border-white/[0.06]" };
    case "final":       return { icon: <Sparkles className="w-3.5 h-3.5 text-emerald-400" />, label: "final", accent: "border-emerald-500/30" };
    case "error":       return { icon: <CircleX className="w-3.5 h-3.5 text-red-400" />, label: "error", accent: "border-red-500/30" };
    default:            return { icon: <CircleCheck className="w-3.5 h-3.5" />, label: k, accent: "border-white/[0.06]" };
  }
}

function summaryFor(step: Step): string {
  if (step.kind === "tool_call") {
    const args = (step.input as { args?: unknown } | null)?.args;
    try { return `args: ${JSON.stringify(args).slice(0, 140)}`; }
    catch { return "(args)"; }
  }
  if (step.kind === "tool_result") {
    if (step.error) return step.error.slice(0, 140);
    try { return JSON.stringify(step.output).slice(0, 140); }
    catch { return "(result)"; }
  }
  if (step.kind === "final" || step.kind === "thought") {
    const text = (step.output as { text?: string } | null)?.text;
    return (text ?? "").slice(0, 140);
  }
  return "";
}

function NewRunDialog({ onClose, onStart }: {
  onClose: () => void;
  onStart: (body: { goal: string; tool_allowlist: string[] | null; max_steps: number; max_tokens: number }) => void;
}) {
  const [goal, setGoal] = useState("");
  const [mcps, setMcps] = useState<InstalledMcp[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [maxSteps, setMaxSteps] = useState(12);
  const [maxTokens, setMaxTokens] = useState(2048);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/store/installed-detail");
        if (!r.ok) return;
        const data = await r.json();
        const xs: InstalledMcp[] = (data.mcps || []).map((m: { id: string; name: string }) => ({ id: m.id, name: m.name }));
        setMcps(xs);
        // Default: all installed selected.
        setSelected(new Set(xs.map(m => m.id)));
      } catch {}
    })();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = () => {
    if (!goal.trim()) return;
    const all = selected.size === mcps.length;
    onStart({
      goal: goal.trim(),
      tool_allowlist: all ? null : [...selected],
      max_steps: maxSteps,
      max_tokens: maxTokens,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <Bot className="w-4 h-4 text-indigo-300" /> New agent run
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
            <XIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-1">Goal</label>
            <textarea
              autoFocus
              value={goal}
              onChange={e => setGoal(e.target.value)}
              rows={3}
              placeholder="e.g. List all .md files in ~/Documents/notes and summarize the three most-recently-edited."
              className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2.5 py-1.5 text-sm text-zinc-100"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-zinc-300">
                Tool allowlist <span className="text-zinc-600">({selected.size}/{mcps.length} MCPs)</span>
              </label>
              <div className="flex gap-1.5 text-[11px]">
                <button onClick={() => setSelected(new Set(mcps.map(m => m.id)))} className="text-indigo-400 hover:text-indigo-300">All</button>
                <button onClick={() => setSelected(new Set())} className="text-zinc-500 hover:text-zinc-300">None</button>
              </div>
            </div>
            {mcps.length === 0 ? (
              <p className="text-[11px] text-zinc-500">No MCPs installed — the agent will have nothing to call. Install some via /store.</p>
            ) : (
              <div className="space-y-1">
                {mcps.map(m => (
                  <label key={m.id} className="flex items-center gap-2 text-xs text-zinc-300 px-2 py-1 rounded hover:bg-zinc-900">
                    <input
                      type="checkbox"
                      checked={selected.has(m.id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(m.id); else next.delete(m.id);
                        setSelected(next);
                      }}
                      className="accent-indigo-500"
                    />
                    {m.name} <span className="text-zinc-600 font-mono">({m.id})</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-zinc-300 block mb-1">Max steps</label>
              <input
                type="number" value={maxSteps} min={1} max={40}
                onChange={e => setMaxSteps(Math.max(1, Math.min(40, Number(e.target.value) || 12)))}
                className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2.5 py-1.5 text-xs text-zinc-100 font-mono"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-300 block mb-1">Max tokens</label>
              <input
                type="number" value={maxTokens} min={128} max={16384} step={128}
                onChange={e => setMaxTokens(Math.max(128, Math.min(16384, Number(e.target.value) || 2048)))}
                className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2.5 py-1.5 text-xs text-zinc-100 font-mono"
              />
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-white/[0.08] flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={!goal.trim()} className="gap-1.5">
            <Play className="w-3.5 h-3.5" /> Run
          </Button>
        </div>
      </div>
    </div>
  );
}
