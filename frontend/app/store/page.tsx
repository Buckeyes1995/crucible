"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Store, Loader2, Check, RefreshCw, Sparkles, Package, Workflow,
  ShieldQuestion, Plug, Download, ExternalLink, Eye, EyeOff, Plus,
  Archive, Trash2, Settings, Search, X as XIcon,
} from "lucide-react";
import {
  api, type StoreCatalog, type StoreInstalled, type StoreMcp,
  type InstalledDetail, type HFSearchResult, type DownloadJob,
  type McpTool, type McpCallResult,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "@/components/Toast";

type Tab = "featured" | "models" | "prompts" | "workflows" | "system_prompts" | "mcps" | "installed";

const TAB_META: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "featured", label: "Featured", icon: <Sparkles className="w-3.5 h-3.5" /> },
  { key: "models", label: "Models", icon: <Package className="w-3.5 h-3.5" /> },
  { key: "prompts", label: "Prompts", icon: <Sparkles className="w-3.5 h-3.5" /> },
  { key: "workflows", label: "Workflows", icon: <Workflow className="w-3.5 h-3.5" /> },
  { key: "system_prompts", label: "System Prompts", icon: <ShieldQuestion className="w-3.5 h-3.5" /> },
  { key: "mcps", label: "MCPs", icon: <Plug className="w-3.5 h-3.5" /> },
  { key: "installed", label: "Installed", icon: <Archive className="w-3.5 h-3.5" /> },
];

