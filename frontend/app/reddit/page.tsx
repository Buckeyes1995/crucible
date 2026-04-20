"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "@/components/Toast";
import {
  MessageSquare, Loader2, RefreshCw, Settings as SettingsIcon,
  Check, X as XIcon, ExternalLink, Trash2, Send,
} from "lucide-react";
import { cn } from "@/lib/utils";

type RedditConfig = {
  enabled: boolean;
  client_id: string;
  client_secret: string;
  user_agent: string;
  subreddits: string[];
  max_post_chars: number;
  max_post_age_hours: number;
  min_score: number;
  draft_system_prompt: string;
  auto_draft_on_scan: boolean;
};

type Draft = {
  id: string;
  post_id: string;
  post_permalink: string;
  post_title: string;
  post_body: string;
  subreddit: string;
  post_score: number;
  post_author: string;
  draft: string;
  model_id: string | null;
  status: "pending" | "approved" | "rejected" | "posted";
  created_at: number;
  edited_at: number | null;
};

export default function RedditPage() {
  const [config, setConfig] = useState<RedditConfig | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [showConfig, setShowConfig] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");

  const load = useCallback(async () => {
    try {
      const [c, d] = await Promise.all([
        fetch("/api/reddit/config").then(r => r.json()),
        fetch("/api/reddit/drafts").then(r => r.json()),
      ]);
      setConfig(c);
      setDrafts(d);
    } catch (e) {
      toast(`Load failed: ${(e as Error).message}`, "error");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveConfig = async (patch: Partial<RedditConfig>) => {
    try {
      const next = await fetch("/api/reddit/config", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).then(r => r.json());
      setConfig(next);
      toast("Config saved", "success");
    } catch (e) {
      toast(`Save failed: ${(e as Error).message}`, "error");
    }
  };

  const scan = async () => {
    setScanning(true);
    try {
      const r = await fetch("/api/reddit/scan", { method: "POST" });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t);
      }
      const data = await r.json();
      toast(`Scan: ${data.fetched} fetched, ${data.drafted} drafted, ${data.skipped_existing} skipped`, "success");
      await load();
    } catch (e) {
      toast(`Scan failed: ${(e as Error).message}`, "error");
    } finally {
      setScanning(false);
    }
  };

  const updateDraft = async (id: string, patch: Partial<Draft>) => {
    try {
      await fetch(`/api/reddit/drafts/${encodeURIComponent(id)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      await load();
    } catch {}
  };
  const deleteDraft = async (id: string) => {
    if (!confirm("Delete draft?")) return;
    try {
      await fetch(`/api/reddit/drafts/${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    } catch {}
  };

  const filtered = useMemo(() => {
    if (filter === "all") return drafts;
    return drafts.filter(d => d.status === filter);
  }, [drafts, filter]);

  if (!config) {
    return <div className="p-6 text-zinc-500 text-sm">Loading…</div>;
  }

  const credsOk = config.client_id.trim().length > 0 || !config.enabled;

  return (
    <div className="flex flex-col h-full min-h-screen">
      <div className="px-6 py-4 border-b border-white/[0.04]">
        <PageHeader
          icon={<MessageSquare className="w-5 h-5" />}
          title="Reddit watcher"
          description="Scan LLM subreddits, generate draft replies for manual approval — never auto-posts."
        >
          <Button variant="ghost" size="sm" onClick={() => setShowConfig(v => !v)} className="gap-1.5">
            <SettingsIcon className="w-3.5 h-3.5" /> Config
          </Button>
          <Button variant="primary" size="sm" onClick={scan} disabled={scanning || !config.enabled} className="gap-1.5">
            {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Scan now
          </Button>
        </PageHeader>
      </div>

      {!config.enabled && (
        <div className="mx-6 mt-4 px-4 py-3 rounded-xl bg-amber-950/30 border border-amber-500/15 text-amber-300/80 text-sm">
          Watcher is disabled. Toggle enabled in Config to start pulling posts.
        </div>
      )}
      {config.enabled && !credsOk && (
        <div className="mx-6 mt-4 px-4 py-3 rounded-xl bg-amber-950/30 border border-amber-500/15 text-amber-300/80 text-sm">
          Reddit credentials are blank — the watcher will fall back to the public r/{"{sub}"}/new.json endpoint. For per-user limits and write access later, add OAuth in Config.
        </div>
      )}

      {showConfig && (
        <div className="mx-6 mt-4 rounded-xl border border-white/[0.06] bg-zinc-900/40 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => saveConfig({ enabled: e.target.checked })}
              className="accent-indigo-500"
            />
            <label className="text-sm text-zinc-200">Enabled</label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Client ID" value={config.client_id} onChange={(v) => saveConfig({ client_id: v })} />
            <Field label="Client secret" value={config.client_secret} onChange={(v) => saveConfig({ client_secret: v })} secret />
            <Field label="User-Agent" value={config.user_agent} onChange={(v) => saveConfig({ user_agent: v })} className="col-span-2" />
            <Field label="Subreddits (comma)" value={config.subreddits.join(", ")} onChange={(v) => saveConfig({ subreddits: v.split(",").map(s => s.trim()).filter(Boolean) })} className="col-span-2" />
            <Field label="Min score" value={String(config.min_score)} onChange={(v) => saveConfig({ min_score: parseInt(v) || 0 })} />
            <Field label="Max age (hrs)" value={String(config.max_post_age_hours)} onChange={(v) => saveConfig({ max_post_age_hours: parseInt(v) || 12 })} />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Draft system prompt</label>
            <textarea
              value={config.draft_system_prompt}
              onChange={(e) => setConfig({ ...config, draft_system_prompt: e.target.value })}
              onBlur={() => saveConfig({ draft_system_prompt: config.draft_system_prompt })}
              rows={4}
              className="w-full bg-zinc-950 border border-white/[0.08] rounded px-2 py-1.5 text-xs text-zinc-200 font-mono"
            />
          </div>
        </div>
      )}

      <div className="px-6 pt-3 flex gap-1">
        {(["pending", "approved", "rejected", "all"] as const).map(f => {
          const count = f === "all" ? drafts.length : drafts.filter(d => d.status === f).length;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1.5 rounded-t text-xs font-medium border-b-2 transition-colors capitalize",
                filter === f ? "text-indigo-300 border-indigo-400 bg-indigo-950/20" : "text-zinc-500 hover:text-zinc-300 border-transparent",
              )}
            >
              {f} <span className="text-zinc-600">({count})</span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {filtered.length === 0 ? (
          <div className="text-center text-zinc-500 py-16 text-sm">No drafts in this bucket.</div>
        ) : (
          filtered.map(d => (
            <DraftCard
              key={d.id}
              draft={d}
              onApprove={() => updateDraft(d.id, { status: "approved" })}
              onReject={() => updateDraft(d.id, { status: "rejected" })}
              onMarkPosted={() => updateDraft(d.id, { status: "posted" })}
              onEdit={(text) => updateDraft(d.id, { draft: text })}
              onDelete={() => deleteDraft(d.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function DraftCard({ draft, onApprove, onReject, onMarkPosted, onEdit, onDelete }: {
  draft: Draft;
  onApprove: () => void;
  onReject: () => void;
  onMarkPosted: () => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(draft.draft);
  return (
    <div className={cn(
      "rounded-xl border p-4",
      draft.status === "approved" ? "border-emerald-500/25 bg-emerald-950/10"
      : draft.status === "rejected" ? "border-red-500/20 bg-red-950/10 opacity-60"
      : draft.status === "posted" ? "border-indigo-500/25 bg-indigo-950/10"
      : "border-white/[0.06] bg-zinc-900/40",
    )}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <span className="font-mono text-zinc-300">r/{draft.subreddit}</span>
            <span>·</span>
            <span>{draft.post_author}</span>
            <span>·</span>
            <span>score {draft.post_score}</span>
            <a href={draft.post_permalink} target="_blank" rel="noreferrer" className="ml-auto text-zinc-500 hover:text-zinc-200">
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <h3 className="text-sm font-semibold text-zinc-100 mt-0.5">{draft.post_title}</h3>
          {draft.post_body && (
            <details className="mt-1 text-[11px] text-zinc-500">
              <summary className="cursor-pointer hover:text-zinc-300">Show post body</summary>
              <pre className="mt-1 whitespace-pre-wrap text-[11px] text-zinc-400 bg-black/30 rounded p-2 max-h-40 overflow-y-auto">{draft.post_body}</pre>
            </details>
          )}
        </div>
      </div>
      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Draft reply {draft.model_id && <span className="text-zinc-600 normal-case tracking-normal">— {draft.model_id.replace(/^mlx:/, "")}</span>}</div>
          <button onClick={() => { setEditing(v => !v); setText(draft.draft); }} className="text-[10px] text-zinc-500 hover:text-zinc-300">
            {editing ? "Cancel" : "Edit"}
          </button>
        </div>
        {editing ? (
          <div className="space-y-1.5">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              className="w-full bg-zinc-950 border border-white/[0.08] rounded px-2 py-1.5 text-xs text-zinc-200"
            />
            <Button size="xs" variant="primary" onClick={() => { onEdit(text); setEditing(false); }}>Save edit</Button>
          </div>
        ) : (
          <pre className="text-xs text-zinc-200 bg-black/30 rounded p-3 whitespace-pre-wrap">{draft.draft}</pre>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        {draft.status === "pending" && (
          <>
            <Button size="xs" variant="primary" onClick={onApprove} className="gap-1"><Check className="w-3 h-3" /> Approve</Button>
            <Button size="xs" variant="ghost" onClick={onReject} className="gap-1"><XIcon className="w-3 h-3" /> Reject</Button>
          </>
        )}
        {draft.status === "approved" && (
          <Button size="xs" variant="primary" onClick={onMarkPosted} className="gap-1"><Send className="w-3 h-3" /> Mark posted (I replied manually)</Button>
        )}
        <Button size="xs" variant="destructive" onClick={onDelete} className="gap-1 ml-auto"><Trash2 className="w-3 h-3" /> Delete</Button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, secret, className }: {
  label: string; value: string; onChange: (v: string) => void; secret?: boolean; className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">{label}</div>
      <input
        type={secret ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-zinc-950 border border-white/[0.08] rounded px-2 py-1.5 text-xs text-zinc-200 font-mono"
      />
    </label>
  );
}
