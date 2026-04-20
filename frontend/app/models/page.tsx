"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useModelsStore } from "@/lib/stores/models";
import { useFavoritesStore } from "@/lib/stores/favorites";
import { useAliasesStore } from "@/lib/stores/aliases";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { formatBytes, formatContext, formatTps, cn } from "@/lib/utils";
import { parseModelName } from "@/lib/model-parse";
import { RefreshCw, Square, Zap, BarChart2, Star, Pencil, Check, X, Settings2, StickyNote, Tag, EyeOff, Eye, Bolt, Search, Cpu, Loader2, Trash2, MessageSquare, ArrowUp, ArrowDown } from "lucide-react";
import Link from "next/link";
import { api, CAPABILITY_TAXONOMY, type ModelEntry, type ModelParams } from "@/lib/api";
import { toast } from "@/components/Toast";

type SortKey = "name" | "size" | "tps";
type SortDir = "asc" | "desc";

// Tokens that indicate "this and everything after is quant / engine / variant
// metadata, not part of the family name." Kept conservative so unrelated
// naming conventions don't collapse into the same family by accident.
const _QUANT_RE = /^(mlx|gguf|vllm|studio|dflash|mxfp\d+|q\d(_\w+)?|int\d+|fp\d+|\d+bit|crack|original|\d+B|A\d+B)$/i;
function familyOf(name: string): string {
  // Split on - . _ but keep letters+digits together. Walk forward until we
  // hit a quant-like token; everything before that is the family. If the
  // first token is already a quant (shouldn't happen for real models), fall
  // back to the full name.
  const parts = name.split(/[-.]/);
  const out: string[] = [];
  for (const p of parts) {
    if (_QUANT_RE.test(p)) break;
    out.push(p);
  }
  return out.length > 0 ? out.join("-") : name;
}

