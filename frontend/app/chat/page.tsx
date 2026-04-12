"use client";

import { useEffect, useRef, useState } from "react";
import { useChatStore } from "@/lib/stores/chat";
import { useModelsStore } from "@/lib/stores/models";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMs, formatTps, cn } from "@/lib/utils";
import { Send, Trash2, BookOpen, X, ChevronDown, Paperclip, FileText } from "lucide-react";
import { api, type PromptTemplate } from "@/lib/api";

const RAG_SESSION = "chat-main";

export default function ChatPage() {
  const { messages, streaming, stats, error, sendMessage, clearMessages } = useChatStore();
  const { activeModelId } = useModelsStore();
  const [input, setInput] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(8192);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [ragFiles, setRagFiles] = useState<Record<string, number>>({});
  const [ragCount, setRagCount] = useState(0);
  const [ragUploading, setRagUploading] = useState(false);
  const [ragEnabled, setRagEnabled] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const templateRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    api.templates.list().then(setTemplates).catch(() => {});
  }, []);

  // Close template picker on outside click
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

  const handleSend = () => {
    const text = input.trim();
    if (!text || streaming) return;
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Chat</h1>
          {activeModelId && (
            <p className="text-xs text-zinc-500 mt-0.5 font-mono">{activeModelId}</p>
          )}
        </div>
        <div className="flex items-center gap-4">
          {stats && (
            <div className="flex gap-3 text-xs font-mono text-zinc-400">
              {stats.ttft_ms != null && <span>TTFT {formatMs(stats.ttft_ms)}</span>}
              {stats.tps != null && <span>{formatTps(stats.tps)}</span>}
              {stats.output_tokens != null && <span>{stats.output_tokens} tok</span>}
            </div>
          )}
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <label>Temp</label>
            <input
              type="range" min="0" max="2" step="0.05"
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
              className="w-20 accent-indigo-500"
            />
            <span className="w-6 text-zinc-300 font-mono">{temperature.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <label>Max</label>
            <input
              type="number" min="64" max="32768" step="256"
              value={maxTokens}
              onChange={(e) => setMaxTokens(Number(e.target.value))}
              className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-100 text-xs font-mono"
            />
          </div>
          <Button variant="ghost" size="sm" onClick={clearMessages}>
            <Trash2 className="w-4 h-4" />
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
            placeholder="System prompt (optional)…"
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
        <div className="relative" ref={templateRef}>
          <button
            onClick={() => setShowTemplates((v) => !v)}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded border border-zinc-700/50 hover:border-zinc-600 bg-zinc-800/60 transition-colors"
          >
            <BookOpen className="w-3 h-3" />
            Templates
            <ChevronDown className="w-3 h-3" />
          </button>
          {showTemplates && (
            <div className="absolute right-0 top-full mt-1 w-72 bg-zinc-900 border border-white/10 rounded-lg shadow-xl z-50">
              <div className="px-3 py-2 border-b border-white/5 text-xs text-zinc-400 font-semibold">
                Prompt Templates
              </div>
              {templates.length === 0 ? (
                <div className="px-3 py-3 text-xs text-zinc-600">
                  No templates saved. Add them in{" "}
                  <a href="/settings" className="text-indigo-400 hover:underline">Settings</a>.
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto">
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        setSystemPrompt(t.content);
                        setShowTemplates(false);
                      }}
                      className="w-full text-left px-3 py-2.5 hover:bg-zinc-800 transition-colors border-b border-white/5 last:border-0"
                    >
                      <div className="text-xs font-medium text-zinc-200">{t.name}</div>
                      {t.description && (
                        <div className="text-xs text-zinc-500 mt-0.5 truncate">{t.description}</div>
                      )}
                      <div className="text-xs text-zinc-600 mt-0.5 truncate font-mono">{t.content}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

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
          <span className="text-xs text-zinc-700">No files attached — attach files to inject relevant context into your prompts</span>
        )}
      </div>

      {!activeModelId && (
        <div className="m-6 p-4 rounded-lg bg-amber-900/20 border border-amber-700/50 text-amber-300 text-sm">
          No model loaded. Go to <a href="/models" className="underline">Models</a> to load one first.
        </div>
      )}

      {error && (
        <div className="mx-6 mt-4 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-zinc-600 py-16">Start a conversation</div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn(
              "max-w-3xl rounded-xl px-4 py-3 text-sm",
              msg.role === "user"
                ? "ml-auto bg-indigo-600/20 border border-indigo-500/30 text-zinc-100"
                : "mr-auto bg-zinc-900/60 border border-white/10 text-zinc-200 font-mono whitespace-pre-wrap"
            )}
          >
            {msg.content}
            {streaming && i === messages.length - 1 && msg.role === "assistant" && (
              <span className="inline-block w-1.5 h-4 ml-0.5 bg-indigo-400 animate-pulse rounded-sm" />
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-white/10 px-6 py-4">
        <div className="flex gap-3 max-w-4xl">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={activeModelId ? "Send a message…" : "Load a model first…"}
            disabled={!activeModelId || streaming}
            className="flex-1"
          />
          <Button
            variant="primary"
            onClick={handleSend}
            disabled={!activeModelId || streaming || !input.trim()}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
