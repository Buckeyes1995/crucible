"use client";

import { useEffect, useRef, useState } from "react";
import { useChatStore } from "@/lib/stores/chat";
import { useModelsStore } from "@/lib/stores/models";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMs, formatTps, cn } from "@/lib/utils";
import { Send, Trash2 } from "lucide-react";

export default function ChatPage() {
  const { messages, streaming, stats, error, sendMessage, clearMessages } = useChatStore();
  const { activeModelId } = useModelsStore();
  const [input, setInput] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    sendMessage(text, temperature, maxTokens);
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
          {/* Stats */}
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
              type="number" min="64" max="8192" step="64"
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
