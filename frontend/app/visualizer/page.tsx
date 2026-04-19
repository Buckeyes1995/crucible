"use client";

import { useEffect, useRef, useState } from "react";
import { api, readSSE, type ModelEntry, type PromptTemplate } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Eye, Send, Loader2, BookOpen, ChevronDown } from "lucide-react";

type TokenData = { token: string; timestamp: number; delta_ms: number };

export default function VisualizerPage() {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [prompt, setPrompt] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [ttft, setTtft] = useState<number | null>(null);
  const [tps, setTps] = useState<number | null>(null);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const templateRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api.models.list().then(setModels); }, []);
  useEffect(() => { api.templates.list().then(setTemplates).catch(() => {}); }, []);
  useEffect(() => {
    if (!showTemplates) return;
    const h = (e: MouseEvent) => {
      if (templateRef.current && !templateRef.current.contains(e.target as Node)) setShowTemplates(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showTemplates]);

  const activeModel = models.find((m) => m.id === models.find(() => true)?.id);

  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!prompt.trim() || streaming) return;
    setError(null);
    setStreaming(true);
    setTokens([]);
    setTtft(null);
    setTps(null);

    const t0 = performance.now();
    let prevTime = t0;
    const collected: TokenData[] = [];

    try {
      const resp = await api.chat({
        messages: [{ role: "user", content: prompt.trim() }],
        temperature: 0.7,
        max_tokens: 2048,
      });
      if (!resp.ok) {
        const body = await resp.text();
        let msg = body;
        try { msg = (JSON.parse(body).detail || body).toString(); } catch {}
        setError(`${resp.status}: ${msg}`);
        setStreaming(false);
        return;
      }

      await readSSE(resp, (data) => {
        const event = data.event as string;
        if (event === "token") {
          const now = performance.now();
          const delta = now - prevTime;
          prevTime = now;
          const td: TokenData = { token: data.token as string, timestamp: now - t0, delta_ms: delta };
          collected.push(td);
          setTokens([...collected]);
          containerRef.current?.scrollTo(0, containerRef.current.scrollHeight);
        } else if (event === "done") {
          setTtft(data.ttft_ms as number | null);
          setTps(data.tps as number | null);
          setStreaming(false);
        } else if (event === "error") {
          setError((data.message as string) || "Stream error");
        }
      });
    } catch (e) {
      setError((e as Error).message || "Request failed");
    } finally {
      setStreaming(false);
    }
  }

  const maxDelta = Math.max(...tokens.map((t) => t.delta_ms), 1);
  const avgDelta = tokens.length > 1 ? tokens.slice(1).reduce((s, t) => s + t.delta_ms, 0) / (tokens.length - 1) : 0;

  const getColor = (delta: number) => {
    if (delta < avgDelta * 0.5) return "bg-emerald-500";
    if (delta < avgDelta * 1.5) return "bg-indigo-500";
    if (delta < avgDelta * 3) return "bg-amber-500";
    return "bg-red-500";
  };

  const getTextColor = (delta: number) => {
    if (delta < avgDelta * 0.5) return "text-emerald-300";
    if (delta < avgDelta * 1.5) return "text-zinc-200";
    if (delta < avgDelta * 3) return "text-amber-300";
    return "text-red-300";
  };

  return (
    <div className="flex flex-col h-full min-h-screen">
      <div className="px-6 py-4 border-b border-white/[0.04] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Eye className="w-5 h-5 text-indigo-400" />
          <h1 className="text-lg font-semibold text-zinc-100">Token Visualizer</h1>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono text-zinc-400">
          {ttft != null && <span>TTFT: <span className="text-indigo-300">{ttft}ms</span></span>}
          {tps != null && <span>Speed: <span className="text-indigo-300">{tps} tok/s</span></span>}
          {tokens.length > 0 && <span>Tokens: <span className="text-zinc-200">{tokens.length}</span></span>}
          {avgDelta > 0 && <span>Avg: <span className="text-zinc-200">{avgDelta.toFixed(1)}ms/tok</span></span>}
        </div>
      </div>

      <div className="px-6 py-3 border-b border-white/[0.04] flex gap-3 items-start">
        <div className="flex-1 flex flex-col gap-1.5">
          <div ref={templateRef} className="relative self-start">
            <button
              onClick={() => setShowTemplates((v) => !v)}
              disabled={streaming}
              className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded border border-zinc-700/50 hover:border-zinc-600 bg-zinc-800/60 transition-colors disabled:opacity-50"
            >
              <BookOpen className="w-3 h-3" /> Templates
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
            className="w-full bg-zinc-900 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
            placeholder="Enter prompt…" value={prompt} onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()} disabled={streaming}
          />
        </div>
        <Button onClick={send} disabled={streaming || !prompt.trim()} variant="primary" className="gap-1.5 self-end">
          {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send
        </Button>
      </div>

      {error && (
        <div className="px-6 py-2 border-b border-red-500/20 bg-red-950/30 text-sm text-red-300">
          {error}
          {error.toLowerCase().includes("no model loaded") && (
            <span className="text-red-400/70"> — load one on <a href="/models" className="underline">/models</a> first.</span>
          )}
        </div>
      )}

      {/* Token waterfall */}
      <div ref={containerRef} className="flex-1 overflow-y-auto p-6">
        {tokens.length === 0 && !streaming && (
          <div className="text-center py-16 text-zinc-600">
            <Eye className="w-12 h-12 mx-auto mb-3 text-zinc-700" />
            <p>Send a prompt to visualize token generation timing</p>
          </div>
        )}

        {/* Inline colored text view */}
        {tokens.length > 0 && (
          <div className="space-y-6">
            {/* Colored text output */}
            <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4">
              <h3 className="text-xs text-zinc-500 mb-3 uppercase tracking-wider">Colored by speed</h3>
              <div className="text-sm leading-relaxed whitespace-pre-wrap">
                {tokens.map((t, i) => (
                  <span key={i} className={cn(getTextColor(t.delta_ms), "cursor-default")}
                    title={`${t.delta_ms.toFixed(1)}ms — token ${i + 1}`}>
                    {t.token}
                  </span>
                ))}
              </div>
            </div>

            {/* Waterfall bars */}
            <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4">
              <h3 className="text-xs text-zinc-500 mb-3 uppercase tracking-wider">Token Waterfall</h3>
              <div className="space-y-px max-h-96 overflow-y-auto">
                {tokens.slice(0, 200).map((t, i) => (
                  <div key={i} className="flex items-center gap-2 h-5">
                    <span className="w-8 text-[10px] font-mono text-zinc-600 text-right shrink-0">{i + 1}</span>
                    <div className="flex-1 relative h-3">
                      <div className={cn("h-full rounded-sm", getColor(t.delta_ms))}
                        style={{ width: `${Math.max((t.delta_ms / maxDelta) * 100, 1)}%` }} />
                    </div>
                    <span className="w-16 text-[10px] font-mono text-zinc-500 text-right shrink-0">{t.delta_ms.toFixed(1)}ms</span>
                    <span className="w-20 text-[10px] text-zinc-600 truncate shrink-0">{JSON.stringify(t.token).slice(1, -1)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Legend */}
            <div className="flex gap-4 text-xs text-zinc-500">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500" /> Fast (&lt;{(avgDelta * 0.5).toFixed(0)}ms)</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-indigo-500" /> Normal</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-500" /> Slow</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500" /> Bottleneck (&gt;{(avgDelta * 3).toFixed(0)}ms)</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
