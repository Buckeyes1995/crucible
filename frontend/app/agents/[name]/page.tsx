"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  api, readSSE,
  type AgentSession, type AgentStatus, type AgentCronJob,
} from "@/lib/api";
import { ChatMessageBody } from "@/components/ChatMessageBody";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/Toast";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Bot, Plus, Trash2, Send, Square, Loader2, Clock,
  MessageSquare, Activity, Pause, Play as PlayIcon, RotateCw,
  CheckCircle2, AlertCircle,
} from "lucide-react";

type ChatMsg = { role: "user" | "assistant"; content: string; error?: boolean };

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

export default function AgentChatPage() {
  const params = useParams();
  const name = (Array.isArray(params.name) ? params.name[0] : params.name) as string;
  const router = useRouter();

  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [cronJobs, setCronJobs] = useState<AgentCronJob[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // ── Data fetchers ─────────────────────────────────────────────────────────
  const refreshSessions = useCallback(async () => {
    try {
      const list = await api.agents.sessions(name, 100, 0);
      setSessions(list);
    } catch (e) {
      console.warn("session list fetch failed:", (e as Error).message);
    }
  }, [name]);

  const refreshStatus = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([
        api.agents.status(name),
        api.agents.cron(name),
      ]);
      setStatus(s);
      setCronJobs(c.jobs || []);
    } catch (e) {
      console.warn("status fetch failed:", (e as Error).message);
    }
  }, [name]);

  useEffect(() => { refreshSessions(); refreshStatus(); }, [refreshSessions, refreshStatus]);
  useEffect(() => {
    const id = setInterval(() => { refreshSessions(); refreshStatus(); }, 30_000);
    return () => clearInterval(id);
  }, [refreshSessions, refreshStatus]);

  // ── Sticky bottom scroll ─────────────────────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    stickRef.current = atBottom;
  };

  // ── Session ops ───────────────────────────────────────────────────────────
  const newChat = () => {
    if (streaming) abortRef.current?.abort();
    setSessionId(null);
    setMessages([]);
    setInput("");
    stickRef.current = true;
    composerRef.current?.focus();
  };

  const loadSession = async (id: string) => {
    if (streaming) return;
    setLoadingHistory(true);
    try {
      const detail = await api.agents.session(name, id) as { messages?: ChatMsg[] };
      const msgs = (detail.messages || []).filter(
        (m) => m.role === "user" || m.role === "assistant",
      );
      setMessages(msgs);
      setSessionId(id);
      stickRef.current = true;
    } catch (e) {
      toast(`Failed to load session: ${(e as Error).message}`, "error");
    } finally {
      setLoadingHistory(false);
    }
  };

  const deleteSession = async (id: string) => {
    if (!confirm(`Delete session ${id.slice(-12)}? This can't be undone.`)) return;
    try {
      await api.agents.deleteSession(name, id);
      if (sessionId === id) {
        setSessionId(null);
        setMessages([]);
      }
      refreshSessions();
      toast("Session deleted", "success");
    } catch (e) {
      toast(`Delete failed: ${(e as Error).message}`, "error");
    }
  };

  // ── Send + stream ─────────────────────────────────────────────────────────
  const send = async () => {
    const prompt = input.trim();
    if (!prompt || streaming) return;
    setInput("");
    stickRef.current = true;
    setMessages((m) => [...m, { role: "user", content: prompt }, { role: "assistant", content: "" }]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let finishedClean = false;

    try {
      const resp = await api.agents.chat(name, { prompt, session_id: sessionId }, controller.signal);
      if (!resp.ok) {
        const text = await resp.text();
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: `error: ${resp.status} ${text.slice(0, 400)}`, error: true };
          return copy;
        });
        return;
      }
      await readSSE(resp, (evt) => {
        const e = evt as { event?: string; line?: string; session_id?: string | null; message?: string; exit_code?: number };
        if (e.event === "line" && typeof e.line === "string") {
          setMessages((m) => {
            const copy = [...m];
            const last = copy[copy.length - 1];
            copy[copy.length - 1] = { ...last, content: last.content + (last.content ? "\n" : "") + e.line };
            return copy;
          });
        } else if (e.event === "done") {
          if (e.session_id) setSessionId(e.session_id);
          if (e.exit_code && e.exit_code !== 0) {
            setMessages((m) => {
              const copy = [...m];
              const last = copy[copy.length - 1];
              copy[copy.length - 1] = {
                ...last,
                content: (last.content ? last.content + "\n\n" : "") + `[hermes exited with code ${e.exit_code} — likely hit --max-turns]`,
                error: true,
              };
              return copy;
            });
          }
          finishedClean = true;
          controller.abort();
          // refresh sessions list so the new session shows in the rail
          setTimeout(refreshSessions, 500);
        } else if (e.event === "error") {
          setMessages((m) => {
            const copy = [...m];
            copy[copy.length - 1] = { role: "assistant", content: e.message || "error", error: true };
            return copy;
          });
        }
      });
    } catch (e) {
      const err = e as Error;
      if (finishedClean && (err.name === "AbortError" || controller.signal.aborted)) {
        // clean stop
      } else {
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          const aborted = err.name === "AbortError" || controller.signal.aborted;
          copy[copy.length - 1] = aborted
            ? { ...last, content: (last.content ? last.content + "\n\n" : "") + "[stopped by user]", error: true }
            : { role: "assistant", content: `error: ${err.message}`, error: true };
          return copy;
        });
      }
    } finally {
      setStreaming(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  const onComposerKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // ── Status helpers ────────────────────────────────────────────────────────
  const containerHealthy = status?.container?.running && !status?.container?.paused;
  const containerColor = !status ? "text-zinc-500"
    : containerHealthy ? "text-emerald-400"
    : status.container.paused ? "text-yellow-400"
    : "text-red-400";

  const containerOps = async (op: "pause" | "resume" | "restart") => {
    try {
      if (op === "pause") await api.agents.pause(name);
      else if (op === "resume") await api.agents.resume(name);
      else await api.agents.restart(name);
      toast(`${op}d`, "success");
      setTimeout(refreshStatus, 1000);
    } catch (e) {
      toast(`${op} failed: ${(e as Error).message}`, "error");
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] shrink-0">
        <Link href="/agents" className="text-zinc-500 hover:text-zinc-200 transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <Bot className="w-5 h-5 text-indigo-400" />
        <h1 className="text-base font-semibold text-zinc-100">{name}</h1>
        <span className={cn("flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border",
          containerHealthy ? "border-emerald-500/30 bg-emerald-900/20 text-emerald-300"
            : "border-zinc-700 bg-zinc-900/40 text-zinc-500")}>
          <span className={cn("w-1.5 h-1.5 rounded-full",
            containerHealthy ? "bg-emerald-400 animate-pulse" : "bg-zinc-600")} />
          {status?.container.status || "—"}
        </span>
        <div className="ml-auto" />
      </div>

      {/* 3-pane body */}
      <div className="grid grid-cols-[260px_1fr_300px] flex-1 min-h-0">
        {/* Left rail — sessions */}
        <aside className="border-r border-white/[0.06] flex flex-col min-h-0">
          <div className="px-3 py-2.5 border-b border-white/[0.04] flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Sessions</h2>
            <Button variant="ghost" size="xs" onClick={newChat} className="gap-1 text-[11px]">
              <Plus className="w-3 h-3" /> New
            </Button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
            {sessions.length === 0 ? (
              <p className="text-xs text-zinc-600 text-center py-4">No sessions yet.</p>
            ) : sessions.map((s) => {
              const active = s.id === sessionId;
              const subtitle = s.title || `${s.message_count ?? "?"} messages · ${s.source}`;
              return (
                <div key={s.id} className={cn(
                  "group rounded-lg border transition-colors",
                  active
                    ? "bg-indigo-500/10 border-indigo-500/30"
                    : "bg-transparent border-transparent hover:bg-white/[0.03] hover:border-white/[0.06]",
                )}>
                  <button
                    onClick={() => loadSession(s.id)}
                    disabled={streaming}
                    className="w-full text-left px-2.5 py-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <div className={cn("text-[12px] font-medium truncate",
                      active ? "text-indigo-200" : "text-zinc-300")}>
                      {subtitle}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Clock className="w-2.5 h-2.5 text-zinc-600" />
                      <span className="text-[10px] text-zinc-500 font-mono">{fmtAgo(s.updated_at)}</span>
                      <span className="text-[9px] text-zinc-700 ml-auto truncate font-mono">{s.id.slice(-12)}</span>
                    </div>
                  </button>
                  <div className="px-2.5 pb-1.5 -mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                      className="text-[10px] text-zinc-500 hover:text-red-300 flex items-center gap-1"
                    >
                      <Trash2 className="w-2.5 h-2.5" /> delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Middle — chat thread + composer */}
        <section className="flex flex-col min-h-0">
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-5"
          >
            {loadingHistory && (
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <Loader2 className="w-3 h-3 animate-spin" /> loading history…
              </div>
            )}
            {!loadingHistory && messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center px-6">
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/15 flex items-center justify-center mb-3">
                  <Bot className="w-6 h-6 text-indigo-300" />
                </div>
                <h3 className="text-sm font-semibold text-zinc-200 mb-1">
                  {sessionId ? "Empty session" : "New conversation"}
                </h3>
                <p className="text-xs text-zinc-500 max-w-xs">
                  Ask {name} to set up a skill, tweak a cron, explain a recent session, or run a task.
                </p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={cn("flex gap-3",
                m.role === "user" ? "justify-end" : "justify-start")}>
                {m.role === "assistant" && (
                  <div className="w-7 h-7 rounded-lg bg-indigo-500/15 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-4 h-4 text-indigo-300" />
                  </div>
                )}
                <div className={cn(
                  "max-w-[78%] rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed",
                  m.role === "user"
                    ? "bg-indigo-600 text-white"
                    : m.error
                      ? "bg-red-950/30 border border-red-700/30 text-red-200"
                      : "bg-zinc-900/60 border border-white/[0.06] text-zinc-200",
                )}>
                  {m.role === "assistant" ? (
                    m.content
                      ? <ChatMessageBody content={m.content} />
                      : streaming && i === messages.length - 1
                        ? <span className="inline-flex items-center gap-2 text-zinc-500">
                            <Loader2 className="w-3 h-3 animate-spin" /> thinking…
                          </span>
                        : <span className="text-zinc-600 italic">(empty)</span>
                  ) : (
                    <span className="whitespace-pre-wrap">{m.content}</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Composer */}
          <div className="border-t border-white/[0.06] p-3 shrink-0">
            <div className="flex items-end gap-2 rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-2 focus-within:border-indigo-500/40 transition-colors">
              <textarea
                ref={composerRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onComposerKey}
                placeholder={streaming ? "streaming…" : `Message ${name}…  (Enter to send, Shift+Enter for newline)`}
                disabled={streaming}
                rows={1}
                className="flex-1 bg-transparent text-[13px] text-zinc-100 placeholder:text-zinc-600 outline-none resize-none px-2 py-1.5 max-h-40"
                style={{ minHeight: "2.25rem" }}
              />
              {streaming ? (
                <Button variant="destructive" size="sm" onClick={stop} className="gap-1">
                  <Square className="w-3.5 h-3.5" /> Stop
                </Button>
              ) : (
                <Button variant="primary" size="sm" onClick={send} disabled={!input.trim()} className="gap-1">
                  <Send className="w-3.5 h-3.5" /> Send
                </Button>
              )}
            </div>
            <div className="text-[10px] text-zinc-600 mt-1.5 px-1 flex items-center gap-2">
              {sessionId ? (
                <>
                  <MessageSquare className="w-2.5 h-2.5" />
                  Continuing <span className="font-mono">{sessionId.slice(-12)}</span>
                </>
              ) : (
                <>
                  <Plus className="w-2.5 h-2.5" /> New conversation
                </>
              )}
            </div>
          </div>
        </section>

        {/* Right rail — status + cron */}
        <aside className="border-l border-white/[0.06] flex flex-col min-h-0 overflow-y-auto">
          <Section label="Status">
            <Row label="Container">
              <span className={cn("flex items-center gap-1.5 text-[11px] font-medium", containerColor)}>
                {containerHealthy ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                {status?.container.status ?? "—"}
              </span>
            </Row>
            <Row label="Started">
              <span className="text-[11px] text-zinc-400 font-mono">{fmtAgo(status?.container.started_at)}</span>
            </Row>
            <Row label="Restarts">
              <span className="text-[11px] text-zinc-400 font-mono">{status?.container.restart_count ?? "—"}</span>
            </Row>
            <Row label="Last tick">
              <span className="text-[11px] text-zinc-400 font-mono">{fmtAgo(status?.hermes?.last_tick_at)}</span>
            </Row>
            <div className="flex gap-1.5 px-3 pt-2 pb-3">
              <Button variant="ghost" size="xs" onClick={() => containerOps("pause")} className="gap-1 flex-1">
                <Pause className="w-3 h-3" /> Pause
              </Button>
              <Button variant="ghost" size="xs" onClick={() => containerOps("resume")} className="gap-1 flex-1">
                <PlayIcon className="w-3 h-3" /> Resume
              </Button>
              <Button variant="ghost" size="xs" onClick={() => containerOps("restart")} className="gap-1 flex-1">
                <RotateCw className="w-3 h-3" /> Restart
              </Button>
            </div>
          </Section>

          <Section label={`Cron jobs (${cronJobs.length})`}>
            {cronJobs.length === 0 ? (
              <p className="text-xs text-zinc-600 px-3 py-2">none scheduled</p>
            ) : cronJobs.map((j) => (
              <div key={j.id} className="px-3 py-2 border-b border-white/[0.04] last:border-0">
                <div className="flex items-center gap-1.5">
                  <span className={cn("w-1.5 h-1.5 rounded-full",
                    j.enabled ? "bg-emerald-400" : "bg-zinc-600")} />
                  <span className="text-[12px] font-medium text-zinc-200 truncate">{j.name}</span>
                </div>
                <div className="text-[10px] font-mono text-zinc-500 mt-0.5">{j.schedule}</div>
                {j.last_run_at && (
                  <div className="text-[10px] text-zinc-600 mt-0.5">last: {fmtAgo(j.last_run_at)}</div>
                )}
              </div>
            ))}
          </Section>
        </aside>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-white/[0.06]">
      <div className="px-3 py-2 text-[10px] uppercase tracking-widest font-semibold text-zinc-500 bg-zinc-900/20">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5">
      <span className="text-[11px] text-zinc-500">{label}</span>
      {children}
    </div>
  );
}