export default function ModelsPage() {
  const {
    models, loading, activeModelId, loadingModelId, loadStage, error,
    fetchModels, refreshModels, loadModel, cancelLoad, stopModel, syncStatus,
  } = useModelsStore();
  const { favorites, favoritesOnly, toggle: toggleFavorite, isFavorite, setFavoritesOnly } = useFavoritesStore();
  const { getAlias, setAlias, clearAlias } = useAliasesStore();

  const [search, setSearch] = useState("");
  const [filterKind, setFilterKind] = useState<string>("all");
  // Persist sort choice in localStorage so it sticks across reloads.
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    if (typeof window === "undefined") return "name";
    const v = window.localStorage.getItem("crucible.models.sortKey");
    return v === "size" || v === "tps" ? v : "name";
  });
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    if (typeof window === "undefined") return "asc";
    const v = window.localStorage.getItem("crucible.models.sortDir");
    return v === "desc" ? "desc" : "asc";
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("crucible.models.sortKey", sortKey);
  }, [sortKey]);
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("crucible.models.sortDir", sortDir);
  }, [sortDir]);
  const [paramsModelId, setParamsModelId] = useState<string | null>(null);
  const [notesModelId, setNotesModelId] = useState<string | null>(null);
  const [showGlobalParams, setShowGlobalParams] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [capFilter, setCapFilter] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [groupByFamily, setGroupByFamily] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("crucible.models.groupByFamily") === "1";
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("crucible.models.groupByFamily", groupByFamily ? "1" : "0");
    }
  }, [groupByFamily]);
  const [modelNotes, setModelNotes] = useState<Record<string, { notes: string; tags: string[] }>>({});
  const [showHidden, setShowHidden] = useState(false);
  const [filterNode, setFilterNode] = useState<string | null>(null);
  const [activeDownloads, setActiveDownloads] = useState<Record<string, { progress: number; message: string }>>({});

  useEffect(() => { fetchModels(); }, [fetchModels]);

  // Poll download jobs so the Models page can mark in-progress downloads
  useEffect(() => {
    const tick = async () => {
      try {
        const jobs = await api.hf.listDownloads();
        const map: Record<string, { progress: number; message: string }> = {};
        for (const j of jobs) {
          if (j.status === "downloading" || j.status === "queued") {
            const name = j.repo_id.split("/").pop() ?? j.repo_id;
            map[`${j.kind}:${name}`] = { progress: j.progress, message: j.message };
          }
        }
        setActiveDownloads(map);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    api.tags.list().then(setAllTags).catch(() => {});
  }, []);

  useEffect(() => {
    if (loadingModelId) return;
    const id = setInterval(syncStatus, 5000);
    return () => clearInterval(id);
  }, [syncStatus, loadingModelId]);

  const effectiveFavoritesOnly = favoritesOnly && favorites.length > 0;

  const hiddenCount = models.filter(m => m.hidden).length;

  const filtered = models
    .filter((m) => {
      if (m.hidden && !showHidden) return false;
      if (effectiveFavoritesOnly && !isFavorite(m.id)) return false;
      if (filterKind !== "all" && m.kind !== filterKind) return false;
      if (filterNode && (m.node ?? "local") !== filterNode) return false;
      const alias = getAlias(m.id) ?? "";
      if (search && !m.name.toLowerCase().includes(search.toLowerCase()) && !alias.toLowerCase().includes(search.toLowerCase())) return false;
      if (tagFilter) {
        const tags = modelNotes[m.id]?.tags ?? [];
        if (!tags.includes(tagFilter)) return false;
      }
      if (capFilter) {
        if (!(m.capabilities ?? []).includes(capFilter)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      // Active model always first (it gets pinned into its own 'Loaded'
      // section above the Library grid so the rest of the sort is strict).
      const aActive = a.id === activeModelId ? 0 : 1;
      const bActive = b.id === activeModelId ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      // Favorites are visually distinct (amber border) but NOT position-pinned
      // so an explicit sort choice is honored strictly.
      const mul = sortDir === "asc" ? 1 : -1;
      if (sortKey === "size") return mul * ((a.size_bytes ?? 0) - (b.size_bytes ?? 0));
      if (sortKey === "tps")  return mul * ((a.avg_tps ?? 0) - (b.avg_tps ?? 0));
      return mul * a.name.localeCompare(b.name);
    });

  const paramsModel = paramsModelId ? models.find((m) => m.id === paramsModelId) : null;

  return (
    <div className="px-8 py-8 max-w-7xl animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-zinc-800/50 text-indigo-400">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-zinc-100 tracking-tight">Models</h1>
            <p className="text-xs text-zinc-500 mt-0.5">
              {models.length} models · {favorites.length} favorited{hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ""}
            </p>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {loadingModelId && (
            <Button variant="destructive" size="sm" onClick={cancelLoad} className="gap-1.5">
              <Square className="w-3 h-3 fill-current" /> Stop
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setShowGlobalParams(true)} className="gap-1.5">
            <Settings2 className="w-3.5 h-3.5" /> Defaults
          </Button>
          <Button variant="secondary" size="sm" onClick={refreshModels} disabled={loading} className="gap-1.5">
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} /> Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2.5 rounded-xl bg-red-950/40 border border-red-500/20 text-red-300 text-sm animate-fade-in">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-6 flex-wrap items-center">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
          <Input
            className="w-64 pl-9"
            placeholder="Search models…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1">
          {([ ["all", "All"], ["mlx", "MLX"], ["vllm", "vLLM"], ["gguf", "GGUF"], ["ollama", "Ollama"] ] as [string, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilterKind(k)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                filterKind === k
                  ? "bg-indigo-500/15 text-indigo-300 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.2)]"
                  : "bg-zinc-800/60 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Node filter — only show if there are remote models */}
        {(() => {
          const nodeNames = [...new Set(models.map(m => m.node ?? "local").filter(n => n !== "local"))];
          if (nodeNames.length === 0) return null;
          return (
            <div className="flex gap-1">
              <button
                onClick={() => setFilterNode(null)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  !filterNode ? "bg-cyan-600 text-white" : "bg-zinc-800 text-zinc-400 hover:text-zinc-100"
                )}
              >
                All nodes
              </button>
              <button
                onClick={() => setFilterNode(filterNode === "local" ? null : "local")}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  filterNode === "local" ? "bg-cyan-600 text-white" : "bg-zinc-800 text-zinc-400 hover:text-zinc-100"
                )}
              >
                Local
              </button>
              {nodeNames.map(name => (
                <button
                  key={name}
                  onClick={() => setFilterNode(filterNode === name ? null : name)}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                    filterNode === name ? "bg-cyan-600 text-white" : "bg-zinc-800 text-zinc-400 hover:text-zinc-100"
                  )}
                >
                  @{name}
                </button>
              ))}
            </div>
          );
        })()}

        <button
          onClick={() => setFavoritesOnly(!favoritesOnly)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            effectiveFavoritesOnly
              ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
              : "bg-zinc-800 text-zinc-400 hover:text-zinc-100"
          )}
        >
          <Star className={cn("w-3.5 h-3.5", effectiveFavoritesOnly && "fill-amber-400")} />
          Favorites{favorites.length > 0 && ` (${favorites.length})`}
        </button>

        {hiddenCount > 0 && (
          <button
            onClick={() => setShowHidden(v => !v)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              showHidden
                ? "bg-zinc-600/40 text-zinc-300 border border-zinc-500/40"
                : "bg-zinc-800 text-zinc-400 hover:text-zinc-100"
            )}
          >
            {showHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {showHidden ? "Hiding hidden" : `Hidden (${hiddenCount})`}
          </button>
        )}

        {allTags.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            <span className="text-xs text-zinc-500 self-center mr-1">Tag:</span>
            {allTags.map(t => (
              <button
                key={t}
                onClick={() => setTagFilter(tagFilter === t ? null : t)}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
                  tagFilter === t
                    ? "bg-indigo-600/30 text-indigo-300 border border-indigo-500/40"
                    : "bg-zinc-800 text-zinc-400 hover:text-zinc-100"
                )}
              >
                <Tag className="w-2.5 h-2.5" />{t}
              </button>
            ))}
          </div>
        )}

        {(() => {
          const shown = CAPABILITY_TAXONOMY.filter(c =>
            models.some(m => (m.capabilities ?? []).includes(c)),
          );
          if (!shown.length) return null;
          return (
            <div className="flex gap-1 flex-wrap">
              <span className="text-xs text-zinc-500 self-center mr-1">Cap:</span>
              {shown.map(c => (
                <button
                  key={c}
                  onClick={() => setCapFilter(capFilter === c ? null : c)}
                  className={cn(
                    "px-2 py-1 rounded text-[10px] font-medium uppercase tracking-wide transition-colors",
                    capFilter === c
                      ? "bg-emerald-600/30 text-emerald-200 border border-emerald-500/40"
                      : "bg-zinc-800 text-zinc-400 hover:text-zinc-100",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          );
        })()}

        <button
          onClick={() => setGroupByFamily(v => !v)}
          className={cn(
            "px-2 py-1 rounded text-xs font-medium transition-colors ml-auto",
            groupByFamily
              ? "bg-indigo-600/30 text-indigo-200 border border-indigo-500/40"
              : "bg-zinc-800 text-zinc-400 hover:text-zinc-100",
          )}
          title="Group cards by model family (Qwen3-Coder-Next, Qwen3.5-27B, …)"
        >
          Group
        </button>
        <div className="flex gap-1">
          <span className="text-xs text-zinc-500 self-center mr-1">Sort:</span>
          {(["name", "size", "tps"] as SortKey[]).map((k) => {
            const active = sortKey === k;
            return (
              <button
                key={k}
                onClick={() => {
                  if (active) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                  else {
                    setSortKey(k);
                    setSortDir(k === "name" ? "asc" : "desc");
                  }
                }}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors flex items-center gap-1",
                  active ? "bg-zinc-700 text-zinc-100" : "bg-zinc-800 text-zinc-500 hover:text-zinc-100",
                )}
              >
                {k === "tps" ? "Avg tok/s" : k}
                {active && (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid */}
      {loading && models.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stagger-children">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-40 rounded-2xl skeleton" />
          ))}
        </div>
      ) : (() => {
        const renderCard = (m: ModelEntry) => (
          <ModelCard
            key={m.id}
            model={m}
            alias={getAlias(m.id)}
            isActive={m.id === activeModelId && loadingModelId === null}
            isLoading={m.id === loadingModelId}
            loadStage={loadStage}
            isFavorite={isFavorite(m.id)}
            tags={modelNotes[m.id]?.tags ?? []}
            onLoad={() => loadModel(m.id)}
            onCancelLoad={cancelLoad}
            onStop={stopModel}
            onToggleFavorite={() => toggleFavorite(m.id)}
            onToggleHidden={() => {
              api.models.setHidden(m.id, !m.hidden).then(() => fetchModels()).catch(() => {});
            }}
            onDelete={() => {
              const label = m.name;
              if (!confirm(`Delete "${label}" from disk?\n\nThis permanently removes the files at:\n${m.path}\n\nThis cannot be undone.`)) return;
              api.models.deleteFromDisk(m.id)
                .then(() => { toast(`Deleted ${label}`, "success"); fetchModels(); })
                .catch((e: Error) => toast(`Delete failed: ${e.message}`, "error"));
            }}
            onSetAlias={(alias) => alias ? setAlias(m.id, alias) : clearAlias(m.id)}
            onOpenParams={() => setParamsModelId(m.id)}
            onOpenNotes={() => setNotesModelId(m.id)}
            downloadProgress={activeDownloads[m.id]}
          />
        );
        const pinnedId = loadingModelId ?? activeModelId;
        const pinned = pinnedId ? filtered.find((m) => m.id === pinnedId) : undefined;
        const rest = pinned ? filtered.filter((m) => m.id !== pinned.id) : filtered;
        return (
          <>
            {pinned && (
              <section className="mb-6">
                <div className="flex items-center gap-2 mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  <span className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    loadingModelId ? "bg-indigo-400 animate-pulse" : "bg-emerald-400 animate-pulse",
                  )} />
                  {loadingModelId ? "Loading" : "Loaded"}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {renderCard(pinned)}
                </div>
              </section>
            )}
            {pinned && rest.length > 0 && (
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                Library <span className="text-zinc-600 font-normal normal-case tracking-normal">· {rest.length}</span>
              </div>
            )}
            {groupByFamily ? (() => {
              // Bucket by family preserving the current sort order within groups.
              const groups = new Map<string, ModelEntry[]>();
              for (const m of rest) {
                const f = familyOf(m.name);
                const arr = groups.get(f) ?? [];
                arr.push(m);
                groups.set(f, arr);
              }
              return (
                <div className="space-y-6">
                  {[...groups.entries()].map(([family, items]) => (
                    <section key={family}>
                      <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 mb-2 flex items-center gap-2">
                        <span>{family}</span>
                        <span className="text-zinc-700">· {items.length}</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {items.map(renderCard)}
                      </div>
                    </section>
                  ))}
                </div>
              );
            })() : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stagger-children">
                {rest.map(renderCard)}
                {filtered.length === 0 && (
                  <div className="col-span-3 text-center text-zinc-500 py-16">
                    {effectiveFavoritesOnly ? "No favorites match — star a model or turn off the filter." : "No models match your filters."}
                  </div>
                )}
              </div>
            )}
          </>
        );
      })()}

      {/* Per-model params dialog */}
      {paramsModel && (
        <ModelParamsDialog
          model={paramsModel}
          onClose={() => setParamsModelId(null)}
        />
      )}

      {/* Global defaults dialog */}
      {showGlobalParams && (
        <GlobalParamsDialog onClose={() => setShowGlobalParams(false)} />
      )}

      {/* Notes dialog */}
      {notesModelId && (() => {
        const m = models.find(m => m.id === notesModelId);
        return m ? (
          <ModelNotesDialog
            model={m}
            onClose={() => setNotesModelId(null)}
            onSaved={(notes) => {
              setModelNotes(prev => ({ ...prev, [m.id]: notes }));
              api.tags.list().then(setAllTags).catch(() => {});
            }}
          />
        ) : null;
      })()}
    </div>
  );
}

