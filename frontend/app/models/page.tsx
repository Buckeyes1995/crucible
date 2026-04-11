"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useModelsStore } from "@/lib/stores/models";
import { useFavoritesStore } from "@/lib/stores/favorites";
import { useAliasesStore } from "@/lib/stores/aliases";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatBytes, formatContext, formatTps, cn } from "@/lib/utils";
import { RefreshCw, Square, Zap, BarChart2, Star, Pencil, Check, X, Settings2, StickyNote, Tag } from "lucide-react";
import Link from "next/link";
import { api, type ModelEntry, type ModelParams } from "@/lib/api";
import { ModelTpsChart } from "@/components/ModelTpsChart";

type SortKey = "name" | "size" | "tps";

export default function ModelsPage() {
  const {
    models, loading, activeModelId, loadingModelId, loadStage, error,
    fetchModels, refreshModels, loadModel, stopModel, syncStatus,
  } = useModelsStore();
  const { favorites, favoritesOnly, toggle: toggleFavorite, isFavorite, setFavoritesOnly } = useFavoritesStore();
  const { getAlias, setAlias, clearAlias } = useAliasesStore();

  const [search, setSearch] = useState("");
  const [filterKind, setFilterKind] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [paramsModelId, setParamsModelId] = useState<string | null>(null);
  const [notesModelId, setNotesModelId] = useState<string | null>(null);
  const [showGlobalParams, setShowGlobalParams] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [modelNotes, setModelNotes] = useState<Record<string, { notes: string; tags: string[] }>>({});

  useEffect(() => { fetchModels(); }, [fetchModels]);
  useEffect(() => {
    api.tags.list().then(setAllTags).catch(() => {});
  }, []);

  useEffect(() => {
    if (loadingModelId) return;
    const id = setInterval(syncStatus, 5000);
    return () => clearInterval(id);
  }, [syncStatus, loadingModelId]);

  const effectiveFavoritesOnly = favoritesOnly && favorites.length > 0;

  const filtered = models
    .filter((m) => {
      if (effectiveFavoritesOnly && !isFavorite(m.id)) return false;
      if (filterKind !== "all" && m.kind !== filterKind) return false;
      const alias = getAlias(m.id) ?? "";
      if (search && !m.name.toLowerCase().includes(search.toLowerCase()) && !alias.toLowerCase().includes(search.toLowerCase())) return false;
      if (tagFilter) {
        const tags = modelNotes[m.id]?.tags ?? [];
        if (!tags.includes(tagFilter)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      // Active model always first
      const aActive = a.id === activeModelId ? 0 : 1;
      const bActive = b.id === activeModelId ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      // Then favorites
      const aFav = isFavorite(a.id) ? 0 : 1;
      const bFav = isFavorite(b.id) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      if (sortKey === "size") return (b.size_bytes ?? 0) - (a.size_bytes ?? 0);
      if (sortKey === "tps") return (b.avg_tps ?? 0) - (a.avg_tps ?? 0);
      return a.name.localeCompare(b.name);
    });

  const paramsModel = paramsModelId ? models.find((m) => m.id === paramsModelId) : null;

  return (
    <div className="p-6 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Models</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {models.length} models · {favorites.length} favorited
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowGlobalParams(true)}>
            <Settings2 className="w-4 h-4" />
            Defaults
          </Button>
          <Button variant="secondary" size="sm" onClick={refreshModels} disabled={loading}>
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-5 flex-wrap items-center">
        <Input
          className="w-64"
          placeholder="Search models…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-1">
          {([ ["all", "All"], ["mlx", "MLX"], ["gguf", "GGUF"], ["ollama", "Ollama"] ] as [string, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilterKind(k)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                filterKind === k
                  ? "bg-indigo-600 text-white"
                  : "bg-zinc-800 text-zinc-400 hover:text-zinc-100"
              )}
            >
              {label}
            </button>
          ))}
        </div>

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

        <div className="flex gap-1 ml-auto">
          <span className="text-xs text-zinc-500 self-center mr-1">Sort:</span>
          {(["name", "size", "tps"] as SortKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setSortKey(k)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors",
                sortKey === k
                  ? "bg-zinc-700 text-zinc-100"
                  : "bg-zinc-800 text-zinc-500 hover:text-zinc-100"
              )}
            >
              {k === "tps" ? "Avg tok/s" : k}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {loading && models.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-40 rounded-xl bg-zinc-900/60 animate-pulse border border-white/5" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((m) => (
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
              onStop={stopModel}
              onToggleFavorite={() => toggleFavorite(m.id)}
              onSetAlias={(alias) => alias ? setAlias(m.id, alias) : clearAlias(m.id)}
              onOpenParams={() => setParamsModelId(m.id)}
              onOpenNotes={() => setNotesModelId(m.id)}
            />
          ))}
          {filtered.length === 0 && (
            <div className="col-span-3 text-center text-zinc-500 py-16">
              {effectiveFavoritesOnly ? "No favorites match — star a model or turn off the filter." : "No models match your filters."}
            </div>
          )}
        </div>
      )}

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
  model, alias, isActive, isLoading, loadStage, isFavorite, tags, onLoad, onStop, onToggleFavorite, onSetAlias, onOpenParams, onOpenNotes,
}: {
  model: ModelEntry;
  alias?: string;
  isActive: boolean;
  isLoading: boolean;
  loadStage: string;
  isFavorite: boolean;
  tags: string[];
  onLoad: () => void;
  onStop: () => void;
  onToggleFavorite: () => void;
  onSetAlias: (alias: string) => void;
  onOpenParams: () => void;
  onOpenNotes: () => void;
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
        "transition-all group",
        isActive ? "border-green-500/50 bg-green-950/10 cursor-default" : "hover:border-white/20 cursor-pointer",
        isFavorite && !isActive && "border-amber-500/20"
      )}
      onClick={!isActive && !isLoading && !editingAlias ? onLoad : undefined}
    >
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {/* Alias row */}
            {editingAlias ? (
              <div className="flex items-center gap-1 mb-1" onClick={(e) => e.stopPropagation()}>
                <input
                  ref={inputRef}
                  value={aliasInput}
                  onChange={(e) => setAliasInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") cancelEdit();
                  }}
                  placeholder="Add alias…"
                  className="flex-1 text-base font-semibold bg-transparent border-b border-indigo-500 text-zinc-100 placeholder:text-zinc-600 focus:outline-none py-0.5"
                />
                <button onClick={commitEdit} className="text-green-400 hover:text-green-300 p-0.5"><Check className="w-3.5 h-3.5" /></button>
                <button onClick={cancelEdit} className="text-zinc-500 hover:text-zinc-300 p-0.5"><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : alias ? (
              <div className="flex items-center gap-1 group/alias mb-0.5">
                <span className="text-base font-semibold text-zinc-100 truncate">{alias}</span>
                <button
                  onClick={startEdit}
                  className="opacity-0 group-hover/alias:opacity-100 text-zinc-600 hover:text-zinc-300 p-0.5 transition-opacity"
                  title="Edit alias"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </div>
            ) : null}

            {/* Model name */}
            <div className="flex items-center gap-1 group/name">
              <h3 className={cn(
                "truncate font-medium",
                alias ? "text-xs text-zinc-500" : "text-sm font-semibold text-zinc-100"
              )}>
                {model.name}
              </h3>
              {!alias && !editingAlias && (
                <button
                  onClick={startEdit}
                  className="opacity-0 group-hover/name:opacity-100 text-zinc-600 hover:text-zinc-400 p-0.5 transition-opacity"
                  title="Add alias"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {isActive && (
              <>
                <span className="flex items-center gap-1 text-xs text-green-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
                  Active
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); onStop(); }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-900/30 text-red-400 border border-red-500/30 hover:bg-red-900/50 hover:text-red-300 transition-colors"
                  title="Unload model"
                >
                  <Square className="w-3 h-3 fill-current" />
                  Unload
                </button>
              </>
            )}
            <Badge variant={model.kind as "mlx" | "gguf" | "ollama"}>
              {model.kind.toUpperCase()}
            </Badge>
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
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <Stat label="Size" value={formatBytes(model.size_bytes)} />
          <Stat label="Context" value={formatContext(model.context_window)} />
          <Stat label="Avg tok/s" value={formatTps(model.avg_tps)} />
        </div>

        {model.quant && (
          <div className="text-xs text-zinc-500 font-mono">{model.quant}</div>
        )}

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map(t => (
              <span key={t} className="text-xs bg-indigo-900/30 text-indigo-300 border border-indigo-500/20 px-1.5 py-0.5 rounded">
                {t}
              </span>
            ))}
          </div>
        )}

        {/* tok/s sparkline — only shows if model has been benchmarked */}
        {model.avg_tps != null && (
          <ModelTpsChart modelId={model.id} height={48} />
        )}

        {/* Loading bar */}
        {isLoading && (
          <div className="space-y-1">
            <div className="text-xs text-indigo-400">{loadStage}</div>
            <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full animate-pulse w-3/4" />
            </div>
          </div>
        )}

        {/* Action buttons */}
        {isActive && (
          <Link href={`/benchmark/new?model=${encodeURIComponent(model.id)}`} onClick={(e) => e.stopPropagation()}>
            <Button variant="secondary" size="sm" className="w-full mt-1">
              <BarChart2 className="w-3 h-3" />
              Benchmark
            </Button>
          </Link>
        )}
        {!isActive && !isLoading && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity pt-1 pointer-events-none group-hover:pointer-events-auto">
            <Button variant="primary" size="sm" className="w-full">
              <Zap className="w-3 h-3" />
              Load model
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
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
  cache_limit_gb:     { label: "Cache limit (GB)",    type: "number", step: 1,    min: 1,             placeholder: "unlimited",  kinds: ["mlx"] },
  num_draft_tokens:   { label: "Draft tokens",        type: "number", step: 1,    min: 1,             placeholder: "off",        kinds: ["mlx"], tip: "Speculative decoding" },
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
            <div className="text-xs text-zinc-500 truncate max-w-xs mt-0.5">{model.name}</div>
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
                {visibleKeys.filter(([k]) => ["temperature","max_tokens","context_window","top_k","top_p","min_p","repetition_penalty","presence_penalty"].includes(k)).map(([key, meta]) => (
                  <ParamRow key={key} paramKey={key} meta={meta} params={params} defaults={defaults} set={set} />
                ))}
              </Section>

              {model.kind === "mlx" && (
                <Section title="MLX">
                  {visibleKeys.filter(([k]) => ["cache_limit_gb","num_draft_tokens"].includes(k)).map(([key, meta]) => (
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
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.models.getNotes(model.id)
      .then(d => { setNotes(d.notes); setTagsInput(d.tags.join(", ")); setLoading(false); })
      .catch(() => setLoading(false));
  }, [model.id]);

  const save = useCallback(async () => {
    const tags = tagsInput.split(",").map(t => t.trim()).filter(Boolean);
    const result = await api.models.setNotes(model.id, notes, tags);
    onSaved(result);
    setSaved(true);
  }, [model.id, notes, tagsInput, onSaved]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
          <div>
            <div className="text-sm font-semibold text-zinc-100">Notes & Tags</div>
            <div className="text-xs text-zinc-500 truncate max-w-xs mt-0.5">{model.name}</div>
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

  const inferenceKeys = ["temperature","max_tokens","context_window","top_k","top_p","min_p","repetition_penalty","presence_penalty"];

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