export default function StorePage() {
  const [catalog, setCatalog] = useState<StoreCatalog | null>(null);
  const [installed, setInstalled] = useState<StoreInstalled | null>(null);
  const [tab, setTab] = useState<Tab>("featured");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [mcpConfiguring, setMcpConfiguring] = useState<StoreMcp | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, i] = await Promise.all([api.store.catalog(), api.store.installed()]);
      setCatalog(c); setInstalled(i);
    } catch (e) {
      toast(`Store load failed: ${(e as Error).message}`, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const c = await api.store.refresh();
      setCatalog(c);
      toast("Catalog refreshed", "success");
    } catch (e) {
      toast(`Refresh failed: ${(e as Error).message}`, "error");
    } finally {
      setRefreshing(false);
    }
  };

  const isInstalled = (kind: keyof StoreInstalled, id: string): boolean =>
    !!installed?.[kind].includes(id);

  const onInstalled = async () => {
    // Refresh just the installed map so Install buttons flip in place.
    try { setInstalled(await api.store.installed()); } catch {}
  };

  const doInstallPrompt = async (id: string, name: string) => {
    setBusy(id);
    try { await api.store.installPrompt(id); toast(`Installed prompt: ${name}`, "success"); await onInstalled(); }
    catch (e) { toast(`Install failed: ${(e as Error).message}`, "error"); }
    finally { setBusy(null); }
  };
  const doInstallWorkflow = async (id: string, name: string) => {
    setBusy(id);
    try { await api.store.installWorkflow(id); toast(`Installed workflow: ${name}`, "success"); await onInstalled(); }
    catch (e) { toast(`Install failed: ${(e as Error).message}`, "error"); }
    finally { setBusy(null); }
  };
  const doInstallSysPrompt = async (id: string, name: string) => {
    setBusy(id);
    try { await api.store.installSystemPrompt(id); toast(`Installed system prompt: ${name}`, "success"); await onInstalled(); }
    catch (e) { toast(`Install failed: ${(e as Error).message}`, "error"); }
    finally { setBusy(null); }
  };
  const doInstallModel = async (id: string, name: string) => {
    setBusy(id);
    try {
      const r = await api.store.installModel(id);
      toast(`Downloading ${name} — job ${r.job_id.slice(0, 8)}`, "success");
      await onInstalled();
    }
    catch (e) { toast(`Download failed: ${(e as Error).message}`, "error"); }
    finally { setBusy(null); }
  };

  const tabs = useMemo(() => TAB_META, []);

  return (
    <div className="flex flex-col h-full min-h-screen">
      <div className="px-6 py-4 border-b border-white/[0.04]">
        <PageHeader icon={<Store className="w-5 h-5" />} title="Store" description="Install models, prompts, workflows, system prompts, and MCP servers">
          <Link href="/downloads/active">
            <Button variant="ghost" size="sm" className="gap-1.5">
              <Download className="w-3.5 h-3.5" /> Active downloads
            </Button>
          </Link>
          <ProposeEntryMenu />
          <Button onClick={refresh} variant="ghost" size="sm" className="gap-1.5" disabled={refreshing}>
            {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh catalog
          </Button>
        </PageHeader>
      </div>

      <div className="px-6 pt-4 flex gap-2 items-center border-b border-white/[0.04]">
        <div className="flex gap-1 flex-wrap">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-t text-xs font-medium border-b-2 transition-colors",
                tab === t.key
                  ? "text-indigo-300 border-indigo-400 bg-indigo-950/20"
                  : "text-zinc-500 hover:text-zinc-300 border-transparent",
              )}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by name, tag, or description…"
          className="ml-auto w-72 bg-zinc-900 border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <div className="text-center text-zinc-500 py-16 text-sm">Loading catalog…</div>
        ) : !catalog ? (
          <div className="text-center text-zinc-500 py-16 text-sm">Catalog unavailable.</div>
        ) : tab === "featured" ? (
          <FeaturedView
            catalog={catalog} search={search} isInstalled={isInstalled} busy={busy}
            onInstallPrompt={doInstallPrompt} onInstallWorkflow={doInstallWorkflow}
            onInstallSysPrompt={doInstallSysPrompt} onInstallModel={doInstallModel}
            onConfigureMcp={setMcpConfiguring}
          />
        ) : tab === "models" ? (
          <ModelsTab
            catalog={catalog}
            search={search}
            isInstalled={isInstalled}
            busy={busy}
            doInstallModel={doInstallModel}
          />
        ) : tab === "prompts" ? (
          <Grid>
            {filterItems(catalog.prompts, search).map(p => (
              <ItemCard
                key={p.id}
                title={p.name}
                description={p.description}
                tags={p.tags}
                preview={p.content}
                installed={isInstalled("prompts", p.id)}
                busy={busy === p.id}
                action={() => doInstallPrompt(p.id, p.name)}
                actionLabel="Install"
              />
            ))}
          </Grid>
        ) : tab === "workflows" ? (
          <Grid>
            {filterItems(catalog.workflows, search).map(w => (
              <ItemCard
                key={w.id}
                title={w.name}
                subtitle={`agent: ${w.agent}`}
                description={w.description}
                tags={w.tags}
                preview={w.template}
                installed={isInstalled("workflows", w.id)}
                busy={busy === w.id}
                action={() => doInstallWorkflow(w.id, w.name)}
                actionLabel="Install"
              />
            ))}
          </Grid>
        ) : tab === "system_prompts" ? (
          <Grid>
            {filterItems(catalog.system_prompts, search).map(s => (
              <ItemCard
                key={s.id}
                title={s.name}
                description={s.description}
                tags={s.tags}
                preview={s.content}
                installed={isInstalled("system_prompts", s.id)}
                busy={busy === s.id}
                action={() => doInstallSysPrompt(s.id, s.name)}
                actionLabel="Install"
              />
            ))}
          </Grid>
        ) : tab === "mcps" ? (
          <Grid>
            {filterItems(catalog.mcps, search).map(m => (
              <ItemCard
                key={m.id}
                title={m.name}
                subtitle={m.runtime ? `via ${m.runtime}` : undefined}
                description={m.description}
                tags={m.tags}
                repo={m.repo}
                installed={isInstalled("mcps", m.id)}
                busy={busy === m.id}
                action={() => setMcpConfiguring(m)}
                actionLabel={(m.config_params?.length ?? 0) > 0 ? "Configure…" : "Install"}
              />
            ))}
          </Grid>
        ) : (
          <InstalledView search={search} onReconfigureMcp={(mcpId) => {
            const m = catalog.mcps.find(x => x.id === mcpId);
            if (m) setMcpConfiguring(m);
          }} refreshKey={busy /* bust cache on mutations */} />
        )}
      </div>

      {mcpConfiguring && (
        <McpConfigDialog
          mcp={mcpConfiguring}
          onCancel={() => setMcpConfiguring(null)}
          onInstalled={async () => {
            setMcpConfiguring(null);
            await onInstalled();
          }}
        />
      )}
    </div>
  );
}

// ── Featured tab ─────────────────────────────────────────────────────────────

