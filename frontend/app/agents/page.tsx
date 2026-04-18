"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, readSSE, type AgentListEntry, type AgentStatus, type AgentCronJob, type AgentSession } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/Toast";
import {
  Bot, Plus, Trash2, Pause, Play as PlayIcon, RotateCw, FileText, Loader2, Trash, ChevronDown, ChevronRight,
  MessageSquare, Send, X, Square,
} from "lucide-react";

function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (diff < 0) return "in the future";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const [chatFor, setChatFor] = useState<string | null>(null);
  const [chatStates, setChatStates] = useState<Record<string, { messages: ChatMsg[]; sessionId: string | null }>>({});

  const refresh = useCallback(async () => {
    try {
      const list = await api.agents.list();
      setAgents(list);
    } catch (e) {
      toast(`Failed to load agents: ${(e as Error).message}`, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="flex flex-col h-full min-h-screen">
      <div className="px-6 py-4 border-b border-white/[0.04] flex items-center gap-3">
        <Bot className="w-5 h-5 text-indigo-400" />
        <h1 className="text-lg font-semibold text-zinc-100">Agents</h1>
        <span className="text-xs text-zinc-500">{agents.length}</span>
        <div className="ml-auto">
          <Button onClick={() => setShowAdd(true)} variant="secondary" size="sm" className="gap-1.5">
            <Plus className="w-4 h-4" /> Add agent
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center flex-1 text-zinc-500 text-sm">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
        </div>
      ) : agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-center px-6 text-zinc-500 text-sm gap-3">
          <Bot className="w-8 h-8 text-zinc-700" />
          <div>No agents registered yet.</div>
          <div className="text-xs text-zinc-600 max-w-md">
            An agent is a remote service (like a hermes-control sidecar) that Crucible can observe and
            control via HTTP. Register the first one to start.
          </div>
          <Button onClick={() => setShowAdd(true)} variant="primary" size="sm" className="gap-1.5 mt-2">
            <Plus className="w-4 h-4" /> Add agent
          </Button>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4 grid gap-4 grid-cols-1 xl:grid-cols-2">
          {agents.map((a) => (
            <AgentCard
              key={a.name}
              agent={a}
              onRemoved={refresh}
              onAction={refresh}
              onOpenLogs={() => setLogsFor(a.name)}
              onOpenChat={() => setChatFor(a.name)}
            />
          ))}
        </div>
      )}

      {showAdd && <AddAgentModal onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); refresh(); }} />}
      {logsFor && <LogsModal name={logsFor} onClose={() => setLogsFor(null)} />}
      {chatFor && (
        <ChatModal
          name={chatFor}
          onClose={() => setChatFor(null)}
          state={chatStates[chatFor] ?? { messages: [], sessionId: null }}
          setState={(updater) =>
            setChatStates((prev) => {
              const current = prev[chatFor] ?? { messages: [], sessionId: null };
              const next = typeof updater === "function" ? updater(current) : updater;
              return { ...prev, [chatFor]: next };
            })
          }
        />
      )}
    </div>
  );
}

// ─── Agent card ──────────────────────────────────────────────────────────────

