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

// Curated list of LLM / AI / adjacent subs worth watching. User can still
// add anything else via the custom input. Labels explain why we'd care
// about a sub so the picker isn't just an alphabet soup.
const SUBREDDIT_PRESETS: { name: string; blurb: string }[] = [
  { name: "LocalLLaMA",           blurb: "Biggest local-LLM community — Qwen, Llama, Mistral, etc." },
  { name: "LocalLLM",             blurb: "Smaller, quieter cousin of LocalLLaMA." },
  { name: "MachineLearning",      blurb: "Research-heavy; more theory than tooling." },
  { name: "LanguageTechnology",   blurb: "NLP research + production." },
  { name: "LLMDevs",              blurb: "Product-oriented LLM building." },
  { name: "Oobabooga",            blurb: "oobabooga text-generation-webui community." },
  { name: "ollama",               blurb: "Ollama users + integration questions." },
  { name: "huggingface",          blurb: "Model discovery + hf-hub tips." },
  { name: "ChatGPT",              blurb: "Biggest consumer LLM sub — off-topic for local but high traffic." },
  { name: "OpenAI",               blurb: "API-focused OpenAI discussions." },
  { name: "ClaudeAI",             blurb: "Claude users + prompt engineering." },
  { name: "singularity",          blurb: "Forward-looking AI news + speculation." },
  { name: "StableDiffusion",      blurb: "Image-gen adjacent — occasional LLM crossover." },
  { name: "ArtificialIntelligence", blurb: "General-AI discussion." },
  { name: "deeplearning",         blurb: "Lower-level DL questions." },
];


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
  subreddit_dossiers: Record<string, string>;
  critique_drafts: boolean;
};

