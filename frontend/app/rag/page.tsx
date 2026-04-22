"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/Toast";
import { cn } from "@/lib/utils";
import {
  Database, FolderPlus, Loader2, Trash2, Search, X as XIcon, FileText, Hash, FolderOpen,
} from "lucide-react";

type RagIndex = {
  slug: string;
  name: string;
  source_dir: string;
  chunk_count: number;
  doc_count: number;
  avg_chunk_len: number;
  created_at: number;
  updated_at: number;
};

type Hit = {
  chunk_id: number;
  score: number;
  doc_path: string;
  abs_path: string;
  offset: number;
  text: string;
};

export default function RagPage() {
  const [indexes, setIndexes] = useState<RagIndex[]>([]);
  const [active, setActive] = useState<RagIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/rag2/indexes");
      if (r.ok) setIndexes(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const runQuery = async () => {
    if (!active || !q.trim()) return;
    setSearching(true);
    try {
      const r = await fetch(`/api/rag2/indexes/${active.slug}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: q.trim(), top_k: 8 }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setHits(data.results);
    } catch (e) {
      toast(`Query failed: ${(e as Error).message}`, "error");
    } finally {
      setSearching(false);
    }
  };

  const del = async (slug: string, name: string) => {
    if (!confirm(`Delete index "${name}"? This removes chunks + postings on disk.`)) return;
    await fetch(`/api/rag2/indexes/${slug}`, { method: "DELETE" });
    if (active?.slug === slug) { setActive(null); setHits([]); }
    refresh();
  };

  return (
    <div className="flex h-full min-h-screen">
      <div className="w-80 border-r border-white/[0.04] flex flex-col">
        <div className="px-4 py-3 border-b border-white/[0.04]">
          <PageHeader
            icon={<Database className="w-5 h-5" />}
            title="RAG Indexes"
            description="BM25 retrieval over local directories"
          >
            <Button variant="primary" size="sm" onClick={() => setNewOpen(true)} className="gap-1.5">
              <FolderPlus className="w-3.5 h-3.5" /> New index
            </Button>
          </PageHeader>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-4 text-xs text-zinc-500">Loading…</p>
          ) : indexes.length === 0 ? (
            <p className="p-6 text-sm text-zinc-500 text-center">
              No indexes yet. Click <strong>New index</strong> and point it at a directory.
            </p>
          ) : (
            <ul>
              {indexes.map(ix => (
                <li
                  key={ix.slug}
                  onClick={() => { setActive(ix); setHits([]); }}
                  className={cn(
                    "group px-4 py-2.5 border-b border-white/[0.04] cursor-pointer hover:bg-zinc-900/60",
                    active?.slug === ix.slug && "bg-indigo-950/20",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-zinc-200 truncate flex-1">{ix.name}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); del(ix.slug, ix.name); }}
                      className="text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100"
                      title="Delete"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="text-[10px] text-zinc-500 font-mono truncate">{ix.source_dir}</div>
                  <div className="flex gap-3 text-[10px] text-zinc-600 mt-0.5 font-mono">
                    <span className="flex items-center gap-1"><FileText className="w-2.5 h-2.5" />{ix.doc_count} docs</span>
                    <span className="flex items-center gap-1"><Hash className="w-2.5 h-2.5" />{ix.chunk_count} chunks</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!active ? (
          <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
            Pick an index on the left, or click <strong className="mx-1 text-zinc-300">New index</strong>.
          </div>
        ) : (
          <div className="px-6 py-5">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-zinc-100">{active.name}</h2>
              <p className="text-[11px] text-zinc-500 font-mono mt-0.5">{active.source_dir}</p>
              <div className="flex gap-3 text-[11px] text-zinc-500 mt-1 font-mono">
                <span>{active.doc_count} docs</span>
                <span>· {active.chunk_count} chunks</span>
                <span>· avg {Math.round(active.avg_chunk_len)} chars/chunk</span>
              </div>
            </div>

            <div className="flex gap-2 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") runQuery(); }}
                  placeholder="Ask a question…"
                  className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-white/[0.08] rounded text-sm text-zinc-100"
                />
              </div>
              <Button variant="primary" onClick={runQuery} disabled={!q.trim() || searching} className="gap-1.5">
                {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                Query
              </Button>
            </div>

            {hits.length === 0 && q.trim() && !searching ? (
              <p className="text-sm text-zinc-500">No matches. BM25 only surfaces chunks that contain query tokens — try different words.</p>
            ) : (
              <ol className="space-y-2">
                {hits.map((h, i) => (
                  <li key={`${h.doc_path}-${h.chunk_id}`} className="rounded-lg border border-white/[0.06] bg-zinc-950 p-3">
                    <div className="flex items-center gap-2 text-[10px] font-mono mb-1">
                      <span className="text-zinc-500">#{i + 1}</span>
                      <span className="text-indigo-300 truncate flex-1" title={h.abs_path}>{h.doc_path}</span>
                      <span className="text-zinc-500">· score {h.score.toFixed(2)}</span>
                    </div>
                    <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed">{h.text}</pre>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>

      {newOpen && (
        <NewIndexDialog onClose={() => setNewOpen(false)} onCreated={() => { setNewOpen(false); refresh(); }} />
      )}
    </div>
  );
}

function NewIndexDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [dir, setDir] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    if (!name.trim() || !dir.trim()) return;
    setSaving(true);
    try {
      const r = await fetch("/api/rag2/indexes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), source_dir: dir.trim() }),
      });
      if (!r.ok) {
        const err = await r.text();
        throw new Error(err || `HTTP ${r.status}`);
      }
      toast("Index built", "success");
      onCreated();
    } catch (e) {
      toast(`Build failed: ${(e as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl">
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-indigo-300" /> New RAG index
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
            <XIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-1">Name</label>
            <input
              autoFocus
              value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. My notes"
              className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2.5 py-1.5 text-sm text-zinc-100"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-1">Source directory</label>
            <input
              value={dir} onChange={e => setDir(e.target.value)}
              placeholder="/Users/you/Documents/notes"
              className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2.5 py-1.5 text-sm text-zinc-100 font-mono"
            />
            <p className="text-[10px] text-zinc-600 mt-1">
              Walks recursively. Indexes text files (.md, .txt, .py, .js, .json, .yaml…) under 512 KB each. Hidden + node_modules / .venv / build dirs skipped.
            </p>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-white/[0.08] flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={!name.trim() || !dir.trim() || saving} className="gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderPlus className="w-3.5 h-3.5" />}
            Build
          </Button>
        </div>
      </div>
    </div>
  );
}
