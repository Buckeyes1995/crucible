"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/Toast";
import { cn } from "@/lib/utils";
import { useProjectsStore, projectQuery } from "@/lib/stores/projects";
import { useModelsStore } from "@/lib/stores/models";
import {
  FileCode2, Plus, Save, GitBranch, Play, Trash2, X as XIcon,
  Loader2, ChevronRight, ListChecks, Sparkles,
} from "lucide-react";

type Version = {
  id: string;
  doc_id: string;
  parent_version_id?: string | null;
  content: string;
  note?: string | null;
  created_at: string;
};

type Doc = {
  id: string;
  name: string;
  project_id?: string | null;
  description?: string | null;
  version_count: number;
  head_version_id?: string | null;
  created_at: string;
  updated_at: string;
  versions?: Version[];
};

type TestSet = {
  id: string;
  doc_id: string;
  name: string;
  inputs: { input: string; expected?: string | null }[];
  created_at: string;
};

type LiveItem = {
  i: number;
  input: string;
  a_output: string;
  b_output: string;
  a_tokens: number;
  b_tokens: number;
  a_elapsed_ms: number;
  b_elapsed_ms: number;
};

export default function PromptsIdePage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [active, setActive] = useState<Doc | null>(null);
  const [newDocOpen, setNewDocOpen] = useState(false);
  const activeProject = useProjectsStore(s => s.activeId);
  const activeModelId = useModelsStore(s => s.activeModelId);

  const refreshDocs = useCallback(async () => {
    const q = projectQuery(activeProject);
    const url = q ? `/api/prompts/docs?${q}` : "/api/prompts/docs";
    const r = await fetch(url);
    if (r.ok) setDocs(await r.json());
  }, [activeProject]);

  useEffect(() => { refreshDocs(); }, [refreshDocs]);

  const openDoc = async (id: string) => {
    const r = await fetch(`/api/prompts/docs/${id}`);
    if (r.ok) setActive(await r.json());
  };

  const delDoc = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? All versions + test sets go too.`)) return;
    await fetch(`/api/prompts/docs/${id}`, { method: "DELETE" });
    if (active?.id === id) setActive(null);
    refreshDocs();
  };

  return (
    <div className="flex h-full min-h-screen">
      <div className="w-80 border-r border-white/[0.04] flex flex-col">
        <div className="px-4 py-3 border-b border-white/[0.04]">
          <PageHeader
            icon={<FileCode2 className="w-5 h-5" />}
            title="Prompts"
            description="Versioned prompts + A/B testing"
          >
            <Button variant="primary" size="sm" onClick={() => setNewDocOpen(true)} className="gap-1.5">
              <Plus className="w-3.5 h-3.5" /> New
            </Button>
          </PageHeader>
        </div>
        <div className="flex-1 overflow-y-auto">
          {docs.length === 0 ? (
            <p className="p-6 text-sm text-zinc-500 text-center">No prompts yet.</p>
          ) : (
            <ul>
              {docs.map(d => (
                <li
                  key={d.id}
                  onClick={() => openDoc(d.id)}
                  className={cn(
                    "group px-4 py-2.5 border-b border-white/[0.04] cursor-pointer hover:bg-zinc-900/60",
                    active?.id === d.id && "bg-indigo-950/20",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-zinc-200 truncate flex-1">{d.name}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); delDoc(d.id, d.name); }}
                      className="text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="text-[10px] text-zinc-500 font-mono">{d.version_count} versions</div>
                  {d.description && <div className="text-[11px] text-zinc-500 truncate mt-0.5">{d.description}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!active ? (
          <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
            Pick a prompt on the left, or <strong className="mx-1 text-zinc-300">New</strong>.
          </div>
        ) : (
          <DocEditor key={active.id} doc={active} refreshDoc={() => openDoc(active.id)} activeModelId={activeModelId} />
        )}
      </div>

      {newDocOpen && <NewDocDialog onClose={() => setNewDocOpen(false)} onCreated={(d) => { setNewDocOpen(false); refreshDocs(); setActive(d); }} />}
    </div>
  );
}

function DocEditor({ doc, refreshDoc, activeModelId }: { doc: Doc; refreshDoc: () => void; activeModelId: string | null }) {
  const head = useMemo(() => (doc.versions ?? []).find(v => v.id === doc.head_version_id) ?? (doc.versions ?? [])[0], [doc]);
  const [draft, setDraft] = useState<string>(head?.content ?? "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [abOpen, setAbOpen] = useState(false);
  const [testSets, setTestSets] = useState<TestSet[]>([]);

  useEffect(() => { setDraft(head?.content ?? ""); }, [head?.id]);

  const refreshTestSets = useCallback(async () => {
    const r = await fetch(`/api/prompts/docs/${doc.id}/test-sets`);
    if (r.ok) setTestSets(await r.json());
  }, [doc.id]);

  useEffect(() => { refreshTestSets(); }, [refreshTestSets]);

  const save = async () => {
    if (!draft.trim() || draft === head?.content) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/prompts/docs/${doc.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft, note: note.trim() || undefined, parent_version_id: head?.id ?? null }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast("New version saved", "success");
      setNote("");
      refreshDoc();
    } catch (e) {
      toast(`Save failed: ${(e as Error).message}`, "error");
    } finally { setSaving(false); }
  };

  return (
    <div className="px-6 py-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-zinc-100">{doc.name}</h2>
        <div className="flex gap-2">
          <Button variant="primary" size="sm" onClick={save} disabled={saving || !draft.trim() || draft === head?.content} className="gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save version
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setAbOpen(true)} className="gap-1.5">
            <GitBranch className="w-3.5 h-3.5" /> A/B test…
          </Button>
        </div>
      </div>

      <div className="mb-3 text-[11px] text-zinc-500 font-mono">
        Head: {head ? `${head.id} — ${new Date(head.created_at).toLocaleString()}` : "no versions yet"}
      </div>

      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        rows={14}
        placeholder="Prompt content… use {{input}} as the placeholder for test-set inputs during A/B runs."
        className="w-full bg-zinc-900 border border-white/[0.08] rounded px-3 py-2 text-sm text-zinc-100 font-mono leading-relaxed"
      />
      <input
        value={note} onChange={e => setNote(e.target.value)}
        placeholder="Version note (optional) — what changed?"
        className="w-full mt-2 bg-zinc-900 border border-white/[0.08] rounded px-2.5 py-1.5 text-xs text-zinc-100"
      />

      <div className="grid grid-cols-2 gap-4 mt-5">
        <VersionsPanel doc={doc} />
        <TestSetsPanel doc={doc} testSets={testSets} refresh={refreshTestSets} />
      </div>

      {abOpen && (
        <ABRunDialog
          doc={doc}
          testSets={testSets}
          activeModelId={activeModelId}
          onClose={() => setAbOpen(false)}
        />
      )}
    </div>
  );
}

function VersionsPanel({ doc }: { doc: Doc }) {
  const versions = doc.versions ?? [];
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-2">Versions</h3>
      <ul className="space-y-1 max-h-60 overflow-y-auto">
        {versions.map(v => (
          <li key={v.id} className="rounded border border-white/[0.06] bg-zinc-950 px-2 py-1.5 text-[11px] font-mono">
            <div className="flex gap-2">
              <span className="text-zinc-500 truncate flex-1">{v.id}</span>
              <span className="text-zinc-600">{new Date(v.created_at).toLocaleString()}</span>
            </div>
            {v.note && <div className="text-zinc-400 mt-0.5">{v.note}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TestSetsPanel({ doc, testSets, refresh }: { doc: Doc; testSets: TestSet[]; refresh: () => void }) {
  const [name, setName] = useState("");
  const [inputs, setInputs] = useState("");

  const save = async () => {
    const parsed = inputs.split("\n").map(s => s.trim()).filter(Boolean).map(s => ({ input: s }));
    if (parsed.length === 0) return;
    const r = await fetch(`/api/prompts/docs/${doc.id}/test-sets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() || "Set", inputs: parsed }),
    });
    if (r.ok) { setName(""); setInputs(""); refresh(); toast("Test set saved", "success"); }
    else toast("Save failed", "error");
  };

  const del = async (id: string) => {
    await fetch(`/api/prompts/test-sets/${id}`, { method: "DELETE" });
    refresh();
  };

  return (
    <div>
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-2">Test sets</h3>
      <ul className="space-y-1 max-h-44 overflow-y-auto">
        {testSets.map(ts => (
          <li key={ts.id} className="rounded border border-white/[0.06] bg-zinc-950 px-2 py-1.5 text-[11px] font-mono flex items-center gap-2">
            <span className="flex-1 truncate">{ts.name} <span className="text-zinc-600">· {ts.inputs.length}</span></span>
            <button onClick={() => del(ts.id)} className="text-zinc-600 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
          </li>
        ))}
      </ul>
      <input
        value={name} onChange={e => setName(e.target.value)}
        placeholder="New set name"
        className="w-full mt-2 bg-zinc-900 border border-white/[0.08] rounded px-2 py-1 text-[11px] text-zinc-100"
      />
      <textarea
        value={inputs} onChange={e => setInputs(e.target.value)}
        placeholder="one input per line"
        rows={4}
        className="w-full mt-1 bg-zinc-900 border border-white/[0.08] rounded px-2 py-1 text-[11px] text-zinc-100 font-mono"
      />
      <Button size="sm" variant="secondary" onClick={save} className="mt-1 gap-1.5">
        <ListChecks className="w-3 h-3" /> Add set
      </Button>
    </div>
  );
}

