"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Trash2, Download, MessageSquare, ArrowLeft } from "lucide-react";
import Link from "next/link";

const BASE = "/api";

type Session = { id: string; title: string; model_id: string | null; created_at: string; updated_at: string };
type Message = { id: number; role: string; content: string; created_at: string };

export default function ChatHistoryPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSessions = (q?: string) => {
    const url = q ? `${BASE}/chat/sessions?q=${encodeURIComponent(q)}` : `${BASE}/chat/sessions`;
    fetch(url).then((r) => r.json()).then(setSessions).finally(() => setLoading(false));
  };

  useEffect(() => { fetchSessions(); }, []);

  useEffect(() => {
    if (!selected) { setMessages([]); return; }
    fetch(`${BASE}/chat/sessions/${selected}`).then((r) => r.json()).then((d) => setMessages(d.messages || []));
  }, [selected]);

  const doSearch = () => fetchSessions(search.trim() || undefined);

  const deleteSession = async (id: string) => {
    await fetch(`${BASE}/chat/sessions/${id}`, { method: "DELETE" });
    setSessions((s) => s.filter((x) => x.id !== id));
    if (selected === id) { setSelected(null); setMessages([]); }
  };

  const exportMarkdown = async (id: string) => {
    const r = await fetch(`${BASE}/chat/sessions/${id}/export`);
    const { markdown } = await r.json();
    navigator.clipboard.writeText(markdown);
  };

  return (
    <div className="flex h-full min-h-screen">
      {/* Session list */}
      <div className="w-80 border-r border-white/10 flex flex-col">
        <div className="p-3 border-b border-white/10 space-y-2">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-indigo-400" />
            <span className="text-sm font-medium text-zinc-200">Chat History</span>
          </div>
          <div className="flex gap-1.5">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="text-xs"
              onKeyDown={(e) => e.key === "Enter" && doSearch()} />
            <Button variant="ghost" onClick={doSearch} className="px-2"><Search className="w-3.5 h-3.5" /></Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? <div className="p-4 text-xs text-zinc-500">Loading…</div> :
           sessions.length === 0 ? <div className="p-4 text-xs text-zinc-500">No conversations yet</div> :
           sessions.map((s) => (
            <div key={s.id} onClick={() => setSelected(s.id)}
              className={cn("px-3 py-2.5 border-b border-white/5 cursor-pointer transition-colors",
                selected === s.id ? "bg-indigo-900/20" : "hover:bg-white/5")}>
              <div className="text-sm text-zinc-200 truncate">{s.title}</div>
              <div className="flex justify-between text-[10px] text-zinc-600 mt-0.5">
                <span>{s.model_id?.replace(/^mlx:/, "") ?? ""}</span>
                <span>{new Date(s.updated_at).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Message viewer */}
      <div className="flex-1 flex flex-col">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">Select a conversation</div>
        ) : (
          <>
            <div className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-300">
                {sessions.find((s) => s.id === selected)?.title}
              </span>
              <div className="flex gap-1">
                <Button variant="ghost" className="px-2 text-xs" onClick={() => exportMarkdown(selected)} title="Copy as markdown">
                  <Download className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" className="px-2 text-xs text-red-400" onClick={() => deleteSession(selected)} title="Delete">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((m) => (
                <div key={m.id} className={cn("max-w-[80%] rounded-lg px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
                  m.role === "user" ? "bg-indigo-900/30 border border-indigo-500/20 ml-auto text-zinc-200"
                    : "bg-zinc-800/50 border border-white/5 text-zinc-300")}>
                  {m.content}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