// ── Model card ────────────────────────────────────────────────────────────────

function ModelCard({
  model, alias, isActive, isLoading, loadStage, isFavorite, tags, onLoad, onCancelLoad, onStop, onToggleFavorite, onToggleHidden, onDelete, onSetAlias, onOpenParams, onOpenNotes, downloadProgress,
}: {
  model: ModelEntry;
  alias?: string;
  isActive: boolean;
  isLoading: boolean;
  loadStage: string;
  isFavorite: boolean;
  tags: string[];
  onLoad: () => void;
  onCancelLoad: () => void;
  onStop: () => void;
  onToggleFavorite: () => void;
  onToggleHidden: () => void;
  onDelete: () => void;
  onSetAlias: (alias: string) => void;
  onOpenParams: () => void;
  onOpenNotes: () => void;
  downloadProgress?: { progress: number; message: string };
}) {
  const [editingAlias, setEditingAlias] = useState(false);
  const [aliasInput, setAliasInput] = useState(alias ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setAliasInput(alias ?? ""); }, [alias]);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setAliasInput(alias ?? "");
    setEditingAlias(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commitEdit = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    onSetAlias(aliasInput.trim());
    setEditingAlias(false);
  };

  const cancelEdit = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setAliasInput(alias ?? "");
    setEditingAlias(false);
  };

  return (
    <Card
      className={cn(
        "transition-all duration-200 group relative overflow-hidden h-full flex flex-col",
        isActive
          ? "border-emerald-500/30 bg-emerald-950/10 cursor-default glow-emerald"
          : "hover:border-white/[0.12] hover:bg-zinc-900/70 cursor-pointer hover-lift",
        isFavorite && !isActive && "border-amber-500/15",
        isLoading && "border-indigo-500/30 bg-indigo-950/5",
        model.deprecated && !isActive && "opacity-60 grayscale-[0.4]",
      )}
      onClick={!isActive && !isLoading && !editingAlias && !downloadProgress ? onLoad : undefined}
    >
      {/* Deprecation banner */}
      {model.deprecated && (
        <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-amber-300 bg-amber-950/30 border-b border-amber-500/20 flex items-center gap-1.5">
          <span>Deprecated</span>
          {model.replacement_id && (
            <span className="text-zinc-400 font-normal normal-case">
              — use <span className="font-mono text-amber-200">{model.replacement_id.replace(/^mlx:/, "")}</span>
            </span>
          )}
        </div>
      )}
      {/* Loading progress bar */}
      {isLoading && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-zinc-800 overflow-hidden">
          <div className="h-full bg-indigo-500 animate-pulse" style={{ width: "60%" }} />
        </div>
      )}
      <CardContent className="p-3 flex flex-col gap-2 flex-1">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {editingAlias ? (
              // Editor REPLACES the alias + chips block so the header height
              // stays stable and nothing overlaps.
              <div className="flex items-center gap-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                <input
                  ref={inputRef}
                  value={aliasInput}
                  onChange={(e) => setAliasInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") cancelEdit();
                  }}
                  placeholder="Add alias…"
                  className="flex-1 min-w-0 text-sm font-semibold bg-zinc-950 border border-indigo-500/60 rounded-md text-zinc-100 placeholder:text-zinc-600 focus:outline-none px-2 py-1"
                />
                <button onClick={commitEdit} className="text-green-400 hover:text-green-300 p-0.5 shrink-0" title="Save (↵)"><Check className="w-3.5 h-3.5" /></button>
                <button onClick={cancelEdit} className="text-zinc-500 hover:text-zinc-300 p-0.5 shrink-0" title="Cancel (esc)"><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <>
                {alias && (
                  <div className="flex items-center gap-1 group/alias mb-1 min-w-0">
                    <Tooltip label={`${alias} — ${model.name}`} className="min-w-0 flex-1">
                      <span className="text-base font-semibold text-zinc-100 truncate block">{alias}</span>
                    </Tooltip>
                    <button
                      onClick={startEdit}
                      className="opacity-0 group-hover/alias:opacity-100 text-zinc-600 hover:text-zinc-300 p-0.5 transition-opacity"
                      title="Edit alias"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  </div>
                )}
                <ModelChips model={model} showEditAlias={!alias} onEditAlias={startEdit} />
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {downloadProgress && (
              <span className="flex items-center gap-1 text-xs text-amber-400">
                <Loader2 className="w-3 h-3 animate-spin" />
                {Math.round((downloadProgress.progress ?? 0) * 100)}%
              </span>
            )}
            <EngineBadge model={model} />
            {model.node && model.node !== "local" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-cyan-500/40 text-cyan-400 bg-cyan-900/20 font-medium">
                @{model.node}
              </span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onOpenNotes(); }}
              className="p-0.5 rounded text-zinc-600 hover:text-zinc-300 transition-colors opacity-0 group-hover:opacity-100"
              title="Notes & tags"
            >
              <StickyNote className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onOpenParams(); }}
              className="p-0.5 rounded text-zinc-600 hover:text-zinc-300 transition-colors opacity-0 group-hover:opacity-100"
              title="Model parameters"
            >
              <Settings2 className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
              className={cn(
                "p-0.5 rounded transition-colors",
                isFavorite
                  ? "text-amber-400 hover:text-amber-300"
                  : "text-zinc-600 hover:text-amber-400"
              )}
              title={isFavorite ? "Remove from favorites" : "Add to favorites"}
            >
              <Star className={cn("w-4 h-4", isFavorite && "fill-amber-400")} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleHidden(); }}
              className={cn(
                "p-0.5 rounded transition-colors opacity-0 group-hover:opacity-100",
                model.hidden
                  ? "text-zinc-400 hover:text-zinc-200 opacity-100"
                  : "text-zinc-600 hover:text-zinc-400"
              )}
              title={model.hidden ? "Unhide model" : "Hide model"}
            >
              {model.hidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
            {(model.kind === "mlx" || model.kind === "gguf" || model.kind === "vllm") && model.node === "local" && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="p-0.5 rounded text-zinc-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                title="Delete from disk"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <Stat label="Size" value={formatBytes(model.size_bytes)} />
          <Stat label="Context" value={formatContext(model.context_window)} />
          <Stat label="Avg tok/s" value={formatTps(model.avg_tps)} />
        </div>

        {(model.capabilities?.length || tags.length) ? (
          <div className="flex flex-wrap gap-1">
            {(model.capabilities ?? []).map(c => (
              <span
                key={`c-${c}`}
                className="text-[10px] font-medium uppercase tracking-wide bg-emerald-900/25 text-emerald-300 border border-emerald-500/25 px-1.5 py-0.5 rounded"
              >
                {c}
              </span>
            ))}
            {tags.map(t => (
              <span key={`t-${t}`} className="text-xs bg-indigo-900/30 text-indigo-300 border border-indigo-500/20 px-1.5 py-0.5 rounded">
                {t}
              </span>
            ))}
          </div>
        ) : null}

        {/* Loading bar */}
        {isLoading && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-indigo-400 truncate">{loadStage || "Loading…"}</div>
              <button
                onClick={(e) => { e.stopPropagation(); onCancelLoad(); }}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-900/30 text-red-400 border border-red-500/30 hover:bg-red-900/50 hover:text-red-300 transition-colors shrink-0"
                title="Cancel loading"
              >
                <Square className="w-2.5 h-2.5 fill-current" />
                Cancel
              </button>
            </div>
            <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full animate-pulse w-3/4" />
            </div>
          </div>
        )}

        {/* Action buttons */}
        {isActive && (
          <div className="grid grid-cols-2 gap-2 mt-1">
            <Link href={`/benchmark2?models=${encodeURIComponent(model.id)}`} onClick={(e) => e.stopPropagation()}>
              <Button variant="secondary" size="sm" className="w-full">
                <BarChart2 className="w-3 h-3" />
                Benchmark
              </Button>
            </Link>
            <Link href="/chat" onClick={(e) => e.stopPropagation()}>
              <Button variant="primary" size="sm" className="w-full">
                <MessageSquare className="w-3 h-3" />
                Chat
              </Button>
            </Link>
          </div>
        )}
        {!isActive && !isLoading && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity pt-1 pointer-events-none group-hover:pointer-events-auto">
            <Button variant="primary" size="sm" className="w-full">
              <Zap className="w-3 h-3" />
              Load model
            </Button>
          </div>
        )}

        {/* Status pills + full ID pinned to the bottom so cards align regardless of
            optional middle content (tags, loading bar, hover actions). */}
        <div className="mt-auto flex flex-col gap-2">
        {(model.dflash_draft || (!model.dflash_draft && model.available_draft_repo) || (model.update_available && model.origin_repo)) && (
          <div className="flex flex-wrap items-center gap-1">
            {model.dflash_draft && (
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    await api.dflash.toggle(model.id, !model.dflash_enabled);
                    const { fetchModels } = useModelsStore.getState();
                    fetchModels();
                    toast(model.dflash_enabled ? "DFlash disabled" : "DFlash enabled — 3-4x faster generation", model.dflash_enabled ? "info" : "success");
                  } catch { toast("Failed to toggle DFlash", "error"); }
                }}
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded border font-medium flex items-center gap-0.5 transition-colors",
                  model.dflash_enabled
                    ? "border-amber-500/50 text-amber-400 bg-amber-900/30 hover:bg-amber-900/50"
                    : "border-zinc-600 text-zinc-500 bg-zinc-800/50 hover:text-amber-400 hover:border-amber-500/30",
                )}
                title={model.dflash_enabled ? "DFlash enabled — click to disable" : "Enable DFlash speculative decoding"}
              >
                <Bolt className="w-3 h-3" />
                DFlash
              </button>
            )}
            {!model.dflash_draft && model.available_draft_repo && (
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    await api.zlab.downloadDraft(model.available_draft_repo!);
                    toast(`Downloading ${model.available_draft_repo} — check Downloads`, "success");
                  } catch { toast("Failed to start draft download", "error"); }
                }}
                className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 text-amber-400/80 bg-amber-900/10 hover:bg-amber-900/30 hover:border-amber-500/50 font-medium flex items-center gap-0.5 transition-colors"
                title={`z-lab draft available: ${model.available_draft_repo} — click to download`}
              >
                <Bolt className="w-3 h-3" />
                Draft available
              </button>
            )}
            {model.update_available && model.origin_repo && (
              <a
                href={`https://huggingface.co/${model.origin_repo}`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-[10px] px-1.5 py-0.5 rounded border border-sky-500/40 text-sky-300 bg-sky-900/20 hover:bg-sky-900/40 font-medium flex items-center gap-0.5 transition-colors"
                title={`Upstream ${model.origin_repo} updated ${model.upstream_last_modified ?? ""}`}
              >
                New version
              </a>
            )}
          </div>
        )}

        {/* Full model ID — small mono, line of truth (hover for wrap).
            Unload button (active-only) sits on the right side of this row. */}
        <div className="flex items-center gap-2 pt-1 border-t border-white/[0.03]">
          <Tooltip label={model.name} className="min-w-0 flex-1">
            <div className="text-xs font-mono text-zinc-500 truncate select-text">
              {model.name}
            </div>
          </Tooltip>
          {isActive && (
            <button
              onClick={(e) => { e.stopPropagation(); onStop(); }}
              className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-red-900/30 text-red-400 border border-red-500/30 hover:bg-red-900/50 hover:text-red-300 transition-colors"
              title="Unload model"
            >
              <Square className="w-2.5 h-2.5 fill-current" />
              Unload
            </button>
          )}
        </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Chip row rendered in the upper-left: parsed family / params / variant / quant.