type CritiqueFlag = {
  claim: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  note: string;
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
  critique: CritiqueFlag[];
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
  const approveAndOpen = async (d: Draft) => {
    // Best-effort clipboard copy; browsers block this when not same-origin /
    // not user-gesture — we fall through to the tab open either way.
    try {
      await navigator.clipboard.writeText(d.draft);
      toast("Draft copied — paste into the Reddit reply box", "success");
    } catch {
      toast("Approved — copy the draft manually, clipboard was blocked", "info");
    }
    window.open(d.post_permalink, "_blank", "noopener,noreferrer");
    await updateDraft(d.id, { status: "approved" });
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
        <div className="mx-6 mt-4 rounded-xl border border-white/[0.06] bg-zinc-900/40 p-4 space-y-4">
          <div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) => saveConfig({ enabled: e.target.checked })}
                className="accent-indigo-500"
              />
              <label className="text-sm text-zinc-200">Enabled</label>
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">
              Master switch. When off, <strong>Scan now</strong> is a no-op and no drafts get generated.
            </p>
          </div>

          <CredentialsHelp />

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Client ID"
              value={config.client_id}
              onChange={(v) => saveConfig({ client_id: v })}
              help="Optional. Reddit OAuth app id — leave blank to use the public read-only endpoint."
            />
            <Field
              label="Client secret"
              value={config.client_secret}
              onChange={(v) => saveConfig({ client_secret: v })}
              secret
              help="Optional. Pairs with Client ID for higher rate limits / write access later."
            />
            <Field
              label="User-Agent"
              value={config.user_agent}
              onChange={(v) => saveConfig({ user_agent: v })}
              className="col-span-2"
              help="Reddit wants an identifying string. `crucible-watcher/1.0 by your-reddit-username` is the recommended shape."
            />
            <Field
              label="Min score"
              value={String(config.min_score)}
              onChange={(v) => saveConfig({ min_score: parseInt(v) || 0 })}
              help="Skip posts with fewer than N upvotes. Filters low-effort + brand-new content."
            />
            <Field
              label="Max age (hrs)"
              value={String(config.max_post_age_hours)}
              onChange={(v) => saveConfig({ max_post_age_hours: parseInt(v) || 12 })}
              help="Skip posts older than this. Don't bother replying to dead threads."
            />
          </div>

          {/* Subreddit picker — curated checklist + custom additions */}
          <SubredditPicker
            selected={config.subreddits}
            onToggle={(name) => {
              const set = new Set(config.subreddits);
              if (set.has(name)) set.delete(name); else set.add(name);
              saveConfig({ subreddits: Array.from(set) });
            }}
            onAddCustom={(name) => {
              if (!name.trim()) return;
              const clean = name.trim().replace(/^r\//i, "");
              if (config.subreddits.includes(clean)) return;
              saveConfig({ subreddits: [...config.subreddits, clean] });
            }}
          />

          <DossierEditor
            subs={config.subreddits}
            dossiers={config.subreddit_dossiers || {}}
            onChange={(name, text) => {
              const next = { ...(config.subreddit_dossiers || {}) };
              if (text.trim()) next[name] = text;
              else delete next[name];
              saveConfig({ subreddit_dossiers: next });
            }}
          />

          <label className="flex items-center gap-2 text-xs text-zinc-200">
            <input
              type="checkbox"
              checked={config.critique_drafts ?? true}
              onChange={(e) => saveConfig({ critique_drafts: e.target.checked })}
              className="accent-indigo-500"
            />
            Run a call-out-risk critique on each new draft
            <span className="text-[10px] text-zinc-500">
              (second pass flags shaky claims before you review)
            </span>
          </label>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">Draft system prompt</label>
            <p className="text-[11px] text-zinc-500 mb-1.5">
              The system message handed to the active MLX model when drafting replies. Shape the tone here —
              the default pushes for short, concrete, first-person replies.
            </p>
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
              onApprove={() => approveAndOpen(d)}
              onReject={() => updateDraft(d.id, { status: "rejected" })}
              onMarkPosted={() => updateDraft(d.id, { status: "posted" })}
              onEdit={(text) => updateDraft(d.id, { draft: text })}
              onDelete={() => deleteDraft(d.id)}
              onRecritique={async () => {
                try {
                  const r = await fetch(`/api/reddit/drafts/${encodeURIComponent(d.id)}/critique`, { method: "POST" });
                  if (!r.ok) {
                    const t = await r.text();
                    throw new Error(t);
                  }
                  toast("Critique refreshed", "success");
                  await load();
                } catch (e) {
                  toast(`Critique failed: ${(e as Error).message}`, "error");
                }
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

function DraftCard({ draft, onApprove, onReject, onMarkPosted, onEdit, onDelete, onRecritique }: {
  draft: Draft;
  onApprove: () => void;
  onReject: () => void;
  onMarkPosted: () => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
  onRecritique: () => void;
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

      {(draft.critique && draft.critique.length > 0) && (
        <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-950/10 p-2.5">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wide text-amber-300 font-medium">
              Call-out risk ({draft.critique.length} claim{draft.critique.length === 1 ? "" : "s"})
            </div>
            <button onClick={onRecritique} className="text-[10px] text-amber-400 hover:text-amber-200">
              Re-run
            </button>
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {draft.critique.map((f, i) => (
              <li key={i} className="text-[11px]">
                <span className={cn(
                  "inline-block text-[9px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded mr-1.5 align-middle",
                  f.confidence === "LOW" ? "bg-red-500/20 text-red-300 border border-red-500/30"
                  : f.confidence === "MEDIUM" ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                  : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
                )}>
                  {f.confidence}
                </span>
                <span className="text-zinc-200">{f.claim}</span>
                {f.note && <div className="ml-12 text-zinc-500">{f.note}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(!draft.critique || draft.critique.length === 0) && draft.status === "pending" && (
        <div className="mt-2 text-[10px] text-zinc-600 flex items-center gap-1.5">
          <span>No risky claims flagged.</span>
          <button onClick={onRecritique} className="text-zinc-500 hover:text-zinc-300 underline">
            re-check
          </button>
        </div>
      )}
      <div className="mt-3 flex gap-2">
        {draft.status === "pending" && (
          <>
            <Button
              size="xs"
              variant="primary"
              onClick={onApprove}
              className="gap-1"
              title="Copy draft to clipboard, open the Reddit thread in a new tab, mark approved"
            ><Check className="w-3 h-3" /> Approve + open on Reddit</Button>
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

function CredentialsHelp() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-indigo-500/20 bg-indigo-950/10">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-[11px] text-indigo-300 hover:bg-indigo-900/10"
      >
        <span className="flex items-center gap-1.5">
          <ExternalLink className="w-3 h-3" />
          How do I get a Client ID and Client Secret?
        </span>
        <span className="text-indigo-400">{open ? "hide" : "show"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 text-[11px] text-zinc-300 border-t border-indigo-500/15">
          <ol className="space-y-1.5 list-decimal pl-4">
            <li>
              Go to{" "}
              <a
                href="https://www.reddit.com/prefs/apps"
                target="_blank"
                rel="noreferrer"
                className="text-indigo-300 underline hover:text-indigo-200"
              >reddit.com/prefs/apps</a>{" "}
              while logged in to your Reddit account.
            </li>
            <li>
              Scroll to the bottom and click{" "}
              <span className="font-mono text-zinc-200">are you a developer? create an app…</span>
            </li>
            <li>
              Fill in the form:
              <ul className="list-disc pl-4 mt-1 space-y-0.5 text-zinc-400">
                <li><span className="font-mono">name</span> — anything, e.g. <span className="font-mono text-zinc-200">crucible-watcher</span></li>
                <li><span className="font-mono">app type</span> — <span className="font-semibold text-indigo-300">script</span> (for personal single-user use)</li>
                <li><span className="font-mono">about url</span> — leave blank</li>
                <li><span className="font-mono">redirect uri</span> — required field but unused for script apps; put <span className="font-mono text-zinc-200">http://localhost:8080</span></li>
              </ul>
            </li>
            <li>Click <span className="font-mono">create app</span>.</li>
            <li>
              Grab the two values from the created-app panel:
              <ul className="list-disc pl-4 mt-1 space-y-0.5 text-zinc-400">
                <li><strong>Client ID</strong> — the short gibberish-looking string <em>under</em> the app name (above &ldquo;personal use script&rdquo;)</li>
                <li><strong>Client secret</strong> — next to the label <span className="font-mono">secret</span> (click <span className="font-mono">edit</span> if you need to reveal it)</li>
              </ul>
            </li>
          </ol>
          <p className="text-zinc-500 mt-2 pt-2 border-t border-white/[0.06]">
            Credentials are <strong>optional</strong>. Without them, the watcher falls back to the public{" "}
            <span className="font-mono">r/{"{sub}"}/new.json</span> endpoint — good enough for reads.
            Add creds for higher rate limits.
          </p>
        </div>
      )}
    </div>
  );
}

function DossierEditor({ subs, dossiers, onChange }: {
  subs: string[];
  dossiers: Record<string, string>;
  onChange: (name: string, text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (activeSub) setDraft(dossiers[activeSub] ?? "");
  }, [activeSub, dossiers]);

  if (subs.length === 0) return null;
  return (
    <div className="rounded-lg border border-white/[0.06] bg-zinc-950/40">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-[11px] text-zinc-300 hover:bg-zinc-900/40"
      >
        <span>
          <span className="uppercase tracking-wide text-zinc-500 mr-1">Dossiers</span>
          <span className="text-zinc-600">
            ({Object.keys(dossiers).filter(k => (dossiers[k] || "").trim()).length} / {subs.length} subs)
          </span>
        </span>
        <span className="text-zinc-500">{open ? "hide" : "show"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-white/[0.06]">
          <p className="text-[11px] text-zinc-500 mt-2">
            Per-subreddit context the model won&apos;t otherwise know. Use this to pre-empt
            common mistakes (e.g. &ldquo;don&apos;t say llama.cpp is just a library — it
            ships llama-server&rdquo;). Prepended to the system prompt when drafting a reply
            to a post from the matching sub.
          </p>
          <div className="grid grid-cols-[180px_1fr] gap-2">
            <div className="space-y-0.5 max-h-72 overflow-y-auto">
              {subs.map(s => {
                const filled = (dossiers[s] || "").trim().length > 0;
                const on = activeSub === s;
                return (
                  <button
                    key={s}
                    onClick={() => setActiveSub(s)}
                    className={cn(
                      "w-full text-left px-2 py-1 rounded text-[11px] font-mono flex items-center justify-between",
                      on ? "bg-indigo-950/30 text-indigo-200 border border-indigo-500/30"
                         : "text-zinc-400 hover:bg-zinc-800/60 border border-transparent",
                    )}
                  >
                    <span className="truncate">r/{s}</span>
                    <span className={cn(
                      "w-1.5 h-1.5 rounded-full shrink-0",
                      filled ? "bg-emerald-400" : "bg-zinc-700",
                    )} />
                  </button>
                );
              })}
            </div>
            <div>
              {activeSub ? (
                <>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => onChange(activeSub, draft)}
                    rows={6}
                    placeholder={`Context for r/${activeSub} — facts, hot buttons, terminology, things the model tends to get wrong…`}
                    className="w-full bg-zinc-950 border border-white/[0.08] rounded px-2 py-1.5 text-[11px] text-zinc-200 font-mono"
                  />
                  <p className="text-[10px] text-zinc-600 mt-1">
                    Saves when you click away. Plain text, no markdown required.
                  </p>
                </>
              ) : (
                <p className="text-[11px] text-zinc-600">Pick a sub on the left to edit its dossier.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, secret, className, help }: {
  label: string; value: string; onChange: (v: string) => void;
  secret?: boolean; className?: string; help?: string;
}) {
  return (
    <div className={cn("block", className)}>
      <label className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1 block">{label}</label>
      <input
        type={secret ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-zinc-950 border border-white/[0.08] rounded px-2 py-1.5 text-xs text-zinc-200 font-mono"
      />
      {help && <p className="text-[10px] text-zinc-500 mt-1">{help}</p>}
    </div>
  );
}

function SubredditPicker({ selected, onToggle, onAddCustom }: {
  selected: string[];
  onToggle: (name: string) => void;
  onAddCustom: (name: string) => void;
}) {
  const [custom, setCustom] = useState("");
  const presetNames = new Set(SUBREDDIT_PRESETS.map(p => p.name.toLowerCase()));
  const customExtras = selected.filter(s => !presetNames.has(s.toLowerCase()));

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">
        Subreddits ({selected.length} selected)
      </div>
      <p className="text-[11px] text-zinc-500 mb-2">
        Check the subs you want to scan. Each watch fetches a small batch from each — fewer = faster,
        fewer drafts queued.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
        {SUBREDDIT_PRESETS.map(p => {
          const on = selected.some(s => s.toLowerCase() === p.name.toLowerCase());
          return (
            <label
              key={p.name}
              className={cn(
                "flex items-start gap-1.5 rounded px-2 py-1.5 border text-[11px] cursor-pointer transition-colors",
                on
                  ? "border-indigo-500/40 bg-indigo-950/20"
                  : "border-white/[0.06] bg-zinc-950/60 hover:border-white/[0.15]",
              )}
              title={p.blurb}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => onToggle(p.name)}
                className="mt-0.5 accent-indigo-500"
              />
              <span className="min-w-0 flex-1">
                <span className={cn("font-mono block truncate", on ? "text-indigo-200" : "text-zinc-300")}>
                  r/{p.name}
                </span>
                <span className="text-[10px] text-zinc-500 block leading-snug">{p.blurb}</span>
              </span>
            </label>
          );
        })}
      </div>

      {customExtras.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">
            Custom ({customExtras.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {customExtras.map(name => (
              <span
                key={name}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-indigo-950/20 border border-indigo-500/30 text-indigo-200"
              >
                r/{name}
                <button
                  onClick={() => onToggle(name)}
                  className="text-indigo-400 hover:text-red-300 ml-0.5"
                  title="Remove"
                >×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex gap-2 items-center">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAddCustom(custom);
              setCustom("");
            }
          }}
          placeholder="Add another subreddit (e.g. ObsidianMD, datascience)"
          className="flex-1 bg-zinc-950 border border-white/[0.08] rounded px-2 py-1.5 text-xs text-zinc-200 font-mono"
        />
        <button
          onClick={() => { onAddCustom(custom); setCustom(""); }}
          disabled={!custom.trim()}
          className="px-3 py-1.5 rounded text-xs font-medium bg-indigo-600/30 text-indigo-200 border border-indigo-500/40 hover:bg-indigo-600/50 disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}