function FeaturedView({
  catalog, search, isInstalled, busy,
  onInstallPrompt, onInstallWorkflow, onInstallSysPrompt, onInstallModel,
  onConfigureMcp,
}: {
  catalog: StoreCatalog;
  search: string;
  isInstalled: (kind: keyof StoreInstalled, id: string) => boolean;
  busy: string | null;
  onInstallPrompt: (id: string, name: string) => void;
  onInstallWorkflow: (id: string, name: string) => void;
  onInstallSysPrompt: (id: string, name: string) => void;
  onInstallModel: (id: string, name: string) => void;
  onConfigureMcp: (m: StoreMcp) => void;
}) {
  const sections = [
    { label: "Models", kind: "models" as const, items: filterItems(catalog.models.filter(x => x.featured), search) },
    { label: "Prompts", kind: "prompts" as const, items: filterItems(catalog.prompts.filter(x => x.featured), search) },
    { label: "Workflows", kind: "workflows" as const, items: filterItems(catalog.workflows.filter(x => x.featured), search) },
    { label: "System prompts", kind: "system_prompts" as const, items: filterItems(catalog.system_prompts.filter(x => x.featured), search) },
    { label: "MCPs", kind: "mcps" as const, items: filterItems(catalog.mcps.filter(x => x.featured), search) },
  ];
  const anything = sections.some(s => s.items.length > 0);

  if (!anything) {
    return <div className="text-center text-zinc-500 py-16 text-sm">Nothing featured right now.</div>;
  }

  return (
    <div className="space-y-8">
      {sections.map(s => s.items.length > 0 && (
        <section key={s.kind}>
          <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500 mb-3">{s.label}</h2>
          <Grid>
            {s.items.map(item => {
              const subtitle = "repo_id" in item ? (item as any).repo_id : ("agent" in item ? `agent: ${(item as any).agent}` : "runtime" in item ? `via ${(item as any).runtime}` : undefined);
              const preview = "content" in item ? (item as any).content : ("template" in item ? (item as any).template : undefined);
              const sizeBadge = "size_gb" in item && (item as any).size_gb ? `${(item as any).size_gb} GB` : undefined;
              const isMcp = s.kind === "mcps";
              const actionLabel =
                s.kind === "models" ? "Download" :
                isMcp ? (((item as StoreMcp).config_params?.length ?? 0) > 0 ? "Configure…" : "Install") :
                "Install";
              const act = () => {
                if (s.kind === "models") onInstallModel(item.id, item.name);
                else if (s.kind === "prompts") onInstallPrompt(item.id, item.name);
                else if (s.kind === "workflows") onInstallWorkflow(item.id, item.name);
                else if (s.kind === "system_prompts") onInstallSysPrompt(item.id, item.name);
                else if (isMcp) onConfigureMcp(item as StoreMcp);
              };
              return (
                <ItemCard
                  key={item.id}
                  title={item.name}
                  subtitle={subtitle}
                  description={(item as any).description}
                  tags={(item as any).tags}
                  preview={preview}
                  sizeBadge={sizeBadge}
                  installed={isInstalled(s.kind, item.id)}
                  busy={busy === item.id}
                  action={act}
                  actionLabel={actionLabel}
                />
              );
            })}
          </Grid>
        </section>
      ))}
    </div>
  );
}

// ── Building blocks ──────────────────────────────────────────────────────────

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