function AgentCard({
  agent, onRemoved, onAction, onOpenLogs, onOpenChat,
}: {
  agent: AgentListEntry;
  onRemoved: () => void;
  onAction: () => void;
  onOpenLogs: () => void;
  onOpenChat: () => void;
}) {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showSessions, setShowSessions] = useState(true);
  const [showCron, setShowCron] = useState(true);

  const pull = useCallback(async () => {
    if (!agent.reachable) return;
    try {
      const s = await api.agents.status(agent.name);
      setStatus(s);
    } catch {
      // leave stale
    }
  }, [agent.name, agent.reachable]);

  useEffect(() => {
    pull();
    const id = setInterval(pull, 10_000);
    return () => clearInterval(id);
  }, [pull]);

  const doAction = async (verb: "pause" | "resume" | "restart" | "prune") => {
    if (!confirm(`${verb} ${agent.name}?`)) return;
    setBusy(verb);
    try {
      if (verb === "pause") await api.agents.pause(agent.name);
      else if (verb === "resume") await api.agents.resume(agent.name);
      else if (verb === "restart") await api.agents.restart(agent.name);
      else if (verb === "prune") {
        const r = await api.agents.pruneOrphans(agent.name);
        toast(`Removed ${r.removed.length} orphan container(s)`, "success");
      }
      await pull();
      onAction();
    } catch (e) {
      toast(`${verb} failed: ${(e as Error).message}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirm(`Remove agent "${agent.name}"? This only unregisters it from Crucible — the sidecar keeps running.`)) return;
    try {
      await api.agents.remove(agent.name);
      toast(`Removed ${agent.name}`, "success");
      onRemoved();
    } catch (e) {
      toast(`Remove failed: ${(e as Error).message}`, "error");
    }
  };

  const running = status?.container.running;
  const paused = status?.container.paused;
  const statusDot = !agent.reachable ? "bg-red-500" : paused ? "bg-amber-400" : running ? "bg-emerald-400" : "bg-zinc-500";
  const statusText = !agent.reachable ? "Unreachable" : paused ? "Paused" : running ? "Running" : (status?.container.status ?? "Idle");

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/[0.04] flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn("w-2 h-2 rounded-full", statusDot, (!paused && running) && "animate-pulse")} />
            <h2 className="text-base font-semibold text-zinc-100 truncate">{agent.name}</h2>
            <span className="text-xs text-zinc-500">{statusText}</span>
            <span className="text-[10px] text-zinc-600 uppercase tracking-wider bg-zinc-800 px-1.5 py-0.5 rounded">{agent.kind}</span>
          </div>
          <div className="text-xs text-zinc-500 font-mono mt-1 truncate">{agent.url}</div>
          {agent.error && <div className="text-xs text-red-400 mt-1">{agent.error}</div>}
          {status && (
            <div className="text-xs text-zinc-600 mt-1 flex gap-3 flex-wrap">
              <span>image: <span className="text-zinc-400">{status.container.image}</span></span>
              <span>up: <span className="text-zinc-400">{fmtAgo(status.container.started_at)}</span></span>
              {status.cron.job_count > 0 && <span>cron: <span className="text-zinc-400">{status.cron.job_count}</span></span>}
              {status.orphans.length > 0 && (
                <span className="text-amber-400">orphans: {status.orphans.length}</span>
              )}
            </div>
          )}
        </div>
        <button onClick={remove} title="Unregister" className="text-zinc-600 hover:text-red-400 transition-colors p-1">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Recent sessions */}
      {status && (
        <>
          <Section title="Recent sessions" open={showSessions} onToggle={() => setShowSessions((v) => !v)}
                   count={status.hermes.recent_sessions.length}>
            {status.hermes.recent_sessions.length === 0 ? (
              <div className="text-xs text-zinc-600 italic">No sessions yet</div>
            ) : (
              <ul className="space-y-1">
                {status.hermes.recent_sessions.slice(0, 6).map((s) => (
                  <SessionRow key={s.id} s={s} />
                ))}
              </ul>
            )}
          </Section>

          {/* Cron */}
          {status.cron.job_count > 0 && (
            <Section title="Cron" open={showCron} onToggle={() => setShowCron((v) => !v)}
                     count={status.cron.job_count}>
              <ul className="space-y-1.5">
                {status.cron.jobs.map((j) => <CronRow key={j.id} j={j} />)}
              </ul>
              {status.hermes.last_tick_at && (
                <div className="text-[10px] text-zinc-600 mt-2">last tick: {fmtAgo(status.hermes.last_tick_at)}</div>
              )}
            </Section>
          )}
        </>
      )}

      {/* Actions */}
      <div className="px-5 py-3 border-t border-white/[0.04] flex flex-wrap gap-2">
        {paused ? (
          <Button variant="secondary" size="sm" className="gap-1" onClick={() => doAction("resume")} disabled={!!busy}>
            {busy === "resume" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayIcon className="w-3.5 h-3.5" />}
            Resume
          </Button>
        ) : (
          <Button variant="secondary" size="sm" className="gap-1" onClick={() => doAction("pause")}
                  disabled={!!busy || !agent.reachable || !running}>
            {busy === "pause" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pause className="w-3.5 h-3.5" />}
            Pause
          </Button>
        )}
        <Button variant="secondary" size="sm" className="gap-1" onClick={() => doAction("restart")}
                disabled={!!busy || !agent.reachable}>
          {busy === "restart" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
          Restart
        </Button>
        <Button variant="secondary" size="sm" className="gap-1" onClick={onOpenChat} disabled={!agent.reachable || !running}>
          <MessageSquare className="w-3.5 h-3.5" /> Chat
        </Button>
        <Button variant="secondary" size="sm" className="gap-1" onClick={onOpenLogs} disabled={!agent.reachable}>
          <FileText className="w-3.5 h-3.5" /> Logs
        </Button>
        {status && status.orphans.length > 0 && (
          <Button variant="destructive" size="sm" className="gap-1" onClick={() => doAction("prune")} disabled={!!busy}>
            {busy === "prune" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash className="w-3.5 h-3.5" />}
            Prune {status.orphans.length} orphan{status.orphans.length === 1 ? "" : "s"}
          </Button>
        )}
      </div>
    </div>
  );
}

function Section({ title, open, onToggle, count, children }: {
  title: string; open: boolean; onToggle: () => void; count?: number; children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-3 border-t border-white/[0.04]">
      <button onClick={onToggle} className="flex items-center gap-1 w-full text-left mb-2 group">
        {open ? <ChevronDown className="w-3 h-3 text-zinc-500" /> : <ChevronRight className="w-3 h-3 text-zinc-500" />}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 group-hover:text-zinc-300">{title}</span>
        {count !== undefined && <span className="text-[10px] text-zinc-600">{count}</span>}
      </button>
      {open && children}
    </div>
  );
}

function SessionRow({ s }: { s: AgentSession }) {
  const sourceClass =
    s.source === "cron" ? "text-amber-400 bg-amber-950/20 border-amber-500/20" :
    s.source === "chat" ? "text-indigo-400 bg-indigo-950/20 border-indigo-500/20" :
    "text-zinc-400 bg-zinc-800 border-white/5";
  return (
    <li className="flex items-center gap-2 text-xs">
      <span className={cn("px-1.5 py-0.5 rounded border text-[10px] font-mono uppercase shrink-0", sourceClass)}>
        {s.source}
      </span>
      <span className="truncate text-zinc-300">{s.title || s.id}</span>
      <span className="ml-auto text-zinc-600 shrink-0">{s.message_count ?? "?"} msgs</span>
      <span className="text-zinc-600 shrink-0">{fmtAgo(s.updated_at)}</span>
    </li>
  );
}

function CronRow({ j }: { j: AgentCronJob }) {
  const statusDot =
    j.last_status === "ok" ? "bg-emerald-400" :
    j.last_status === "error" ? "bg-red-400" :
    "bg-zinc-600";
  return (
    <li className="flex items-center gap-2 text-xs">
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", statusDot)} />
      <span className="truncate text-zinc-300">{j.name}</span>
      <span className="font-mono text-[10px] text-zinc-600 shrink-0">{j.schedule}</span>
      <span className="ml-auto text-zinc-600 shrink-0">{j.last_run_at ? fmtAgo(j.last_run_at) : "never"}</span>
    </li>
  );
}

// ─── Modals ──────────────────────────────────────────────────────────────────

function AddAgentModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState("hermes");
  const [url, setUrl] = useState("http://192.168.1.50:7879");
  const [apiKey, setApiKey] = useState("");
  const [kind, setKind] = useState("hermes");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch(`${url.replace(/\/$/, "")}/health`);
      if (!r.ok) throw new Error(`health returned ${r.status}`);
      const data = await r.json();
      setTestResult(`✓ reachable — ${data.host}, container ${data.container_running ? "running" : "stopped"}`);
    } catch (e) {
      setTestResult(`✗ ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.agents.add({ name, url, api_key: apiKey, kind });
      toast(`Registered ${name}`, "success");
      onAdded();
    } catch (e) {
      toast(`Add failed: ${(e as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-100">Register agent</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">×</button>
        </div>
        <Field label="Name" value={name} onChange={setName} placeholder="hermes" />
        <Field label="URL" value={url} onChange={setUrl} placeholder="http://192.168.1.50:7879" />
        <Field label="API key (bearer token)" value={apiKey} onChange={setApiKey} type="password"
               placeholder="cat ~/.config/hermes-control/token" />
        <Field label="Kind" value={kind} onChange={setKind} placeholder="hermes" />

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={test} disabled={testing || !url}>
            {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Test
          </Button>
          {testResult && (
            <span className={cn("text-xs", testResult.startsWith("✓") ? "text-emerald-400" : "text-red-400")}>
              {testResult}
            </span>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={save} disabled={saving || !name || !url}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Register
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 font-mono focus:outline-none focus:border-indigo-500/40"
      />
    </div>
  );
}

type ChatMsg = { role: "user" | "assistant"; content: string; error?: boolean };
type ChatState = { messages: ChatMsg[]; sessionId: string | null };

function ChatModal({ name, onClose, state, setState }: {
  name: string;
  onClose: () => void;
  state: ChatState;
  setState: (updater: ChatState | ((prev: ChatState) => ChatState)) => void;
}) {
  const { messages, sessionId } = state;
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  // Track whether the user is pinned to the bottom; if so, auto-scroll on new content.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  // On open (or when switching agents), jump to the bottom so re-opened history lands at the latest turn.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickRef.current = true;
  }, [name]);

  const send = async () => {
    const prompt = input.trim();
    if (!prompt || streaming) return;
    setInput("");
    stickRef.current = true; // sending implies the user wants to watch the new reply
    setState((s) => ({ ...s, messages: [...s.messages, { role: "user", content: prompt }, { role: "assistant", content: "" }] }));
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await api.agents.chat(name, { prompt, session_id: sessionId }, controller.signal);
      if (!resp.ok) {
        const text = await resp.text();
        setState((s) => {
          const copy = [...s.messages];
          copy[copy.length - 1] = { role: "assistant", content: `error: ${resp.status} ${text.slice(0, 400)}`, error: true };
          return { ...s, messages: copy };
        });
        return;
      }
      await readSSE(resp, (evt) => {
        const e = evt as { event?: string; line?: string; session_id?: string | null; message?: string };
        if (e.event === "line" && typeof e.line === "string") {
          setState((s) => {
            const copy = [...s.messages];
            const last = copy[copy.length - 1];
            copy[copy.length - 1] = { ...last, content: last.content + (last.content ? "\n" : "") + e.line };
            return { ...s, messages: copy };
          });
        } else if (e.event === "done") {
          const doneEvt = evt as { session_id?: string | null; exit_code?: number };
          if (doneEvt.session_id) setState((s) => ({ ...s, sessionId: doneEvt.session_id! }));
          if (doneEvt.exit_code && doneEvt.exit_code !== 0) {
            setState((s) => {
              const copy = [...s.messages];
              const last = copy[copy.length - 1];
              copy[copy.length - 1] = {
                ...last,
                content: (last.content ? last.content + "\n\n" : "") + `[hermes exited with code ${doneEvt.exit_code} — likely hit --max-turns]`,
                error: true,
              };
              return { ...s, messages: copy };
            });
          }
        } else if (e.event === "error") {
          setState((s) => {
            const copy = [...s.messages];
            copy[copy.length - 1] = { role: "assistant", content: e.message || "error", error: true };
            return { ...s, messages: copy };
          });
        }
      });
    } catch (e) {
      const err = e as Error;
      setState((s) => {
        const copy = [...s.messages];
        const last = copy[copy.length - 1];
        // If the abort was user-initiated, show "stopped" rather than "error: …".
        const aborted = err.name === "AbortError" || controller.signal.aborted;
        copy[copy.length - 1] = aborted
          ? { ...last, content: (last.content ? last.content + "\n\n" : "") + "[stopped by user]", error: true }
          : { role: "assistant", content: `error: ${err.message}`, error: true };
        return { ...s, messages: copy };
      });
    } finally {
      setStreaming(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const resetSession = () => {
    if (streaming) return;
    setState({ messages: [], sessionId: null });
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-3xl h-[80vh] flex flex-col">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-white/[0.06]">
          <MessageSquare className="w-4 h-4 text-indigo-400" />
          <h2 className="text-sm font-semibold text-zinc-100">{name} · chat</h2>
          {sessionId && (
            <span className="text-[10px] font-mono text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">
              sid {sessionId.slice(-8)}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="xs" onClick={resetSession} disabled={streaming || (!sessionId && messages.length === 0)}>
              New session
            </Button>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-auto px-5 py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="text-xs text-zinc-600 italic text-center mt-12">
              Send a prompt to start a conversation with {name}.
              <div className="mt-1 text-zinc-700">⌘/Ctrl+Enter to send</div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={cn("flex flex-col gap-1", m.role === "user" ? "items-end" : "items-start")}>
                <span className="text-[10px] uppercase tracking-wider text-zinc-600">
                  {m.role === "user" ? "you" : name}
                </span>
                <div className={cn(
                  "rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words max-w-[85%] font-mono leading-relaxed",
                  m.role === "user" ? "bg-indigo-500/10 border border-indigo-500/20 text-zinc-100"
                                    : m.error ? "bg-red-950/30 border border-red-500/30 text-red-300"
                                              : "bg-zinc-800/50 border border-white/5 text-zinc-200",
                )}>
                  {m.content || (streaming && i === messages.length - 1 ? (
                    <span className="inline-flex items-center gap-1.5 text-zinc-500">
                      <Loader2 className="w-3 h-3 animate-spin" /> thinking…
                    </span>
                  ) : "")}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/[0.06] flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Ask hermes to set up a skill, tweak cron, or explain a recent session…"
            rows={2}
            className="flex-1 bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 font-mono resize-none focus:outline-none focus:border-indigo-500/40"
            disabled={streaming}
          />
          {streaming ? (
            <Button variant="destructive" size="sm" onClick={stop} className="gap-1" title="Abort the current turn">
              <Square className="w-3.5 h-3.5 fill-current" /> Stop
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={send} disabled={!input.trim()} className="gap-1">
              <Send className="w-3.5 h-3.5" /> Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function LogsModal({ name, onClose }: { name: string; onClose: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [tail, setTail] = useState(500);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [filterErrorsOnly, setFilterErrorsOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.agents.logs(name, tail);
      setLines(r.lines);
    } catch (e) {
      toast(`Logs failed: ${(e as Error).message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [name, tail]);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const visible = lines.filter((l) => {
    if (filterErrorsOnly && !/error|warn|exception|fail/i.test(l)) return false;
    if (filter && !l.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-5xl h-[80vh] flex flex-col">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-white/[0.06]">
          <FileText className="w-4 h-4 text-indigo-400" />
          <h2 className="text-sm font-semibold text-zinc-100">{name} · logs</h2>
          <input
            type="number"
            value={tail}
            onChange={(e) => setTail(Math.max(50, parseInt(e.target.value) || 500))}
            className="w-20 bg-zinc-950 border border-white/10 rounded px-2 py-1 text-xs text-zinc-300 font-mono ml-3"
            title="lines to fetch"
          />
          <input
            placeholder="filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="flex-1 bg-zinc-950 border border-white/10 rounded px-2 py-1 text-xs text-zinc-300 placeholder:text-zinc-600"
          />
          <label className="text-xs text-zinc-500 flex items-center gap-1">
            <input type="checkbox" checked={filterErrorsOnly} onChange={(e) => setFilterErrorsOnly(e.target.checked)} />
            errors only
          </label>
          <Button variant="ghost" size="xs" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3" />}
          </Button>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 ml-2">×</button>
        </div>
        <div className="flex-1 overflow-auto p-4 font-mono text-xs text-zinc-300 bg-black/30 whitespace-pre-wrap break-all">
          {visible.length === 0 ? (
            <div className="text-zinc-600 italic">No lines matching filter.</div>
          ) : (
            visible.map((l, i) => (
              <div key={i} className={cn(/error|exception|fail/i.test(l) ? "text-red-400" :
                                         /warn/i.test(l) ? "text-amber-400" : "text-zinc-300")}>
                {l}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