function ABRunDialog({ doc, testSets, activeModelId, onClose }: {
  doc: Doc;
  testSets: TestSet[];
  activeModelId: string | null;
  onClose: () => void;
}) {
  const versions = doc.versions ?? [];
  const [a, setA] = useState<string>(versions[1]?.id ?? versions[0]?.id ?? "");
  const [b, setB] = useState<string>(versions[0]?.id ?? "");
  const [tsId, setTsId] = useState<string>(testSets[0]?.id ?? "");
  const [running, setRunning] = useState(false);
  const [items, setItems] = useState<LiveItem[]>([]);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = async () => {
    if (!activeModelId) { toast("Load a model first", "error"); return; }
    if (a === b) { toast("Pick two different versions", "error"); return; }
    setItems([]); setSummary(null); setRunning(true);
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const r = await fetch(`/api/prompts/docs/${doc.id}/ab`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version_a_id: a, version_b_id: b, test_set_id: tsId || undefined }),
        signal: ctl.signal,
      });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = ""; let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        if (value) buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of chunk.split("\n")) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const payload = t.slice(5).trim();
            if (!payload) continue;
            try {
              const evt = JSON.parse(payload);
              if (evt.event === "item") setItems(cur => [...cur, evt as LiveItem]);
              else if (evt.event === "finished") setSummary(evt.summary);
            } catch {}
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast(`Run failed: ${(e as Error).message}`, "error");
    } finally {
      setRunning(false); abortRef.current = null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-4xl max-h-[92vh] rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl flex flex-col">
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-indigo-300" /> A/B run — {doc.name}
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200"><XIcon className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-3 border-b border-white/[0.06] grid grid-cols-3 gap-3 items-end">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1">Version A</label>
            <select value={a} onChange={e => setA(e.target.value)} className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2 py-1 text-xs font-mono text-zinc-100">
              {versions.map(v => <option key={v.id} value={v.id}>{v.id} {v.note ? "· " + v.note.slice(0, 24) : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1">Version B</label>
            <select value={b} onChange={e => setB(e.target.value)} className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2 py-1 text-xs font-mono text-zinc-100">
              {versions.map(v => <option key={v.id} value={v.id}>{v.id} {v.note ? "· " + v.note.slice(0, 24) : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1">Test set</label>
            <select value={tsId} onChange={e => setTsId(e.target.value)} className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2 py-1 text-xs text-zinc-100">
              <option value="">(none — pick one)</option>
              {testSets.map(t => <option key={t.id} value={t.id}>{t.name} · {t.inputs.length}</option>)}
            </select>
          </div>
        </div>
        <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
          {running ? (
            <Button variant="destructive" size="sm" onClick={() => abortRef.current?.abort()}>
              <XIcon className="w-3.5 h-3.5 mr-1" /> Stop
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={run} disabled={!tsId || a === b}>
              <Play className="w-3.5 h-3.5 mr-1" /> Run A/B
            </Button>
          )}
          {summary && (
            <span className="text-[11px] text-zinc-400 font-mono">
              <Sparkles className="w-3 h-3 inline-block text-emerald-400 mr-1" />
              A avg {(summary.a_avg_tokens as number).toFixed(0)} tok / {(summary.a_avg_ms as number).toFixed(0)}ms &nbsp;·&nbsp;
              B avg {(summary.b_avg_tokens as number).toFixed(0)} tok / {(summary.b_avg_ms as number).toFixed(0)}ms
            </span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {items.map(it => (
            <div key={it.i} className="rounded-lg border border-white/[0.06] bg-zinc-950 p-3">
              <div className="text-[11px] text-zinc-400 mb-2">#{it.i} · {it.input}</div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-indigo-300 mb-1">A · {it.a_tokens} tok · {it.a_elapsed_ms.toFixed(0)}ms</div>
                  <pre className="bg-black/30 border border-white/[0.06] rounded p-2 whitespace-pre-wrap font-mono text-[11px] max-h-40 overflow-y-auto">{it.a_output}</pre>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-emerald-300 mb-1">B · {it.b_tokens} tok · {it.b_elapsed_ms.toFixed(0)}ms</div>
                  <pre className="bg-black/30 border border-white/[0.06] rounded p-2 whitespace-pre-wrap font-mono text-[11px] max-h-40 overflow-y-auto">{it.b_output}</pre>
                </div>
              </div>
            </div>
          ))}
          {!running && items.length === 0 && (
            <p className="text-sm text-zinc-500">Pick two versions + a test set and click <strong>Run A/B</strong>.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function NewDocDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (d: Doc) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("You are a helpful assistant. When the user asks: {{input}}");
  const activeProject = useProjectsStore(s => s.activeId);
  const submit = async () => {
    const project_id = activeProject && activeProject !== "__none__" ? activeProject : null;
    const r = await fetch("/api/prompts/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), description: description.trim() || null, project_id, initial_content: content.trim() }),
    });
    if (r.ok) { onCreated(await r.json()); toast("Prompt created", "success"); }
    else toast("Create failed", "error");
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl">
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">New prompt</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200"><XIcon className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2.5 py-1.5 text-sm text-zinc-100" autoFocus />
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description (optional)" className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2.5 py-1.5 text-xs text-zinc-100" />
          <textarea value={content} onChange={e => setContent(e.target.value)} rows={8} placeholder="Initial prompt…" className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2.5 py-1.5 text-xs text-zinc-100 font-mono" />
        </div>
        <div className="px-5 py-3 border-t border-white/[0.08] flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={!name.trim() || !content.trim()} className="gap-1.5">
            <ChevronRight className="w-3.5 h-3.5" /> Create
          </Button>
        </div>
      </div>
    </div>
  );
}