// Two-part badge: file format (MLX / GGUF / vLLM) + serving engine
// (omlx / mlx_lm / llama.cpp / ollama). Makes "why is Qwen 2.5 OLLAMA vs GGUF"
// legible at a glance — the underlying `kind` field is unchanged, this is
// purely a display relabel.
function EngineBadge({ model }: { model: ModelEntry }) {
  // Map kind → (format label, default engine, colour hint).
  const config: Record<string, { format: string; engine: string; tone: string }> = {
    mlx:        { format: "MLX",  engine: model.preferred_engine ?? "omlx",  tone: "border-indigo-500/30 bg-indigo-900/20 text-indigo-300" },
    gguf:       { format: "GGUF", engine: "llama.cpp",                       tone: "border-emerald-500/30 bg-emerald-900/20 text-emerald-300" },
    ollama:     { format: "GGUF", engine: "ollama",                          tone: "border-amber-500/30 bg-amber-900/20 text-amber-300" },
    vllm:       { format: "vLLM", engine: "vllm",                            tone: "border-fuchsia-500/30 bg-fuchsia-900/20 text-fuchsia-300" },
    mlx_studio: { format: "MLX",  engine: "Studio",                          tone: "border-sky-500/30 bg-sky-900/20 text-sky-300" },
  };
  const c = config[model.kind] ?? { format: model.kind.toUpperCase(), engine: "?", tone: "border-white/10 bg-zinc-800 text-zinc-300" };
  return (
    <span
      className={cn("text-[10px] px-1.5 py-0.5 rounded border font-mono font-medium inline-flex items-center gap-1", c.tone)}
      title={`File format: ${c.format}, served by ${c.engine}`}
    >
      <span>{c.format}</span>
      <span className="opacity-50">·</span>
      <span>{c.engine}</span>
    </span>
  );
}