function ItemCard({
  title, subtitle, description, tags, preview, sizeBadge, repo,
  installed, busy, action, actionLabel,
}: {
  title: string;
  subtitle?: string;
  description?: string;
  tags?: string[];
  preview?: string;
  sizeBadge?: string;
  repo?: string;
  installed?: boolean;
  busy?: boolean;
  action: () => void;
  actionLabel: string;
}) {
  const [showPreview, setShowPreview] = useState(false);
  return (
    <div className="rounded-xl border border-white/[0.06] bg-zinc-900/40 p-4 flex flex-col gap-3 min-h-[120px]">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-100 truncate">{title}</h3>
            {sizeBadge && (
              <span className="text-[10px] font-mono bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">
                {sizeBadge}
              </span>
            )}
          </div>
          {subtitle && <p className="text-xs text-zinc-500 font-mono truncate mt-0.5">{subtitle}</p>}
        </div>
        {repo && (
          <a
            href={repo}
            target="_blank"
            rel="noreferrer"
            className="text-zinc-500 hover:text-zinc-200 p-1 -m-1"
            title="View source"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      {description && <p className="text-xs text-zinc-400 leading-relaxed">{description}</p>}

      {tags && tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.filter(t => t !== "featured").map(t => (
            <span key={t} className="text-[10px] bg-indigo-900/25 text-indigo-300 border border-indigo-500/20 px-1.5 py-0.5 rounded">
              {t}
            </span>
          ))}
        </div>
      )}

      {preview && (
        <div>
          <button
            onClick={() => setShowPreview(v => !v)}
            className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300"
          >
            {showPreview ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {showPreview ? "Hide" : "Preview"}
          </button>
          {showPreview && (
            <pre className="mt-1.5 text-[10px] text-zinc-400 bg-black/30 rounded px-2 py-1.5 max-h-32 overflow-y-auto whitespace-pre-wrap">
              {preview}
            </pre>
          )}
        </div>
      )}

      <div className="mt-auto pt-1">
        {installed ? (
          <button
            onClick={action}
            className="w-full flex items-center justify-center gap-1.5 text-xs bg-emerald-900/20 text-emerald-300 border border-emerald-500/30 rounded px-3 py-1.5"
            title="Re-install to refresh the local copy from the current catalog"
          >
            <Check className="w-3.5 h-3.5" /> Installed
          </button>
        ) : (
          <Button
            onClick={action}
            disabled={busy}
            variant="primary"
            size="sm"
            className="w-full gap-1.5 text-xs"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {actionLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── MCP configure-and-install dialog ────────────────────────────────────────

function McpConfigDialog({
  mcp, onCancel, onInstalled,
}: {
  mcp: StoreMcp;
  onCancel: () => void;
  onInstalled: () => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const p of mcp.config_params ?? []) if (p.default) out[p.name] = p.default;
    return out;
  });
  const [saving, setSaving] = useState(false);

  const requiredMissing = (mcp.config_params ?? []).some(p => p.required && !values[p.name]?.trim());

  const submit = async () => {
    setSaving(true);
    try {
      await api.store.installMcp(mcp.id, values);
      toast(`Installed MCP: ${mcp.name}`, "success");
      await onInstalled();
    } catch (e) {
      toast(`Install failed: ${(e as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
         onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="px-5 py-4 border-b border-white/[0.08]">
          <h2 className="text-sm font-semibold text-zinc-100">{mcp.name}</h2>
          {mcp.description && <p className="text-xs text-zinc-500 mt-1">{mcp.description}</p>}
        </div>
        <div className="px-5 py-4 space-y-3">
          {(mcp.config_params ?? []).length === 0 ? (
            <p className="text-xs text-zinc-400">No configuration needed. Click Install to add this MCP to your registry.</p>
          ) : (
            (mcp.config_params ?? []).map(p => (
              <div key={p.name} className="space-y-1">
                <label className="text-xs font-medium text-zinc-300">
                  {p.name}{p.required && <span className="text-red-400 ml-0.5">*</span>}
                </label>
                {p.description && <p className="text-[10px] text-zinc-500">{p.description}</p>}
                <input
                  type={p.secret ? "password" : "text"}
                  value={values[p.name] ?? ""}
                  onChange={(e) => setValues(v => ({ ...v, [p.name]: e.target.value }))}
                  placeholder={p.default || ""}
                  className="w-full bg-zinc-800 border border-white/10 rounded px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 font-mono"
                />
              </div>
            ))
          )}
          <pre className="text-[10px] text-zinc-500 bg-black/30 rounded px-2 py-1.5 mt-3 overflow-x-auto">
            {mcp.command} {mcp.args.map(a => Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, v || `{${k}}`), a)).join(" ")}
          </pre>
        </div>
        <div className="px-5 py-3 border-t border-white/[0.08] flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={saving || requiredMissing} className="gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            Install
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Models tab (curated + HF search) ────────────────────────────────────────

function ModelsTab({ catalog, search, isInstalled, busy, doInstallModel }: {
  catalog: StoreCatalog;
  search: string;
  isInstalled: (kind: keyof StoreInstalled, id: string) => boolean;
  busy: string | null;
  doInstallModel: (id: string, name: string) => void;
}) {
  return (
    <div className="space-y-8">
      <Section title={`Curated picks (${filterItems(catalog.models, search).length})`}>
        <Grid>
          {filterItems(catalog.models, search).map(m => (
            <ItemCard
              key={m.id}
              title={m.name}
              subtitle={m.repo_id}
              description={m.description}
              tags={m.tags}
              sizeBadge={m.size_gb ? `${m.size_gb} GB` : undefined}
              installed={isInstalled("models", m.id)}
              busy={busy === m.id}
              action={() => doInstallModel(m.id, m.name)}
              actionLabel="Download"
            />
          ))}
        </Grid>
      </Section>
      <Section title="Search HuggingFace">
        <HFSearch initialQuery={search} />
      </Section>
    </div>
  );
}

function HFSearch({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [kind, setKind] = useState<"mlx" | "gguf">("mlx");
  const [results, setResults] = useState<HFSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [starting, setStarting] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadJobs = useCallback(async () => {
    try { setJobs(await api.hf.listDownloads()); } catch {}
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);
  useEffect(() => {
    // Only poll while jobs are in flight to avoid unnecessary churn.
    const live = jobs.some(j => j.status === "queued" || j.status === "downloading");
    if (!live) return;
    const id = setInterval(loadJobs, 2500);
    return () => clearInterval(id);
  }, [jobs, loadJobs]);

  const runSearch = useCallback(async (q: string, k: "mlx" | "gguf") => {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const suffix = k === "mlx" ? " mlx" : " gguf";
      setResults(await api.hf.search(q + suffix, 30));
    } catch { setResults([]); }
    finally { setSearching(false); }
  }, []);

  // Debounce the query — 500ms keeps us from burning HF rate-limit quota.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => runSearch(query, kind), 500);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query, kind, runSearch]);

  const startDownload = async (r: HFSearchResult) => {
    setStarting(r.repo_id);
    try {
      await api.hf.startDownload(r.repo_id, kind);
      toast(`Download queued: ${r.repo_id}`, "success");
      await loadJobs();
    } catch (e) {
      toast(`Download failed: ${(e as Error).message}`, "error");
    } finally {
      setStarting(null);
    }
  };

  const activeJobs = jobs.filter(j => j.status === "queued" || j.status === "downloading");

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search HuggingFace — try 'qwen coder', 'llama 3.2', 'mistral'…"
            className="w-full bg-zinc-900 border border-white/[0.08] rounded-lg pl-8 pr-8 py-2 text-xs text-zinc-100 placeholder:text-zinc-600"
          />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
              <XIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex rounded-lg overflow-hidden border border-white/[0.08]">
          {(["mlx", "gguf"] as const).map(k => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={cn(
                "px-3 py-2 text-xs font-medium uppercase transition-colors",
                kind === k ? "bg-indigo-600/30 text-indigo-200" : "bg-zinc-900 text-zinc-400 hover:text-zinc-200",
              )}
            >{k}</button>
          ))}
        </div>
      </div>

      {activeJobs.length > 0 && (
        <div className="rounded-lg border border-indigo-500/20 bg-indigo-950/20 p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-indigo-300 font-medium">
            Active downloads ({activeJobs.length})
          </div>
          {activeJobs.map(j => {
            const pct = j.total_bytes ? Math.round((j.downloaded_bytes ?? 0) / j.total_bytes * 100) : 0;
            return (
              <div key={j.job_id} className="text-[11px] text-zinc-300 flex items-center gap-2">
                <span className="truncate flex-1 font-mono" title={j.repo_id}>{j.repo_id}</span>
                <span className="font-mono text-zinc-500 w-12 text-right">{pct}%</span>
                <div className="w-32 h-1.5 bg-zinc-800 rounded overflow-hidden">
                  <div className="h-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
                </div>
                <button
                  onClick={async () => { try { await api.hf.cancelDownload(j.job_id); } catch {} loadJobs(); }}
                  className="text-zinc-500 hover:text-red-300"
                  title="Cancel"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {searching ? (
        <div className="text-center text-zinc-500 py-8 text-sm">Searching HuggingFace…</div>
      ) : !query.trim() ? (
        <div className="text-center text-zinc-600 py-8 text-sm">
          Type a query to search HuggingFace. Kind toggle filters results to MLX or GGUF variants.
        </div>
      ) : results.length === 0 ? (
        <div className="text-center text-zinc-500 py-8 text-sm">No results for &ldquo;{query}&rdquo;.</div>
      ) : (
        <div className="space-y-2">
          {results.map(r => {
            const live = jobs.find(j => j.repo_id === r.repo_id && (j.status === "queued" || j.status === "downloading"));
            const done = jobs.find(j => j.repo_id === r.repo_id && j.status === "done");
            return (
              <div key={r.repo_id} className="rounded-lg border border-white/[0.06] bg-zinc-900/40 p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <a
                      href={`https://huggingface.co/${r.repo_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-mono text-zinc-100 hover:text-indigo-300 truncate inline-flex items-center gap-1"
                    >
                      {r.repo_id}<ExternalLink className="w-3 h-3 opacity-60" />
                    </a>
                    {typeof r.downloads === "number" && (
                      <span className="text-[10px] text-zinc-500 font-mono">↓ {r.downloads.toLocaleString()}</span>
                    )}
                    {typeof r.likes === "number" && (
                      <span className="text-[10px] text-zinc-500 font-mono">♥ {r.likes.toLocaleString()}</span>
                    )}
                  </div>
                  {r.tags && r.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {r.tags.slice(0, 5).map(t => (
                        <span key={t} className="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  {done ? (
                    <span className="flex items-center gap-1 text-[11px] text-emerald-300 font-medium bg-emerald-900/20 border border-emerald-500/30 px-2.5 py-1 rounded">
                      <Check className="w-3 h-3" /> Downloaded
                    </span>
                  ) : live ? (
                    <span className="text-[11px] text-indigo-300 font-mono bg-indigo-900/20 border border-indigo-500/30 px-2.5 py-1 rounded">
                      {live.total_bytes ? Math.round((live.downloaded_bytes ?? 0) / live.total_bytes * 100) : 0}%
                    </span>
                  ) : (
                    <Button
                      onClick={() => startDownload(r)}
                      variant="primary"
                      size="sm"
                      disabled={starting === r.repo_id}
                      className="gap-1.5 text-xs"
                    >
                      {starting === r.repo_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                      Download
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Installed tab ───────────────────────────────────────────────────────────

function InstalledView({ search, onReconfigureMcp, refreshKey }: {
  search: string;
  onReconfigureMcp: (mcpId: string) => void;
  refreshKey: unknown;
}) {
  const [data, setData] = useState<InstalledDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.store.installedDetail());
    } catch (e) {
      toast(`Load failed: ${(e as Error).message}`, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const withBusy = async (key: string, fn: () => Promise<void>, onSuccess: string) => {
    setMutating(key);
    try { await fn(); toast(onSuccess, "success"); await load(); }
    catch (e) { toast(`Failed: ${(e as Error).message}`, "error"); }
    finally { setMutating(null); }
  };

  if (loading) return <div className="text-center text-zinc-500 py-16 text-sm">Loading…</div>;
  if (!data) return <div className="text-center text-zinc-500 py-16 text-sm">No data.</div>;

  const filterByName = <T extends { name: string }>(xs: T[]) =>
    !search.trim() ? xs : xs.filter(x => x.name.toLowerCase().includes(search.toLowerCase()));

  const mcps = filterByName(data.mcps);
  const prompts = filterByName(data.prompts);
  const workflows = filterByName(data.workflows);
  const sysPrompts = filterByName(data.system_prompts);
  const models = filterByName(data.models);

  const empty = mcps.length + prompts.length + workflows.length + sysPrompts.length + models.length === 0;
  if (empty) return <div className="text-center text-zinc-500 py-16 text-sm">Nothing installed yet. Head to one of the other tabs.</div>;

  return (
    <div className="space-y-8">
      {mcps.length > 0 && (
        <Section title={`MCPs (${mcps.length})`}>
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {mcps.map(m => (
              <McpInstalledCard
                key={m.id}
                mcpId={m.id}
                name={m.name}
                command={m.command}
                args={m.args}
                env={m.env}
                busy={mutating === m.id}
                onReconfigure={() => onReconfigureMcp(m.id)}
                onUninstall={() => withBusy(m.id, () => api.store.uninstallMcp(m.id).then(() => {}), `Uninstalled ${m.name}`)}
              />
            ))}
          </div>
        </Section>
      )}

      {prompts.length > 0 && (
        <Section title={`Prompts (${prompts.length})`}>
          <Grid>
            {prompts.map(p => (
              <InstalledRow
                key={p.id}
                title={p.name}
                subtitle={p.description}
                preview={p.content}
                busy={mutating === p.id}
                actions={[
                  { label: "Delete", icon: <Trash2 className="w-3 h-3" />, destructive: true,
                    onClick: () => withBusy(p.id, () => api.store.uninstallPrompt(p.id).then(() => {}), `Deleted ${p.name}`) },
                ]}
              />
            ))}
          </Grid>
        </Section>
      )}

      {workflows.length > 0 && (
        <Section title={`Workflows (${workflows.length})`}>
          <Grid>
            {workflows.map(w => (
              <InstalledRow
                key={w.id}
                title={w.name}
                subtitle={`agent: ${w.agent} · runs: ${w.run_count}`}
                preview={w.template}
                busy={mutating === w.id}
                actions={[
                  { label: "Delete", icon: <Trash2 className="w-3 h-3" />, destructive: true,
                    onClick: () => withBusy(w.id, () => api.store.uninstallWorkflow(w.id).then(() => {}), `Deleted ${w.name}`) },
                ]}
              />
            ))}
          </Grid>
        </Section>
      )}

      {sysPrompts.length > 0 && (
        <Section title={`System prompts (${sysPrompts.length})`}>
          <Grid>
            {sysPrompts.map(s => (
              <InstalledRow
                key={s.id}
                title={s.name}
                subtitle={s.category}
                preview={s.content}
                busy={mutating === s.id}
                actions={[
                  { label: "Delete", icon: <Trash2 className="w-3 h-3" />, destructive: true,
                    onClick: () => withBusy(s.id, () => api.store.uninstallSystemPrompt(s.id).then(() => {}), `Deleted ${s.name}`) },
                ]}
              />
            ))}
          </Grid>
        </Section>
      )}

      {models.length > 0 && (
        <Section title={`Models (${models.length})`}>
          <Grid>
            {models.map(m => (
              <InstalledRow
                key={m.id}
                title={m.name}
                subtitle={`${m.kind} · ${m.size_bytes ? (m.size_bytes / 1e9).toFixed(1) + " GB" : ""}${m.avg_tps ? ` · ${m.avg_tps.toFixed(1)} tok/s` : ""}`}
                busy={false}
                actions={[]}
              />
            ))}
          </Grid>
        </Section>
      )}
    </div>
  );
}

// ── MCP installed card (with tools tester) ─────────────────────────────────

function McpInstalledCard({ mcpId, name, command, args, env, busy, onReconfigure, onUninstall }: {
  mcpId: string; name: string; command: string; args: string[]; env: Record<string, string>;
  busy: boolean;
  onReconfigure: () => void;
  onUninstall: () => void;
}) {
  const [showTools, setShowTools] = useState(false);
  const [tools, setTools] = useState<McpTool[] | null>(null);
  const [loadingTools, setLoadingTools] = useState(false);
  const [toolsErr, setToolsErr] = useState<string | null>(null);

  const fetchTools = useCallback(async (force = false) => {
    setLoadingTools(true);
    setToolsErr(null);
    try {
      const r = await api.mcp.tools(mcpId, force);
      setTools(r.tools);
    } catch (e) {
      setToolsErr((e as Error).message || "Failed to load tools");
      setTools([]);
    } finally {
      setLoadingTools(false);
    }
  }, [mcpId]);

  const toggleTools = () => {
    setShowTools(v => {
      const next = !v;
      if (next && tools === null) fetchTools();
      return next;
    });
  };

  return (
    <div className="rounded-xl border border-white/[0.06] bg-zinc-900/40 p-4 flex flex-col gap-2">
      <div>
        <h3 className="text-sm font-semibold text-zinc-100 truncate">{name}</h3>
        <p className="text-[11px] text-zinc-500 font-mono truncate">
          {command} {args.slice(0, 3).join(" ")}{args.length > 3 ? "…" : ""}
        </p>
        {Object.keys(env).length > 0 && (
          <p className="text-[10px] text-zinc-600 mt-0.5">env: {Object.keys(env).join(", ")}</p>
        )}
      </div>

      <div className="flex gap-1 flex-wrap mt-1">
        <button
          onClick={toggleTools}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border bg-indigo-950/20 text-indigo-300 border-indigo-500/30 hover:bg-indigo-900/30 transition-colors"
        >
          <Plug className="w-3 h-3" />
          {showTools ? "Hide tools" : "Tools"}
        </button>
        <button
          onClick={onReconfigure}
          disabled={busy}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border bg-zinc-800 text-zinc-300 border-white/[0.08] hover:bg-zinc-700 transition-colors disabled:opacity-50"
        >
          <Settings className="w-3 h-3" /> Reconfigure
        </button>
        <button
          onClick={onUninstall}
          disabled={busy}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border bg-red-950/20 text-red-300 border-red-500/30 hover:bg-red-900/30 transition-colors disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
          Uninstall
        </button>
      </div>

      {showTools && (
        <div className="mt-2 space-y-2 border-t border-white/[0.06] pt-2">
          {loadingTools && tools === null ? (
            <div className="text-center text-zinc-500 text-xs py-3">
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
              Starting MCP server…
            </div>
          ) : toolsErr ? (
            <div className="text-xs text-red-300 bg-red-950/20 border border-red-500/20 rounded p-2">
              {toolsErr}
              <button
                onClick={() => fetchTools(true)}
                className="ml-2 underline hover:text-red-200"
              >Retry</button>
            </div>
          ) : tools && tools.length === 0 ? (
            <div className="text-xs text-zinc-500">No tools exposed.</div>
          ) : tools && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                  {tools.length} tool{tools.length === 1 ? "" : "s"}
                </span>
                <button
                  onClick={() => fetchTools(true)}
                  disabled={loadingTools}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1"
                >
                  <RefreshCw className={cn("w-3 h-3", loadingTools && "animate-spin")} /> Refresh
                </button>
              </div>
              {tools.map(t => <McpToolRow key={t.name} mcpId={mcpId} tool={t} />)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function McpToolRow({ mcpId, tool }: { mcpId: string; tool: McpTool }) {
  const schemaProps = tool.inputSchema?.properties ?? {};
  const required = new Set(tool.inputSchema?.required ?? []);
  const propNames = Object.keys(schemaProps);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<McpCallResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runTool = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    // Coerce values using the schema type. Anything we don't recognize goes
    // through as a string; MCP servers are pretty forgiving.
    const coerced: Record<string, unknown> = {};
    for (const name of propNames) {
      const raw = args[name];
      if (raw === undefined || raw === "") continue;
      const t = schemaProps[name]?.type;
      if (t === "number" || t === "integer") {
        const n = Number(raw);
        if (!Number.isNaN(n)) coerced[name] = n;
        else coerced[name] = raw;
      } else if (t === "boolean") {
        coerced[name] = raw === "true" || raw === "1";
      } else if (t === "array" || t === "object") {
        try { coerced[name] = JSON.parse(raw); } catch { coerced[name] = raw; }
      } else {
        coerced[name] = raw;
      }
    }
    try {
      const r = await api.mcp.call(mcpId, tool.name, coerced);
      setResult(r.result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded border border-white/[0.06] bg-black/20 text-[11px]">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full text-left px-2 py-1.5 flex items-start gap-2 hover:bg-zinc-800/40"
      >
        <span className="font-mono text-indigo-300 truncate">{tool.name}</span>
        {tool.description && <span className="text-zinc-500 truncate flex-1">— {tool.description}</span>}
      </button>
      {open && (
        <div className="px-2 pb-2 pt-1 space-y-1.5 border-t border-white/[0.06]">
          {propNames.length === 0 ? (
            <p className="text-zinc-500">No arguments.</p>
          ) : (
            propNames.map(n => {
              const p = schemaProps[n];
              const isReq = required.has(n);
              return (
                <div key={n} className="space-y-0.5">
                  <label className="text-[10px] text-zinc-400 font-medium">
                    {n}{isReq && <span className="text-red-400 ml-0.5">*</span>}
                    {p?.type && <span className="text-zinc-600 ml-1 font-mono">({p.type})</span>}
                  </label>
                  {p?.description && <p className="text-[9px] text-zinc-600">{p.description}</p>}
                  <input
                    type="text"
                    value={args[n] ?? ""}
                    onChange={(e) => setArgs(a => ({ ...a, [n]: e.target.value }))}
                    className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2 py-1 text-[10px] text-zinc-100 font-mono"
                  />
                </div>
              );
            })
          )}
          <Button
            onClick={runTool}
            disabled={running}
            size="sm"
            variant="primary"
            className="gap-1 text-[10px]"
          >
            {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plug className="w-3 h-3" />}
            Run tool
          </Button>
          {error && (
            <pre className="mt-1 text-[10px] text-red-300 bg-red-950/20 border border-red-500/20 rounded p-1.5 whitespace-pre-wrap">{error}</pre>
          )}
          {result && (
            <pre className={cn(
              "mt-1 text-[10px] rounded p-1.5 whitespace-pre-wrap max-h-60 overflow-y-auto",
              result.isError
                ? "text-red-300 bg-red-950/20 border border-red-500/20"
                : "text-zinc-300 bg-black/30 border border-white/[0.06]",
            )}>
              {result.content
                ? result.content.map(c => c.text ?? JSON.stringify(c)).join("\n")
                : JSON.stringify(result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500 mb-3">{title}</h2>
      {children}
    </section>
  );
}

type InstalledAction = {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
};

function InstalledRow({ title, subtitle, preview, busy, actions }: {
  title: string;
  subtitle?: string;
  preview?: string;
  busy: boolean;
  actions: InstalledAction[];
}) {
  const [showPreview, setShowPreview] = useState(false);
  return (
    <div className="rounded-xl border border-white/[0.06] bg-zinc-900/40 p-4 flex flex-col gap-2">
      <div>
        <h3 className="text-sm font-semibold text-zinc-100 truncate">{title}</h3>
        {subtitle && <p className="text-xs text-zinc-500 mt-0.5 truncate">{subtitle}</p>}
      </div>
      {preview && (
        <div>
          <button
            onClick={() => setShowPreview(v => !v)}
            className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300"
          >
            {showPreview ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {showPreview ? "Hide" : "Preview"}
          </button>
          {showPreview && (
            <pre className="mt-1 text-[10px] text-zinc-400 bg-black/30 rounded px-2 py-1.5 max-h-32 overflow-y-auto whitespace-pre-wrap">
              {preview}
            </pre>
          )}
        </div>
      )}
      {actions.length > 0 && (
        <div className="flex gap-1 mt-auto pt-1">
          {actions.map(a => (
            <button
              key={a.label}
              onClick={a.onClick}
              disabled={busy}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition-colors disabled:opacity-50",
                a.destructive
                  ? "bg-red-950/20 text-red-300 border-red-500/30 hover:bg-red-900/30"
                  : "bg-zinc-800 text-zinc-300 border-white/[0.08] hover:bg-zinc-700",
              )}
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : a.icon}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Propose-entry dropdown ──────────────────────────────────────────────────

const ISSUE_BASE = "https://github.com/Buckeyes1995/crucible-store/issues/new";
const PROPOSE_KINDS: { key: string; label: string; template: string }[] = [
  { key: "model", label: "Model", template: "model.yml" },
  { key: "prompt", label: "Prompt", template: "prompt.yml" },
  { key: "workflow", label: "Workflow", template: "workflow.yml" },
  { key: "system_prompt", label: "System prompt", template: "system-prompt.yml" },
  { key: "mcp", label: "MCP", template: "mcp.yml" },
];

function ProposeEntryMenu() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-propose-menu]")) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="relative" data-propose-menu>
      <Button variant="ghost" size="sm" onClick={() => setOpen(v => !v)} className="gap-1.5">
        <Plus className="w-3.5 h-3.5" /> Propose entry
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-zinc-900 border border-white/10 rounded-lg shadow-2xl z-30 py-1">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-zinc-500 border-b border-white/[0.06]">
            Open GitHub issue
          </div>
          {PROPOSE_KINDS.map(k => (
            <a
              key={k.key}
              href={`${ISSUE_BASE}?template=${k.template}`}
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center justify-between px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              {k.label}
              <ExternalLink className="w-3 h-3 text-zinc-500" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Utilities ────────────────────────────────────────────────────────────────

function filterItems<T extends { name: string; description?: string; tags?: string[] }>(items: T[], search: string): T[] {
  if (!search.trim()) return items;
  const q = search.trim().toLowerCase();
  return items.filter(i =>
    i.name.toLowerCase().includes(q) ||
    (i.description ?? "").toLowerCase().includes(q) ||
    (i.tags ?? []).some(t => t.toLowerCase().includes(q)),
  );
}
