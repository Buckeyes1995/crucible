"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Store, Loader2, Check, RefreshCw, Sparkles, Package, Workflow,
  ShieldQuestion, Plug, Download, ExternalLink, Eye, EyeOff,
} from "lucide-react";
import {
  api, type StoreCatalog, type StoreInstalled, type StoreMcp,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "@/components/Toast";

type Tab = "featured" | "models" | "prompts" | "workflows" | "system_prompts" | "mcps";

const TAB_META: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "featured", label: "Featured", icon: <Sparkles className="w-3.5 h-3.5" /> },
  { key: "models", label: "Models", icon: <Package className="w-3.5 h-3.5" /> },
  { key: "prompts", label: "Prompts", icon: <Sparkles className="w-3.5 h-3.5" /> },
  { key: "workflows", label: "Workflows", icon: <Workflow className="w-3.5 h-3.5" /> },
  { key: "system_prompts", label: "System Prompts", icon: <ShieldQuestion className="w-3.5 h-3.5" /> },
  { key: "mcps", label: "MCPs", icon: <Plug className="w-3.5 h-3.5" /> },
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
        ) : (
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
