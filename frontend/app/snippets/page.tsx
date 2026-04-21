"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Snippet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "@/components/Toast";
import { Pin, Search, Copy, Trash2, Loader2, Tag, Clock, X as XIcon, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

export default function SnippetsPage() {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();

  const sendToChat = (content: string) => {
    try {
      sessionStorage.setItem("crucible:chat-prefill", content);
      router.push("/chat");
    } catch {
      toast("Could not send to chat", "error");
    }
  };

  const load = useCallback(async () => {
    try {
      setSnippets(await api.snippets.list());
    } catch (e) {
      toast(`Load failed: ${(e as Error).message}`, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const sn of snippets) for (const t of sn.tags) s.add(t);
    return Array.from(s).sort();
  }, [snippets]);

  const filtered = useMemo(() => {
    let xs = snippets;
    if (activeTag) xs = xs.filter(s => s.tags.includes(activeTag));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      xs = xs.filter(s =>
        s.title.toLowerCase().includes(q)
        || s.content.toLowerCase().includes(q)
        || s.tags.some(t => t.toLowerCase().includes(q)),
      );
    }
    return xs;
  }, [snippets, search, activeTag]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied", "success");
    } catch {
      toast("Copy failed — clipboard unavailable", "error");
    }
  };

  const del = async (id: string, title: string) => {
    if (!confirm(`Delete snippet "${title}"?`)) return;
    setBusy(id);
    try {
      await api.snippets.delete(id);
      toast(`Deleted ${title}`, "success");
      await load();
    } catch (e) {
      toast(`Delete failed: ${(e as Error).message}`, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-screen">
      <div className="px-6 py-4 border-b border-white/[0.04]">
        <PageHeader
          icon={<Pin className="w-5 h-5" />}
          title="Snippets"
          description="Pinned responses and useful outputs, always one click away"
        />
      </div>

      <div className="px-6 py-3 border-b border-white/[0.04] flex gap-2 items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, content, tags…"
            className="w-full bg-zinc-900 border border-white/[0.08] rounded-lg pl-8 pr-8 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
              <XIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {allTags.length > 0 && (
          <div className="flex gap-1 flex-wrap ml-auto">
            {allTags.map(t => (
              <button
                key={t}
                onClick={() => setActiveTag(activeTag === t ? null : t)}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition-colors",
                  activeTag === t
                    ? "bg-indigo-600/30 text-indigo-200 border-indigo-500/40"
                    : "bg-zinc-800 text-zinc-400 border-white/[0.06] hover:text-zinc-200",
                )}
              >
                <Tag className="w-2.5 h-2.5" />{t}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <div className="text-center text-zinc-500 py-16 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-zinc-500 py-16 text-sm">
            {snippets.length === 0 ? (
              <>Nothing pinned yet. Use the <span className="text-indigo-300">Pin</span> action on any chat response.</>
            ) : (
              <>No snippets match those filters.</>
            )}
          </div>
        ) : (
          <div className="space-y-3 max-w-4xl">
            {filtered.map(s => {
              const expanded = expandedId === s.id;
              return (
                <div key={s.id} className="rounded-xl border border-white/[0.06] bg-zinc-900/40 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-zinc-100 truncate">{s.title}</h3>
                      <div className="flex items-center gap-2 text-[10px] text-zinc-500 mt-1 flex-wrap">
                        <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" />{new Date(s.created_at * 1000).toLocaleString()}</span>
                        <span className="text-zinc-600">· {s.source}</span>
                        {s.model_id && <span className="text-zinc-600 font-mono truncate">· {s.model_id.replace(/^mlx:/, "")}</span>}
                        {s.tags.length > 0 && (
                          <span className="flex items-center gap-1">
                            · {s.tags.map(t => (
                              <span key={t} className="text-[10px] bg-indigo-900/25 text-indigo-300 border border-indigo-500/20 px-1 py-px rounded">{t}</span>
                            ))}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => sendToChat(s.content)}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-indigo-900/30 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-900/50"
                        title="Open in Chat"
                      >
                        <MessageSquare className="w-3 h-3" /> Send
                      </button>
                      <button
                        onClick={() => copy(s.content)}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-zinc-800 text-zinc-300 border border-white/[0.06] hover:bg-zinc-700"
                      >
                        <Copy className="w-3 h-3" /> Copy
                      </button>
                      <button
                        onClick={() => del(s.id, s.title)}
                        disabled={busy === s.id}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-red-950/20 text-red-300 border border-red-500/30 hover:bg-red-900/30 disabled:opacity-50"
                      >
                        {busy === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => setExpandedId(expanded ? null : s.id)}
                    className="text-[10px] text-zinc-500 hover:text-zinc-300 mt-2"
                  >
                    {expanded ? "Collapse" : "Expand"}
                  </button>
                  <pre className={cn(
                    "mt-1 text-[11px] text-zinc-300 bg-black/30 rounded p-2 whitespace-pre-wrap font-mono",
                    expanded ? "" : "max-h-24 overflow-hidden",
                  )}>{s.content}</pre>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export const dynamic = "force-static";
