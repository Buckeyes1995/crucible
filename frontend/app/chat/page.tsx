"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChatStore } from "@/lib/stores/chat";
import { useModelsStore } from "@/lib/stores/models";
import { Button } from "@/components/ui/button";
import { formatMs, formatTps, cn } from "@/lib/utils";
import {
  Send, BookOpen, X, ChevronDown, Paperclip, FileText, Plus, RotateCcw,
  Copy, Bookmark, BookmarkCheck, Pin, Download, Edit as EditIcon,
} from "lucide-react";
import { api, type PromptTemplate, type SystemPromptEntry } from "@/lib/api";
import { toast } from "@/components/Toast";
import { ChatMessageBody } from "@/components/ChatMessageBody";

const RAG_SESSION = "chat-main";

// Rough characters-per-token heuristic. Close enough for budget warnings —
// real tokenization varies by model but we're not billing off this count.
const CHARS_PER_TOKEN = 4;

type SlashResult = { handled: boolean; message?: string };

export default function ChatPage() {
  const {
    messages, streaming, stats, error, sendMessage, clearMessages,
    resetStreaming, regenerateFrom, toggleBookmark, editAndBranch,
  } = useChatStore();
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const { activeModelId, loadingModelId, models, loadModel, fetchModels } = useModelsStore();
  useEffect(() => { if (models.length === 0) fetchModels(); }, [models.length, fetchModels]);

  useEffect(() => { resetStreaming(); }, [resetStreaming]);
  const [input, setInput] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(8192);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [sysPromptLib, setSysPromptLib] = useState<SystemPromptEntry[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showSysLib, setShowSysLib] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [ragFiles, setRagFiles] = useState<Record<string, number>>({});
  const [ragCount, setRagCount] = useState(0);
  const [ragUploading, setRagUploading] = useState(false);
  const [ragEnabled, setRagEnabled] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const templateRef = useRef<HTMLDivElement>(null);
  const sysLibRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const prefill = sessionStorage.getItem("crucible:chat-prefill");
      if (prefill) {
        setInput(prefill);
        sessionStorage.removeItem("crucible:chat-prefill");
      }
    } catch {}
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    api.templates.list().then(setTemplates).catch(() => {});
    api.systemPrompts.list().then(setSysPromptLib).catch(() => {});
  }, []);

  // Close any open dropdown on outside click. Single handler drives all three.
  useEffect(() => {
    if (!showTemplates && !showSysLib && !showExport) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (showTemplates && templateRef.current && !templateRef.current.contains(t)) setShowTemplates(false);
      if (showSysLib && sysLibRef.current && !sysLibRef.current.contains(t)) setShowSysLib(false);
      if (showExport && exportRef.current && !exportRef.current.contains(t)) setShowExport(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showTemplates, showSysLib, showExport]);

  // ── Slash commands ───────────────────────────────────────────────────────
  // Returns { handled: true } if the caller should NOT send as a normal prompt.
  const tryHandleSlash = (raw: string): SlashResult => {
    if (!raw.startsWith("/")) return { handled: false };
    const space = raw.indexOf(" ");
    const cmd = space === -1 ? raw.slice(1).trim() : raw.slice(1, space).trim();
    const arg = space === -1 ? "" : raw.slice(space + 1).trim();
    const c = cmd.toLowerCase();
    if (c === "help" || c === "?") {
      toast("Slash commands: /model <id>, /temp <0..2>, /max <N>, /system <prompt>, /clear, /save [title]", "info");
      return { handled: true };
    }
    if (c === "clear" || c === "new") {
      clearMessages();
      return { handled: true, message: "Cleared conversation" };
    }
    if (c === "temp" || c === "temperature") {
      const n = Number(arg);
      if (!Number.isFinite(n) || n < 0 || n > 2) { toast("Usage: /temp 0.7", "error"); return { handled: true }; }
      setTemperature(n);
      return { handled: true, message: `Temperature → ${n}` };
    }
    if (c === "max" || c === "maxtokens") {
      const n = parseInt(arg);
      if (!Number.isFinite(n) || n < 1) { toast("Usage: /max 4096", "error"); return { handled: true }; }
      setMaxTokens(n);
      return { handled: true, message: `Max tokens → ${n}` };
    }
    if (c === "system") {
      setSystemPrompt(arg);
      return { handled: true, message: arg ? "System prompt set" : "System prompt cleared" };
    }
    if (c === "model") {
      if (!arg) { toast("Usage: /model <id or substring>", "error"); return { handled: true }; }
      const needle = arg.toLowerCase();
      const match = models.find(m =>
        m.id.toLowerCase() === needle
        || m.id.toLowerCase().includes(needle)
        || m.name.toLowerCase().includes(needle),
      );
      if (!match) { toast(`No model matches "${arg}"`, "error"); return { handled: true }; }
      loadModel(match.id);
      return { handled: true, message: `Loading ${match.name}…` };
    }
    if (c === "save" || c === "pin") {
      // Save the most recent assistant turn as a snippet.
      const lastAssistant = [...messages].reverse().find(m => m.role === "assistant");
      if (!lastAssistant || !lastAssistant.content.trim()) {
        toast("No assistant response to save yet", "error");
        return { handled: true };
      }
      const title = arg || (messages.find(m => m.role === "user")?.content.slice(0, 60) ?? "Chat snippet");
      api.snippets.create({
        title, content: lastAssistant.content, source: "chat",
        model_id: activeModelId ?? null,
      })
        .then(() => toast(`Pinned to snippets: ${title}`, "success"))
        .catch(e => toast(`Pin failed: ${e.message}`, "error"));
      return { handled: true };
    }
    toast(`Unknown command: /${cmd}`, "error");
    return { handled: true };
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || streaming) return;
    // Intercept slash commands before they hit the model.
    const r = tryHandleSlash(text);
    if (r.handled) {
      setInput("");
      if (r.message) toast(r.message, "info");
      return;
    }
    setInput("");
    sendMessage(text, temperature, maxTokens, systemPrompt || undefined, ragEnabled && ragCount > 0 ? RAG_SESSION : undefined);
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setRagUploading(true);
    try {
      for (const file of Array.from(files)) {
        const result = await api.rag.upload(RAG_SESSION, file);
        setRagFiles(result.files);
        setRagCount(result.chunk_count);
        setRagEnabled(true);
      }
    } catch (e) {
      console.error("RAG upload failed:", e);
    } finally {
      setRagUploading(false);
    }
  };

  const handleClearRag = async () => {
    await api.rag.clear(RAG_SESSION).catch(() => {});
    setRagFiles({});
    setRagCount(0);
    setRagEnabled(false);
  };

  // ── Token budget ─────────────────────────────────────────────────────────
  const activeModel = useMemo(
    () => models.find(m => m.id === activeModelId) ?? null,
    [activeModelId, models],
  );
  const contextWindow = activeModel?.context_window ?? null;
  const usedChars = useMemo(
    () => messages.reduce((sum, m) => sum + m.content.length, 0) + (systemPrompt?.length ?? 0),
    [messages, systemPrompt],
  );
  const usedTokens = Math.ceil(usedChars / CHARS_PER_TOKEN);
  const ratio = contextWindow ? usedTokens / contextWindow : 0;
  const budgetColor =
    ratio >= 0.9 ? "bg-red-500" :
    ratio >= 0.7 ? "bg-amber-500" :
    "bg-indigo-500";
  const budgetLabel = contextWindow
    ? `${usedTokens.toLocaleString()} / ${contextWindow.toLocaleString()} tok (~${Math.round(ratio * 100)}%)`
    : `${usedTokens.toLocaleString()} tok`;

  // ── Regenerate / copy / bookmark / pin ──────────────────────────────────
  const onRegenerate = (idx: number) => {
    regenerateFrom(idx, temperature, maxTokens, systemPrompt || undefined,
                   ragEnabled && ragCount > 0 ? RAG_SESSION : undefined);
  };
  const onCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied to clipboard", "success");
    } catch {
      toast("Copy failed — clipboard unavailable", "error");
    }
  };
  const onCopyAsMarkdown = async (text: string, userText?: string) => {
    const parts = [
      userText ? `> **Q:** ${userText.trim().split("\n").join("\n> ")}\n` : "",
      text,
      `\n_— ${activeModelId ?? "local model"} · ${new Date().toISOString()}_\n`,
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(parts.join("\n"));
      toast("Copied as Markdown", "success");
    } catch {
      toast("Copy failed", "error");
    }
  };
  const onPin = async (text: string, userText?: string) => {
    try {
      const title = (userText || "Chat snippet").slice(0, 60);
      await api.snippets.create({ title, content: text, source: "chat", model_id: activeModelId ?? null });
      toast(`Pinned to snippets`, "success");
    } catch (e) {
      toast(`Pin failed: ${(e as Error).message}`, "error");
    }
  };

  // ── Export ───────────────────────────────────────────────────────────────
  const downloadFile = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const exportMarkdown = () => {
    const lines: string[] = [
      `# Chat export`,
      `_Model: ${activeModelId ?? "unknown"} · ${new Date().toISOString()}_`,
      "",
    ];
    if (systemPrompt) {
      lines.push("## System prompt", "", "```", systemPrompt, "```", "");
    }
    for (const m of messages) {
      lines.push(`## ${m.role === "user" ? "User" : "Assistant"}${m.bookmarked ? " ⭐" : ""}`, "", m.content, "");
    }
    downloadFile(`chat-${Date.now()}.md`, lines.join("\n"), "text/markdown");
    setShowExport(false);
  };
  const exportJson = () => {
    const payload = {
      exported_at: new Date().toISOString(),
      model_id: activeModelId,
      system_prompt: systemPrompt || null,
      temperature, max_tokens: maxTokens,
      messages,
    };
    downloadFile(`chat-${Date.now()}.json`, JSON.stringify(payload, null, 2), "application/json");
    setShowExport(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 h-14 border-b border-white/[0.04] shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-zinc-800/50">
            <Send className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-zinc-100">Chat</h1>
            <select
              value={loadingModelId ?? activeModelId ?? ""}
              disabled={!!loadingModelId}
              onChange={(e) => {
                const id = e.target.value;
                if (id && id !== activeModelId) loadModel(id);
              }}
              className="text-[10px] font-mono bg-transparent border border-white/10 rounded px-1.5 py-0.5 text-zinc-400 hover:text-zinc-200 focus:outline-none focus:border-indigo-500/40 max-w-[260px] disabled:opacity-60"
              title="Switch model mid-conversation"
            >
              <option value="" disabled>No model loaded</option>
              {models
                .filter((m) => !m.hidden)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id.replace(/^mlx:/, "")}
                    {loadingModelId === m.id ? " (loading…)" : ""}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {stats && (
            <div className="flex gap-3 text-[11px] font-mono">
              {stats.ttft_ms != null && <span className="text-zinc-500">TTFT <span className="text-zinc-300">{formatMs(stats.ttft_ms)}</span></span>}
              {stats.tps != null && <span className="text-indigo-400">{formatTps(stats.tps)}</span>}
              {stats.output_tokens != null && <span className="text-zinc-600">{stats.output_tokens} tok</span>}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-600">
            <span>T</span>
            <input type="range" min="0" max="2" step="0.05" value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))} className="w-16 accent-indigo-500" />
            <span className="w-7 text-zinc-400 font-mono text-[10px]">{temperature.toFixed(1)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-600">
            <span>Max</span>
            <input type="number" min="64" max="32768" step="256" value={maxTokens}
              onChange={(e) => setMaxTokens(Number(e.target.value))}
              className="w-16 bg-zinc-900 border border-white/[0.08] rounded-md px-2 py-1 text-zinc-300 text-[10px] font-mono" />
          </div>
          <div className="relative" ref={exportRef}>
            <Button
              variant="secondary"
              size="xs"
              onClick={() => setShowExport(v => !v)}
              disabled={messages.length === 0}
              className="gap-1"
              title="Export this conversation"
            >
              <Download className="w-3 h-3" /> Export
            </Button>
            {showExport && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-zinc-900 border border-white/10 rounded-lg shadow-2xl z-30 py-1">
                <button onClick={exportMarkdown} className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">Markdown (.md)</button>
                <button onClick={exportJson} className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">JSON (.json)</button>
              </div>
            )}
          </div>
          <Button
            variant="secondary"
            size="xs"
            onClick={clearMessages}
            disabled={streaming}
            className="gap-1"
            title="Start a new conversation"
          >
            <Plus className="w-3 h-3" /> New chat
          </Button>
        </div>
      </div>

      {/* System prompt bar */}
      <div className="flex items-center gap-2 px-6 py-2 border-b border-white/5 bg-zinc-900/40">
        <span className="text-xs text-zinc-500 shrink-0">System</span>
        <div className="flex-1 relative">
          <input
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="System prompt (optional)… or pick one from the library →"
            className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded px-2 py-1 text-xs text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50"
          />
          {systemPrompt && (
            <button
              onClick={() => setSystemPrompt("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {/* Quick-switch: system prompt library (built-ins + user-added) */}
        <div className="relative" ref={sysLibRef}>
          <button
            onClick={() => setShowSysLib(v => !v)}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded border border-zinc-700/50 hover:border-zinc-600 bg-zinc-800/60 transition-colors"
            title="System prompts library — built-in styles + anything you've added"
          >
            <BookOpen className="w-3 h-3" />
            Library
            <ChevronDown className="w-3 h-3" />
          </button>
          {showSysLib && (
            <div className="absolute right-0 top-full mt-1 w-80 bg-zinc-900 border border-white/10 rounded-lg shadow-xl z-50 max-h-96 overflow-y-auto">
              <div className="px-3 py-2 border-b border-white/5 text-xs text-zinc-400 font-semibold">
                System Prompts
              </div>
              {sysPromptLib.length === 0 ? (
                <div className="px-3 py-3 text-xs text-zinc-600">No system prompts yet.</div>
              ) : (
                sysPromptLib.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { setSystemPrompt(p.content); setShowSysLib(false); toast(`System prompt: ${p.name}`, "info"); }}
                    className="w-full text-left px-3 py-2 hover:bg-zinc-800 transition-colors border-b border-white/5 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-zinc-200">{p.name}</span>
                      {p.builtin && <span className="text-[9px] uppercase tracking-wide text-zinc-600">built-in</span>}
                      <span className="ml-auto text-[9px] text-zinc-600">{p.category}</span>
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-0.5 truncate">{p.content}</div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        {/* Legacy prompt-templates picker — still handy for user-defined full prompts */}
        <div className="relative" ref={templateRef}>
          <button
            onClick={() => setShowTemplates((v) => !v)}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded border border-zinc-700/50 hover:border-zinc-600 bg-zinc-800/60 transition-colors"
          >
            <BookOpen className="w-3 h-3" /> Templates <ChevronDown className="w-3 h-3" />
          </button>
          {showTemplates && (
            <div className="absolute right-0 top-full mt-1 w-80 bg-zinc-900 border border-white/10 rounded-lg shadow-xl z-50 max-h-96 overflow-y-auto">
              <div className="px-3 py-2 border-b border-white/5 text-xs text-zinc-400 font-semibold">
                Prompt Templates
              </div>
              {templates.length === 0 ? (
                <div className="px-3 py-3 text-xs text-zinc-600">
                  No templates. Add in <a href="/store" className="text-indigo-400 hover:underline">Store</a> or create from scratch.
                </div>
              ) : (
                templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { setSystemPrompt(t.content); setShowTemplates(false); toast(`Template: ${t.name}`, "info"); }}
                    className="w-full text-left px-3 py-2 hover:bg-zinc-800 transition-colors border-b border-white/5 last:border-0"
                  >
                    <div className="text-xs font-medium text-zinc-200">{t.name}</div>
                    {t.description && <div className="text-[10px] text-zinc-500 mt-0.5 truncate">{t.description}</div>}
                    <div className="text-[10px] text-zinc-600 mt-0.5 truncate font-mono">{t.content}</div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Token budget meter */}
      {(messages.length > 0 || systemPrompt) && (
        <div className="px-6 py-1.5 border-b border-white/5 bg-zinc-900/20 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-zinc-500 shrink-0">Context</span>
          <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div className={cn("h-full transition-all", budgetColor)} style={{ width: `${Math.min(100, ratio * 100).toFixed(1)}%` }} />
          </div>
          <span className={cn(
            "text-[10px] font-mono shrink-0",
            ratio >= 0.9 ? "text-red-300" : ratio >= 0.7 ? "text-amber-300" : "text-zinc-500",
          )}>
            {budgetLabel}
          </span>
        </div>
      )}

      {/* RAG context bar */}
      <div className="flex items-center gap-2 px-6 py-1.5 border-b border-white/5 bg-zinc-900/20">
        <span className="text-xs text-zinc-500 shrink-0">Context</span>
        <input
          type="file"
          ref={fileInputRef}
          multiple
          accept=".txt,.md,.py,.ts,.tsx,.js,.jsx,.json,.csv,.yaml,.yml,.rst,.html"
          className="hidden"
          onChange={(e) => handleFileUpload(e.target.files)}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={ragUploading}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 px-2 py-0.5 rounded border border-zinc-700/50 hover:border-zinc-600 bg-zinc-800/60 transition-colors disabled:opacity-50"
        >
          <Paperclip className="w-3 h-3" />
          {ragUploading ? "Uploading…" : "Attach file"}
        </button>
        {Object.keys(ragFiles).length > 0 && (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="flex gap-1 flex-wrap">
              {Object.entries(ragFiles).map(([name, chunks]) => (
                <span key={name} className="flex items-center gap-1 text-xs bg-indigo-900/30 border border-indigo-700/30 text-indigo-300 px-1.5 py-0.5 rounded">
                  <FileText className="w-3 h-3" />
                  {name} <span className="text-indigo-500">({chunks})</span>
                </span>
              ))}
            </div>
            <label className="flex items-center gap-1 text-xs text-zinc-500 cursor-pointer ml-1">
              <input type="checkbox" checked={ragEnabled} onChange={(e) => setRagEnabled(e.target.checked)} className="accent-indigo-500" />
              Use context
            </label>
            <button onClick={handleClearRag} className="text-xs text-zinc-600 hover:text-red-400 ml-auto">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
        {Object.keys(ragFiles).length === 0 && (
          <span className="text-xs text-zinc-700">Attach files to inject relevant context — or type <kbd className="text-zinc-600">/help</kbd> for slash commands</span>
        )}
      </div>

      {!activeModelId && !loadingModelId && (
        <div className="mx-6 mt-4 px-4 py-3 rounded-xl bg-amber-950/30 border border-amber-500/15 text-amber-300/80 text-sm animate-fade-in">
          No model loaded. Go to <a href="/models" className="underline hover:text-amber-200">Models</a> to load one first.
        </div>
      )}
      {loadingModelId && (
        <div className="mx-6 mt-4 px-4 py-3 rounded-xl bg-indigo-950/30 border border-indigo-500/20 text-indigo-300/90 text-sm animate-fade-in flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
          Loading <span className="font-mono">{loadingModelId.replace(/^mlx:/, "")}</span>… you can keep reading the existing conversation.
        </div>
      )}

      {error && (
        <div className="mx-6 mt-4 px-4 py-2.5 rounded-xl bg-red-950/40 border border-red-500/20 text-red-300 text-sm animate-fade-in">
          {error}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="p-4 rounded-2xl bg-zinc-800/30 text-zinc-700 mb-4">
              <Send className="w-8 h-8" />
            </div>
            <p className="text-zinc-500">Start a conversation</p>
            <p className="text-xs text-zinc-700 mt-1">
              Messages appear here. Try <kbd className="text-zinc-600">/help</kbd> for commands.
            </p>
          </div>
        )}
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.map((msg, i) => {
            const isAssistant = msg.role === "assistant";
            const isLast = i === messages.length - 1;
            const showCursor = streaming && isLast && isAssistant;
            // The user turn that produced this assistant message, for snippet title.
            const preceding = isAssistant ? messages.slice(0, i).reverse().find(m => m.role === "user") : undefined;
            return (
              <div key={i} className={cn("animate-fade-in group", isAssistant ? "flex justify-start" : "flex justify-end")}>
                <div className={cn(
                  "max-w-[85%]",
                  isAssistant ? "" : "text-right",
                )}>
                  <div className={cn(
                    "rounded-2xl px-4 py-3 text-sm leading-relaxed relative",
                    isAssistant
                      ? "bg-zinc-900/60 border border-white/[0.06] text-zinc-200 whitespace-pre-wrap rounded-bl-md"
                      : "bg-indigo-600/15 border border-indigo-500/20 text-zinc-100 rounded-br-md inline-block",
                    msg.bookmarked && "ring-1 ring-amber-400/40",
                  )}>
                    {isAssistant ? <ChatMessageBody content={msg.content} /> : msg.content}
                    {showCursor && (
                      <span className="inline-block w-0.5 h-4 ml-0.5 bg-indigo-400 animate-pulse rounded-full align-middle" />
                    )}
                  </div>

                  {/* Per-turn action bar — only for finished messages */}
                  {(!showCursor) && (
                    <div className={cn(
                      "flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity",
                      isAssistant ? "justify-start" : "justify-end",
                    )}>
                      <TurnAction icon={<Copy className="w-3 h-3" />} label="Copy" onClick={() => onCopy(msg.content)} />
                      <TurnAction
                        icon={msg.bookmarked ? <BookmarkCheck className="w-3 h-3 text-amber-400" /> : <Bookmark className="w-3 h-3" />}
                        label={msg.bookmarked ? "Unbookmark" : "Bookmark"}
                        onClick={() => toggleBookmark(i)}
                      />
                      {isAssistant && (
                        <>
                          <TurnAction
                            icon={<Copy className="w-3 h-3" />}
                            label="Copy as MD"
                            onClick={() => onCopyAsMarkdown(msg.content, preceding?.content)}
                          />
                          <TurnAction
                            icon={<Pin className="w-3 h-3" />}
                            label="Pin"
                            onClick={() => onPin(msg.content, preceding?.content)}
                          />
                          <TurnAction
                            icon={<RotateCcw className="w-3 h-3" />}
                            label="Regenerate"
                            onClick={() => onRegenerate(i)}
                            disabled={streaming}
                          />
                        </>
                      )}
                      {!isAssistant && (
                        <TurnAction
                          icon={<EditIcon className="w-3 h-3" />}
                          label="Edit & branch"
                          onClick={() => { setEditingIndex(i); setEditingText(msg.content); }}
                          disabled={streaming}
                        />
                      )}
                    </div>
                  )}
                  {editingIndex === i && !isAssistant && (
                    <div className="mt-2 rounded-xl border border-indigo-500/40 bg-indigo-950/20 p-3 space-y-2">
                      <div className="text-[10px] uppercase tracking-wide text-indigo-300">Edit & branch</div>
                      <textarea
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        rows={4}
                        className="w-full bg-zinc-950 border border-white/[0.08] rounded px-2 py-1.5 text-xs text-zinc-200"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="xs"
                          variant="primary"
                          onClick={() => {
                            const txt = editingText.trim();
                            if (!txt) return;
                            editAndBranch(i, txt, temperature, maxTokens,
                              systemPrompt || undefined,
                              ragEnabled && ragCount > 0 ? RAG_SESSION : undefined);
                            setEditingIndex(null);
                          }}
                          disabled={streaming || !editingText.trim()}
                        >Branch from here</Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => { setEditingIndex(null); setEditingText(""); }}
                        >Cancel</Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-white/[0.04] px-6 py-4 bg-zinc-950/50 backdrop-blur-sm">
        <div className="flex gap-3 max-w-3xl mx-auto">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={activeModelId ? "Send a message — or /help for commands…" : "Load a model first…"}
            disabled={!activeModelId || streaming}
            className="flex-1 bg-zinc-900/60 border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/20 transition-all disabled:opacity-50"
          />
          {streaming ? (
            <Button
              variant="destructive"
              onClick={resetStreaming}
              className="rounded-xl px-5"
              title="Force-unlock the input (use if the stream got stuck)"
            >
              <X className="w-4 h-4" />
              Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleSend}
              disabled={!activeModelId || !input.trim()}
              className="rounded-xl px-5"
            >
              <Send className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function TurnAction({ icon, label, onClick, disabled }: {
  icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-200 px-1.5 py-0.5 rounded hover:bg-zinc-800/80 transition-colors disabled:opacity-40"
    >
      {icon}<span className="hidden sm:inline">{label}</span>
    </button>
  );
}
