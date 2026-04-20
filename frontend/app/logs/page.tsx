"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { FileText, Play, Square } from "lucide-react";
import { cn } from "@/lib/utils";

type LogSource = { key: string; path: string; size_bytes: number; mtime: number };

export default function LogsPage() {
  const [sources, setSources] = useState<LogSource[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [following, setFollowing] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/logs/sources").then(r => r.json()).then(setSources).catch(() => {});
  }, []);

  const stop = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setFollowing(false);
  }, []);

  const follow = async (key: string) => {
    stop();
    setActive(key);
    setLines([]);
    // Preload the last 200 lines.
    try {
      const r = await fetch(`/api/logs/${encodeURIComponent(key)}/tail?lines=500`);
      const d = await r.json();
      setLines((d.content as string).split("\n"));
    } catch {}
    // Then follow live.
    const es = new EventSource(`/api/logs/${encodeURIComponent(key)}/stream`);
    es.onmessage = (evt) => {
      try {
        const { line } = JSON.parse(evt.data);
        setLines((prev) => {
          const next = [...prev, line];
          // Keep the buffer bounded — 4K lines is enough for context.
          return next.length > 4000 ? next.slice(next.length - 4000) : next;
        });
      } catch {}
    };
    esRef.current = es;
    setFollowing(true);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines.length]);

  useEffect(() => () => { stop(); }, [stop]);

  return (
    <div className="flex flex-col h-full min-h-screen">
      <div className="px-6 py-4 border-b border-white/[0.04]">
        <PageHeader icon={<FileText className="w-5 h-5" />} title="Logs" description="Live tail of Crucible + inference backend logs" />
      </div>
      <div className="grid grid-cols-[240px_1fr] flex-1 min-h-0">
        <aside className="border-r border-white/[0.04] p-3 space-y-1 overflow-y-auto">
          {sources.length === 0 ? (
            <p className="text-xs text-zinc-600">No log sources found.</p>
          ) : sources.map(s => (
            <button
              key={s.key}
              onClick={() => follow(s.key)}
              className={cn(
                "w-full text-left px-2 py-1.5 rounded text-xs transition-colors",
                active === s.key
                  ? "bg-indigo-600/30 text-indigo-200 border border-indigo-500/40"
                  : "text-zinc-300 hover:bg-zinc-800",
              )}
            >
              <div className="font-medium">{s.key}</div>
              <div className="text-[10px] text-zinc-500 font-mono truncate">{s.path}</div>
            </button>
          ))}
        </aside>
        <div className="flex flex-col min-h-0">
          <div className="px-4 py-2 border-b border-white/[0.04] flex items-center gap-2">
            {active ? (
              <>
                <span className="text-xs text-zinc-400">Following</span>
                <span className="text-xs font-mono text-indigo-300">{active}</span>
                {following ? (
                  <button onClick={stop} className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-xs bg-red-950/30 text-red-300 border border-red-500/30 hover:bg-red-900/30">
                    <Square className="w-3 h-3" /> Stop
                  </button>
                ) : (
                  <button onClick={() => active && follow(active)} className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-xs bg-indigo-950/30 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-900/30">
                    <Play className="w-3 h-3" /> Follow
                  </button>
                )}
              </>
            ) : (
              <span className="text-xs text-zinc-500">Pick a log source on the left.</span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-3 text-[11px] font-mono text-zinc-300 bg-black/40">
            {lines.map((l, i) => <div key={i} className="whitespace-pre">{l}</div>)}
            <div ref={bottomRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