function ModelChips({ model, showEditAlias, onEditAlias }: {
  model: ModelEntry;
  showEditAlias: boolean;
  onEditAlias: (e: React.MouseEvent) => void;
}) {
  const parsed = parseModelName(model.name, model.quant);
  const chips: Array<{ label: string; tone: "family" | "params" | "variant" | "quant" }> = [];
  if (parsed.family)  chips.push({ label: parsed.family,  tone: "family" });
  if (parsed.params)  chips.push({ label: parsed.params,  tone: "params" });
  if (parsed.variant) chips.push({ label: parsed.variant, tone: "variant" });
  if (parsed.quant)   chips.push({ label: parsed.quant,   tone: "quant" });

  // No chips parsed? Fall back to showing a truncated model name so the card isn't empty.
  if (chips.length === 0) {
    return (
      <Tooltip label={model.name} className="min-w-0 flex-1">
        <span className="text-sm font-semibold text-zinc-100 truncate block">{model.name}</span>
      </Tooltip>
    );
  }

  const toneClass = {
    family:  "bg-indigo-500/15 text-indigo-200 border-indigo-500/25",
    params:  "bg-zinc-800/80 text-zinc-200 border-white/10",
    variant: "bg-fuchsia-500/10 text-fuchsia-200 border-fuchsia-500/25",
    quant:   "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
  } as const;

  return (
    <div className="flex content-start items-center flex-wrap gap-1 min-w-0 min-h-9">
      {chips.map((c, i) => (
        <span
          key={i}
          className={cn(
            "px-1.5 py-0.5 rounded text-[11px] font-mono font-medium border leading-tight",
            toneClass[c.tone],
            c.tone === "family" && "text-xs",
          )}
        >
          {c.label}
        </span>
      ))}
      {showEditAlias && (
        <button
          onClick={onEditAlias}
          className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-zinc-300 p-0.5 transition-opacity ml-0.5"
          title="Add alias"
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ── Params dialog ─────────────────────────────────────────────────────────────

const KV_CACHE_TYPES = ["f16", "q8_0", "q4_0", "q4_1", "q5_0", "q5_1", "tq1_0", "tq2_0"];

const PARAM_DEFAULTS: Record<string, { label: string; type: "number" | "bool" | "text" | "select"; options?: string[]; step?: number; min?: number; max?: number; placeholder?: string; kinds?: string[]; tip?: string }> = {
  temperature:        { label: "Temperature",         type: "number", step: 0.05, min: 0,   max: 2,   placeholder: "—" },
  max_tokens:         { label: "Max tokens",          type: "number", step: 128,  min: 1,             placeholder: "—" },
  context_window:     { label: "Context window",      type: "number", step: 1024, min: 512,           placeholder: "—" },
  top_k:              { label: "Top-K",               type: "number", step: 1,    min: 0,   max: 200, placeholder: "—",         tip: "Qwen3-Coder: 40 · others: 20" },
  top_p:              { label: "Top-P",               type: "number", step: 0.05, min: 0,   max: 1,   placeholder: "—",         tip: "Qwen3 think: 0.95 · no-think: 0.8" },
  min_p:              { label: "Min-P",               type: "number", step: 0.01, min: 0,   max: 1,   placeholder: "—" },
  repetition_penalty: { label: "Repetition penalty",  type: "number", step: 0.05, min: 1,   max: 2,   placeholder: "—",         tip: "Qwen3-Coder: 1.05 · others: 1.0" },
  presence_penalty:   { label: "Presence penalty",    type: "number", step: 0.1,  min: -2,  max: 2,   placeholder: "—",         tip: "Qwen3.5 no-think: 1.5 · think: 0.0" },
  enable_thinking:    { label: "Enable thinking",     type: "bool",                                                             tip: "Pass chat_template_kwargs={enable_thinking} to skip reasoning output on Qwen3.5/3.6" },
  preserve_thinking:  { label: "Preserve thinking",   type: "bool",                                                             tip: "Keep prior-turn <think> blocks in multi-turn prompts (Qwen3.5/3.6)" },
  cache_limit_gb:     { label: "Cache limit (GB)",    type: "number", step: 1,    min: 1,             placeholder: "unlimited",  kinds: ["mlx"] },
  draft_model:        { label: "Draft model path",    type: "text",                                   placeholder: "e.g. /path/to/mlx/Qwen3-0.6B", kinds: ["mlx"], tip: "Small model for speculative decoding — must match tokenizer of main model" },
  num_draft_tokens:   { label: "Draft tokens",        type: "number", step: 1,    min: 1,             placeholder: "off",        kinds: ["mlx"], tip: "Number of tokens the draft model generates per step (5–10 recommended)" },
  batch_size:         { label: "Batch size (-b)",     type: "number", step: 64,   min: 1,             placeholder: "—",          kinds: ["gguf"] },
  ubatch_size:        { label: "μBatch size (-ub)",   type: "number", step: 64,   min: 1,             placeholder: "—",          kinds: ["gguf"] },
  threads:            { label: "Threads",             type: "number", step: 1,    min: 1,             placeholder: "—",          kinds: ["gguf"] },
  flash_attn:         { label: "Flash attention",     type: "bool",                                                              kinds: ["gguf"] },
  cache_type_k:       { label: "KV cache type K",     type: "select", options: KV_CACHE_TYPES,        placeholder: "f16 (default)", kinds: ["gguf"], tip: "Key cache quant" },
  cache_type_v:       { label: "KV cache type V",     type: "select", options: KV_CACHE_TYPES,        placeholder: "f16 (default)", kinds: ["gguf"], tip: "Value cache quant" },
  ttl_minutes:        { label: "Auto-unload (min)",    type: "number", step: 5,    min: 0,             placeholder: "never",     tip: "Unload after N idle minutes" },
  extra_args:         { label: "Extra args",          type: "text",                                   placeholder: "--flag value --other", tip: "Appended to the server command" },
};

// Sensible global defaults pre-populated when none have been saved yet
const SUGGESTED_DEFAULTS: ModelParams = {
  temperature: 0.7,
  max_tokens: 2048,
  top_k: 20,
  top_p: 0.8,
  min_p: 0.0,
  repetition_penalty: 1.0,
  presence_penalty: 0.0,
};

function ModelParamsDialog({ model, onClose }: { model: ModelEntry; onClose: () => void }) {
  const [params, setParams] = useState<ModelParams>({});
  const [defaults, setDefaults] = useState<ModelParams>({});
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.models.getParams(model.id).catch(() => ({})),
      api.params.getDefaults().catch(() => ({})),
    ]).then(([p, d]) => {
      setParams(p);
      setDefaults(Object.keys(d).length === 0 ? SUGGESTED_DEFAULTS : d);
      setLoading(false);
    });
  }, [model.id]);

  const set = (key: string, val: string | number | boolean | undefined) => {
    setParams((p) => {
      const next = { ...p };
      if (val === "" || val === undefined) delete (next as Record<string, unknown>)[key];
      else (next as Record<string, unknown>)[key] = val;
      return next;
    });
    setSaved(false);
  };

  const save = useCallback(async () => {
    await api.models.setParams(model.id, params);
    setSaved(true);
  }, [model.id, params]);

  const reset = useCallback(async () => {
    await api.models.resetParams(model.id);
    setParams({});
    setSaved(false);
  }, [model.id]);

  const visibleKeys = Object.entries(PARAM_DEFAULTS).filter(([, meta]) =>
    !meta.kinds || meta.kinds.includes(model.kind)
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
          <div>
            <div className="text-sm font-semibold text-zinc-100">Model Parameters</div>
            <div title={model.name} className="text-xs text-zinc-500 truncate max-w-xs mt-0.5">{model.name}</div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 p-1 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {loading ? (
            <div className="text-zinc-500 text-sm text-center py-8">Loading…</div>
          ) : (
            <div className="space-y-4">
              {/* Group sections */}
              <Section title="Inference">
                {visibleKeys.filter(([k]) => ["temperature","max_tokens","context_window","top_k","top_p","min_p","repetition_penalty","presence_penalty","enable_thinking","preserve_thinking"].includes(k)).map(([key, meta]) => (
                  <ParamRow key={key} paramKey={key} meta={meta} params={params} defaults={defaults} set={set} />
                ))}
              </Section>

              {model.kind === "mlx" && (
                <Section title="MLX">
                  {visibleKeys.filter(([k]) => ["cache_limit_gb","draft_model","num_draft_tokens"].includes(k)).map(([key, meta]) => (
                    <ParamRow key={key} paramKey={key} meta={meta} params={params} defaults={defaults} set={set} />
                  ))}
                </Section>
              )}

              {model.kind === "gguf" && (
                <Section title="llama-server">
                  {visibleKeys.filter(([k]) => ["batch_size","ubatch_size","threads","flash_attn","cache_type_k","cache_type_v"].includes(k)).map(([key, meta]) => (
                    <ParamRow key={key} paramKey={key} meta={meta} params={params} defaults={defaults} set={set} />
                  ))}
                </Section>
              )}

              <Section title="Advanced">
                <ParamRow paramKey="ttl_minutes" meta={PARAM_DEFAULTS.ttl_minutes} params={params} defaults={defaults} set={set} />
                <ParamRow paramKey="extra_args" meta={PARAM_DEFAULTS.extra_args} params={params} defaults={defaults} set={set} />
              </Section>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/8">
          <button
            onClick={reset}
            className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
          >
            Reset to defaults
          </button>
          <div className="flex items-center gap-3">
            {saved && <span className="text-xs text-green-400">Saved</span>}
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={save}>Save</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ParamRow({
  paramKey, meta, params, defaults = {}, set,
}: {
  paramKey: string;
  meta: typeof PARAM_DEFAULTS[string];
  params: ModelParams;
  defaults?: ModelParams;
  set: (key: string, val: string | number | boolean | undefined) => void;
}) {
  const val = (params as Record<string, unknown>)[paramKey];
  const defaultVal = (defaults as Record<string, unknown>)[paramKey];
  const effectivePlaceholder = defaultVal !== undefined ? String(defaultVal) : (meta.placeholder ?? "—");

  if (meta.type === "select") {
    return (
      <div className="flex items-center gap-3">
        <label className="text-sm text-zinc-300 w-40 shrink-0">{meta.label}</label>
        <div className="flex-1 flex items-center gap-2">
          <select
            value={(val as string) ?? ""}
            onChange={(e) => set(paramKey, e.target.value || undefined)}
            className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 font-mono"
          >
            <option value="">{effectivePlaceholder}</option>
            {meta.options?.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          {meta.tip && <span className="text-xs text-zinc-600 shrink-0">{meta.tip}</span>}
        </div>
      </div>
    );
  }

  if (meta.type === "bool") {
    return (
      <label className="flex items-center justify-between py-1">
        <span className="text-sm text-zinc-300">{meta.label}</span>
        <input
          type="checkbox"
          checked={!!val}
          onChange={(e) => set(paramKey, e.target.checked || undefined)}
          className="w-4 h-4 accent-indigo-500"
        />
      </label>
    );
  }

  if (meta.type === "text") {
    const strVal = Array.isArray(val) ? (val as string[]).join(" ") : (val as string) ?? "";
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-sm text-zinc-300">{meta.label}</label>
          {meta.tip && <span className="text-xs text-zinc-600">{meta.tip}</span>}
        </div>
        <input
          type="text"
          value={strVal}
          onChange={(e) => {
            const s = e.target.value.trim();
            set(paramKey, s ? s : undefined);
          }}
          placeholder={effectivePlaceholder}
          className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 font-mono"
        />
      </div>
    );
  }

  // number
  const numVal = val !== undefined ? String(val) : "";
  return (
    <div className="flex items-center gap-3">
      <label className="text-sm text-zinc-300 w-40 shrink-0">{meta.label}</label>
      <div className="flex-1 flex items-center gap-2">
        <input
          type="number"
          value={numVal}
          step={meta.step}
          min={meta.min}
          max={meta.max}
          onChange={(e) => {
            const v = e.target.value;
            set(paramKey, v === "" ? undefined : Number(v));
          }}
          placeholder={effectivePlaceholder}
          className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 font-mono"
        />
        {meta.tip && <span className="text-xs text-zinc-600 shrink-0">{meta.tip}</span>}
      </div>
    </div>
  );
}

// ── Model notes dialog ────────────────────────────────────────────────────────

function ModelNotesDialog({ model, onClose, onSaved }: {
  model: ModelEntry;
  onClose: () => void;
  onSaved: (data: { notes: string; tags: string[] }) => void;
}) {
  const [notes, setNotes] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [preferredEngine, setPreferredEngine] = useState<string | null>(model.preferred_engine ?? null);
  const [originRepo, setOriginRepo] = useState<string>(model.origin_repo ?? "");
  const [capabilities, setCapabilities] = useState<string[]>(model.capabilities ?? []);
  const [deprecated, setDeprecated] = useState<boolean>(!!model.deprecated);
  const [replacementId, setReplacementId] = useState<string>(model.replacement_id ?? "");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const engines = model.available_engines ?? [];
  const showEnginePicker = engines.length > 1;

  useEffect(() => {
    api.models.getNotes(model.id)
      .then((d: { notes: string; tags: string[]; preferred_engine?: string | null; capabilities?: string[]; deprecated?: boolean; replacement_id?: string | null }) => {
        setNotes(d.notes);
        setTagsInput(d.tags.join(", "));
        if (d.preferred_engine !== undefined) setPreferredEngine(d.preferred_engine ?? null);
        if (d.capabilities) setCapabilities(d.capabilities);
        if (typeof d.deprecated === "boolean") setDeprecated(d.deprecated);
        if (d.replacement_id !== undefined) setReplacementId(d.replacement_id ?? "");
        setLoading(false);
      })
      .catch(() => setLoading(false));
    api.hfUpdates.getOriginRepo(model.id)
      .then((s) => { if (s.origin_repo) setOriginRepo(s.origin_repo); })
      .catch(() => {});
  }, [model.id]);

  const save = useCallback(async () => {
    const tags = tagsInput.split(",").map(t => t.trim()).filter(Boolean);
    const result = await api.models.setNotes(
      model.id, notes, tags, capabilities,
      { deprecated, replacement_id: deprecated ? (replacementId.trim() || null) : null },
    );
    if (showEnginePicker) {
      await api.models.setPreferredEngine(model.id, preferredEngine);
    }
    const trimmed = originRepo.trim();
    if (trimmed !== (model.origin_repo ?? "")) {
      await api.hfUpdates.setOriginRepo(model.id, trimmed || null);
    }
    onSaved(result);
    setSaved(true);
  }, [model.id, notes, tagsInput, capabilities, deprecated, replacementId, onSaved, preferredEngine, showEnginePicker, originRepo, model.origin_repo]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
          <div>
            <div className="text-sm font-semibold text-zinc-100">Notes & Tags</div>
            <div title={model.name} className="text-xs text-zinc-500 truncate max-w-xs mt-0.5">{model.name}</div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 p-1 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {loading ? (
            <div className="text-zinc-500 text-sm text-center py-4">Loading…</div>
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-400">Capabilities</label>
                <div className="flex flex-wrap gap-1.5">
                  {CAPABILITY_TAXONOMY.map(cap => {
                    const on = capabilities.includes(cap);
                    return (
                      <button
                        type="button"
                        key={cap}
                        onClick={() => {
                          setCapabilities(prev => on ? prev.filter(c => c !== cap) : [...prev, cap]);
                          setSaved(false);
                        }}
                        className={cn(
                          "px-2 py-0.5 rounded text-[11px] font-medium border transition",
                          on
                            ? "bg-indigo-500/20 border-indigo-400/40 text-indigo-200"
                            : "bg-zinc-800/50 border-white/8 text-zinc-500 hover:text-zinc-300",
                        )}
                      >
                        {cap}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-400">Tags (comma-separated)</label>
                <input
                  type="text"
                  value={tagsInput}
                  onChange={e => { setTagsInput(e.target.value); setSaved(false); }}
                  placeholder="coding, fast, favorite-quant…"
                  className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-400">Notes</label>
                <textarea
                  value={notes}
                  onChange={e => { setNotes(e.target.value); setSaved(false); }}
                  placeholder="Any notes about this model…"
                  rows={5}
                  className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-400">Origin HF repo</label>
                <input
                  type="text"
                  value={originRepo}
                  onChange={e => { setOriginRepo(e.target.value); setSaved(false); }}
                  placeholder="e.g. mlx-community/Qwen3-4B-Instruct-2507-MLX-4bit"
                  className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 font-mono text-[11px]"
                />
                <div className="text-[11px] text-zinc-500">Used to detect upstream updates. Auto-filled for models downloaded through Crucible.</div>
              </div>
              <div className="space-y-1.5 rounded-lg border border-white/[0.06] bg-zinc-800/30 p-3">
                <label className="flex items-center gap-2 text-xs font-medium text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deprecated}
                    onChange={(e) => { setDeprecated(e.target.checked); setSaved(false); }}
                    className="accent-amber-500"
                  />
                  Mark deprecated
                </label>
                {deprecated && (
                  <div className="space-y-1">
                    <label className="text-[11px] text-zinc-500">Recommended replacement (optional)</label>
                    <input
                      type="text"
                      value={replacementId}
                      onChange={(e) => { setReplacementId(e.target.value); setSaved(false); }}
                      placeholder="mlx:Qwen3-Coder-Next-MLX-6bit"
                      className="w-full bg-zinc-800 border border-white/10 rounded px-2 py-1 text-[11px] text-zinc-100 font-mono"
                    />
                    <div className="text-[10px] text-zinc-600">Shown on the card with the "Deprecated" banner.</div>
                  </div>
                )}
              </div>
              {showEnginePicker && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-400">Preferred engine</label>
                  <select
                    value={preferredEngine ?? ""}
                    onChange={e => { setPreferredEngine(e.target.value || null); setSaved(false); }}
                    className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">Default ({engines[0]})</option>
                    {engines.map(e => (
                      <option key={e} value={e}>{e}</option>
                    ))}
                  </select>
                  <div className="text-[11px] text-zinc-500">Overridable per-load from the Load button.</div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/8">
          {saved && <span className="text-xs text-green-400 mr-auto">Saved</span>}
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={save}>Save</Button>
        </div>
      </div>
    </div>
  );
}

// ── Global defaults dialog ────────────────────────────────────────────────────

function GlobalParamsDialog({ onClose }: { onClose: () => void }) {
  const [params, setParams] = useState<ModelParams>({});
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.params.getDefaults()
      .then((p) => { setParams(Object.keys(p).length === 0 ? SUGGESTED_DEFAULTS : p); setLoading(false); })
      .catch(() => { setParams(SUGGESTED_DEFAULTS); setLoading(false); });
  }, []);

  const set = (key: string, val: string | number | boolean | undefined) => {
    setParams((p) => {
      const next = { ...p };
      if (val === "" || val === undefined) delete (next as Record<string, unknown>)[key];
      else (next as Record<string, unknown>)[key] = val;
      return next;
    });
    setSaved(false);
  };

  const save = useCallback(async () => {
    await api.params.setDefaults(params);
    setSaved(true);
  }, [params]);

  const reset = useCallback(async () => {
    await api.params.resetDefaults();
    setParams({});
    setSaved(false);
  }, []);

  const inferenceKeys = ["temperature","max_tokens","context_window","top_k","top_p","min_p","repetition_penalty","presence_penalty","enable_thinking","preserve_thinking"];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
          <div>
            <div className="text-sm font-semibold text-zinc-100">Global Default Parameters</div>
            <div className="text-xs text-zinc-500 mt-0.5">Applied to all models unless overridden per-model</div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 p-1 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4">
          {loading ? (
            <div className="text-zinc-500 text-sm text-center py-8">Loading…</div>
          ) : (
            <div className="space-y-4">
              <Section title="Inference">
                {inferenceKeys.map((key) => (
                  <ParamRow key={key} paramKey={key} meta={PARAM_DEFAULTS[key]} params={params} set={set} />
                ))}
              </Section>
              <Section title="Advanced">
                <ParamRow paramKey="ttl_minutes" meta={PARAM_DEFAULTS.ttl_minutes} params={params} set={set} />
                <ParamRow paramKey="extra_args" meta={PARAM_DEFAULTS.extra_args} params={params} set={set} />
              </Section>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-white/8">
          <button onClick={reset} className="text-xs text-zinc-500 hover:text-red-400 transition-colors">
            Clear all defaults
          </button>
          <div className="flex items-center gap-3">
            {saved && <span className="text-xs text-green-400">Saved</span>}
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={save}>Save</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-zinc-500">{label}</div>
      <div className="text-zinc-200 font-mono">{value}</div>
    </div>
  );
}
