"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/Toast";
import { useModelsStore } from "@/lib/stores/models";
import {
  Newspaper, RefreshCw, Loader2, ExternalLink, X as XIcon, Settings,
  Filter, Rss, MessageSquare, Package, FlaskConical, Save,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Impact = "routine" | "noteworthy" | "breaking";

type NewsItem = {
  id: string;
  source_id: string;
  source_name: string;
  title: string;
  url: string;
  excerpt?: string;
  summary?: string;
  impact?: Impact;
  published_at?: number;
  summary_model?: string;
  summarized_at?: number;
  error?: string;
};

type NewsGroup = {
  source_id: string;
  source_name: string;
  items: NewsItem[];
};

type NewsDigest = {
  groups: NewsGroup[];
  refreshed_at: number;
};

type NewsSource = {
  id: string;
  kind: "rss" | "reddit" | "github_releases";
  name: string;
  url?: string;
  subreddit?: string;
  repo?: string;
};

type NewsConfig = {
  enabled: boolean;
  sources: NewsSource[];
  keyword_filter: string[];
  max_items_per_source: number;
  max_age_hours: number;
  summarize_system_prompt: string;
};

const IMPACT_META: Record<Impact, { label: string; cls: string; dot: string }> = {
  routine:    { label: "routine",    cls: "bg-zinc-800 text-zinc-400 border-white/10",            dot: "bg-zinc-500" },
  noteworthy: { label: "noteworthy", cls: "bg-amber-900/30 text-amber-300 border-amber-500/30",   dot: "bg-amber-400" },
  breaking:   { label: "breaking",   cls: "bg-red-900/30 text-red-300 border-red-500/30",         dot: "bg-red-400" },
};

const SOURCE_ICON: Record<NewsSource["kind"], React.ReactNode> = {
  rss: <Rss className="w-3.5 h-3.5" />,
  reddit: <MessageSquare className="w-3.5 h-3.5" />,
  github_releases: <Package className="w-3.5 h-3.5" />,
};

export default function NewsPage() {
  const [digest, setDigest] = useState<NewsDigest | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshStage, setRefreshStage] = useState("");
  const [filter, setFilter] = useState<"all" | Impact>("all");
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const activeModelId = useModelsStore((s) => s.activeModelId);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/news");
      if (r.ok) setDigest(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Accumulate item events into the digest live so the user sees progress
  // instead of an opaque "summarizing..." spinner for minutes.
  const pushItem = useCallback((it: NewsItem) => {
    setDigest(prev => {
      const groups = [...((prev?.groups) ?? [])];
      let g = groups.find(x => x.source_id === it.source_id);
      if (!g) {
        g = { source_id: it.source_id, source_name: it.source_name, items: [] };
        groups.push(g);
      }
      // Replace any stale version of the same id; otherwise prepend.
      const rest = g.items.filter(x => x.id !== it.id);
      g.items = [it, ...rest].slice(0, 50);
      return {
        groups,
        refreshed_at: prev?.refreshed_at ?? 0,
      };
    });
  }, []);

  const refresh = useCallback(async () => {
    if (refreshing) return;
    if (!activeModelId) {
      toast("Load a model first — the digest needs one to summarize.", "error");
      return;
    }
    setRefreshing(true);
    setRefreshStage("starting…");
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const r = await fetch("/api/news/refresh", { method: "POST", signal: ctl.signal });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let done = false;
      let summarized = 0;
      let totalToSummarize = 0;
      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        if (value) buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of chunk.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload) continue;
            try {
              const evt = JSON.parse(payload);
              if (evt.event === "phase") {
                if (evt.phase === "fetching") setRefreshStage("fetching feeds…");
                else if (evt.phase === "fetched") setRefreshStage(`${evt.count} items fetched`);
                else if (evt.phase === "summarizing") {
                  totalToSummarize = evt.count;
                  setRefreshStage(`summarizing 0 / ${totalToSummarize}…`);
                }
                else if (evt.phase === "done") setRefreshStage(`done — ${evt.total} in digest`);
              } else if (evt.event === "item") {
                pushItem(evt.item);
                if (!evt.cached) {
                  summarized += 1;
                  setRefreshStage(totalToSummarize ? `summarizing ${summarized} / ${totalToSummarize}…` : `summarizing… ${summarized} complete`);
                }
              }
            } catch {}
          }
        }
      }
      await load();
      toast("Digest refreshed", "success");
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        toast("Refresh stopped — keeping items summarized so far", "info");
      } else {
        toast(`Refresh failed: ${(e as Error).message}`, "error");
      }
    } finally {
      abortRef.current = null;
      setRefreshing(false);
      setRefreshStage("");
    }
  }, [refreshing, activeModelId, load, pushItem]);

  const stopRefresh = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const dismiss = async (id: string) => {
    try {
      await fetch(`/api/news/item/${id}`, { method: "DELETE" });
      await load();
    } catch {}
  };

  // Filtered view
  const filteredGroups = useMemo(() => {
    if (!digest) return [] as NewsGroup[];
    let groups = digest.groups;
    if (sourceFilter) groups = groups.filter(g => g.source_id === sourceFilter);
    if (filter === "all") return groups.map(g => ({ ...g, items: g.items }));
    return groups
      .map(g => ({ ...g, items: g.items.filter(it => (it.impact ?? "routine") === filter) }))
      .filter(g => g.items.length > 0);
  }, [digest, filter, sourceFilter]);

  const totalCount = useMemo(
    () => (digest?.groups ?? []).reduce((n, g) => n + g.items.length, 0),
    [digest],
  );

  // Breaking ribbon — surface any items classified breaking regardless of filter
  const breaking = useMemo(
    () => (digest?.groups ?? []).flatMap(g => g.items).filter(i => i.impact === "breaking").slice(0, 4),
    [digest],
  );

  return (
    <div className="flex flex-col h-full min-h-screen">
      <div className="px-6 py-4 border-b border-white/[0.04]">
        <PageHeader
          icon={<Newspaper className="w-5 h-5" />}
          title="AI News"
          description="Daily headlines from RSS, Reddit, and GitHub — summarized by your local model"
        >
          <Button variant="ghost" size="sm" onClick={() => setConfigOpen(true)} className="gap-1.5">
            <Settings className="w-3.5 h-3.5" /> Sources
          </Button>
          {refreshing ? (
            <Button variant="destructive" size="sm" onClick={stopRefresh} className="gap-1.5">
              <XIcon className="w-3.5 h-3.5" /> Stop
            </Button>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            onClick={refresh}
            disabled={refreshing}
            className="gap-1.5"
          >
            {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {refreshing ? refreshStage || "Refreshing…" : "Refresh digest"}
          </Button>
        </PageHeader>
        {digest && digest.refreshed_at > 0 && (
          <p className="text-[11px] text-zinc-500 mt-2">
            Last refreshed {new Date(digest.refreshed_at * 1000).toLocaleString()} · {totalCount} items
          </p>
        )}
        {!activeModelId && (
          <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-950/20 text-amber-300 text-xs px-3 py-2">
            No model loaded. Refresh will fail — load a model first so the digest can summarize headlines.
          </div>
        )}
      </div>

      {/* Filter bar */}
      <div className="px-6 py-3 border-b border-white/[0.04] flex flex-wrap gap-2 items-center">
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          <Filter className="w-3.5 h-3.5" /> Impact:
        </div>
        {(["all", "breaking", "noteworthy", "routine"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-2.5 py-1 rounded text-[11px] border capitalize transition-colors",
              filter === f
                ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/30"
                : "bg-zinc-900 text-zinc-400 border-white/10 hover:text-zinc-100",
            )}
          >
            {f}
          </button>
        ))}
        {digest && digest.groups.length > 0 && (
          <>
            <span className="w-px h-4 bg-white/10 mx-1" />
            <button
              onClick={() => setSourceFilter(null)}
              className={cn(
                "px-2.5 py-1 rounded text-[11px] border transition-colors",
                !sourceFilter
                  ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/30"
                  : "bg-zinc-900 text-zinc-400 border-white/10 hover:text-zinc-100",
              )}
            >
              All sources
            </button>
            {digest.groups.map(g => (
              <button
                key={g.source_id}
                onClick={() => setSourceFilter(g.source_id)}
                className={cn(
                  "px-2.5 py-1 rounded text-[11px] border transition-colors",
                  sourceFilter === g.source_id
                    ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/30"
                    : "bg-zinc-900 text-zinc-400 border-white/10 hover:text-zinc-100",
                )}
              >
                {g.source_name} · {g.items.length}
              </button>
            ))}
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {/* Breaking ribbon */}
        {!sourceFilter && filter === "all" && breaking.length > 0 && (
          <section className="mb-6">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-red-300 mb-2 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
              Breaking
            </h2>
            <div className="grid gap-2 grid-cols-1 md:grid-cols-2">
              {breaking.map(it => <NewsCard key={`b-${it.id}`} item={it} highlight onDismiss={() => dismiss(it.id)} />)}
            </div>
          </section>
        )}

        {loading ? (
          <div className="text-center text-zinc-500 py-16 text-sm">Loading digest…</div>
        ) : !digest || digest.groups.length === 0 ? (
          <div className="text-center text-zinc-500 py-16 text-sm">
            <p>No digest yet. Click <strong>Refresh digest</strong> to pull the first batch.</p>
            <p className="text-xs text-zinc-600 mt-2">Requires a loaded model — summaries run against whatever is active.</p>
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="text-center text-zinc-500 py-16 text-sm">No items match the current filters.</div>
        ) : (
          <div className="space-y-8">
            {filteredGroups.map(g => {
              const src = digest?.groups.find(x => x.source_id === g.source_id);
              const kindIcon = SOURCE_ICON[_sourceKind(src) ?? "rss"];
              return (
                <section key={g.source_id}>
                  <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500 mb-3 flex items-center gap-2">
                    <span className="text-zinc-600">{kindIcon}</span>
                    {g.source_name}
                    <span className="text-zinc-600 normal-case tracking-normal">· {g.items.length}</span>
                  </h2>
                  <div className="grid gap-2 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                    {g.items.map(it => (
                      <NewsCard key={it.id} item={it} onDismiss={() => dismiss(it.id)} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {configOpen && (
        <NewsConfigDialog
          onClose={() => setConfigOpen(false)}
          onSaved={() => { setConfigOpen(false); load(); }}
        />
      )}
    </div>
  );
}

function _sourceKind(_: NewsGroup | undefined): NewsSource["kind"] | null {
  // We don't ship kind in the digest rows — infer from id prefix for the icon.
  if (!_) return null;
  if (_.source_id.startsWith("reddit_")) return "reddit";
  if (_.source_id.startsWith("gh_")) return "github_releases";
  if (_.source_id.startsWith("arxiv")) return "rss";
  return "rss";
}

function NewsCard({ item, highlight, onDismiss }: {
  item: NewsItem;
  highlight?: boolean;
  onDismiss: () => void;
}) {
  const impact = item.impact ?? "routine";
  const meta = IMPACT_META[impact];
  const published = item.published_at ? new Date(item.published_at * 1000).toLocaleString() : "";
  return (
    <article
      className={cn(
        "group relative rounded-xl border bg-zinc-900/40 p-4 flex flex-col gap-2 transition-colors hover:bg-zinc-900/70",
        highlight ? "border-red-500/30" : "border-white/[0.06]",
      )}
    >
      <button
        onClick={onDismiss}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-500 hover:text-zinc-200 p-1 -m-1"
        title="Dismiss"
        aria-label="Dismiss"
      >
        <XIcon className="w-3.5 h-3.5" />
      </button>

      <div className="flex items-start gap-2">
        <span className={cn("inline-flex items-center gap-1 text-[10px] uppercase tracking-wide border rounded px-1.5 py-0.5 shrink-0", meta.cls)}>
          <span className={cn("inline-block w-1.5 h-1.5 rounded-full", meta.dot)} />
          {meta.label}
        </span>
        <span className="text-[10px] text-zinc-500 font-mono truncate">{published}</span>
      </div>

      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="text-sm font-semibold text-zinc-100 hover:text-indigo-300 line-clamp-2 inline-flex items-start gap-1"
      >
        <span className="flex-1">{item.title}</span>
        <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 opacity-60" />
      </a>

      {item.summary && (
        <p className="text-xs text-zinc-400 leading-relaxed line-clamp-4">{item.summary}</p>
      )}

      {item.error && (
        <p className="text-[10px] text-red-300">summarize failed — showing raw excerpt</p>
      )}

      <div className="mt-auto pt-1 text-[10px] text-zinc-600 font-mono truncate">
        {item.source_name}
        {item.summary_model ? ` · via ${item.summary_model.replace(/^mlx:/, "")}` : ""}
      </div>
    </article>
  );
}

function NewsConfigDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [cfg, setCfg] = useState<NewsConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/news/config");
        if (r.ok) setCfg(await r.json());
      } catch {}
    })();
  }, []);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const r = await fetch("/api/news/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast("Sources saved", "success");
      onSaved();
    } catch (e) {
      toast(`Save failed: ${(e as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-zinc-950 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-indigo-300" /> News sources
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200"><XIcon className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {!cfg ? (
            <p className="text-xs text-zinc-500 animate-pulse">Loading…</p>
          ) : (
            <>
              <div>
                <label className="text-xs font-semibold text-zinc-300 mb-1 block">Sources ({cfg.sources.length})</label>
                <div className="space-y-1.5">
                  {cfg.sources.map((s, i) => (
                    <div key={s.id} className="flex items-center gap-2 rounded border border-white/[0.06] bg-zinc-900/40 px-2.5 py-1.5">
                      <span className="text-zinc-500 w-4 shrink-0">{SOURCE_ICON[s.kind]}</span>
                      <input
                        value={s.name}
                        onChange={e => setCfg(c => c && ({ ...c, sources: c.sources.map((x, j) => j === i ? { ...x, name: e.target.value } : x) }))}
                        className="flex-1 bg-transparent text-xs text-zinc-200 font-medium outline-none"
                      />
                      <input
                        value={s.url ?? s.subreddit ?? s.repo ?? ""}
                        onChange={e => setCfg(c => c && ({ ...c, sources: c.sources.map((x, j) => {
                          if (j !== i) return x;
                          if (x.kind === "rss") return { ...x, url: e.target.value };
                          if (x.kind === "reddit") return { ...x, subreddit: e.target.value };
                          return { ...x, repo: e.target.value };
                        }) }))}
                        className="flex-[2] bg-zinc-950 border border-white/[0.08] rounded px-2 py-1 text-[11px] text-zinc-100 font-mono"
                      />
                      <button
                        onClick={() => setCfg(c => c && ({ ...c, sources: c.sources.filter((_, j) => j !== i) }))}
                        className="text-zinc-500 hover:text-red-300"
                        title="Remove"
                      >
                        <XIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-300 mb-1 block">Keyword filter (comma-separated)</label>
                <textarea
                  value={cfg.keyword_filter.join(", ")}
                  onChange={e => setCfg(c => c && ({ ...c, keyword_filter: e.target.value.split(",").map(s => s.trim()).filter(Boolean) }))}
                  rows={2}
                  className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2 py-1.5 text-xs text-zinc-100 font-mono"
                />
                <p className="text-[10px] text-zinc-600 mt-1">Items must match at least one keyword. Empty = keep everything.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-zinc-300 mb-1 block">Max items per source</label>
                  <input
                    type="number"
                    value={cfg.max_items_per_source}
                    onChange={e => setCfg(c => c && ({ ...c, max_items_per_source: Math.max(1, Number(e.target.value) || 10) }))}
                    className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2 py-1.5 text-xs text-zinc-100 font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-300 mb-1 block">Max age (hours)</label>
                  <input
                    type="number"
                    value={cfg.max_age_hours}
                    onChange={e => setCfg(c => c && ({ ...c, max_age_hours: Math.max(1, Number(e.target.value) || 72) }))}
                    className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2 py-1.5 text-xs text-zinc-100 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-300 mb-1 block">Summarize system prompt</label>
                <textarea
                  value={cfg.summarize_system_prompt}
                  onChange={e => setCfg(c => c && ({ ...c, summarize_system_prompt: e.target.value }))}
                  rows={6}
                  className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2 py-1.5 text-[11px] text-zinc-100 font-mono"
                />
              </div>
            </>
          )}
        </div>
        <div className="px-5 py-3 border-t border-white/[0.08] flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={save} disabled={!cfg || saving} className="gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
