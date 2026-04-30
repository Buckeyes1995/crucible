"use client";

// Floating bottom-right progress HUD for model loads. Pinned regardless of
// which page you're on, so a 60s+ Qwen3-Coder-Next warmup is visible from
// the chat / settings / wherever you wandered to.

import { useModelsStore } from "@/lib/stores/models";
import { Loader2, Square } from "lucide-react";

function fmtMs(ms: number): string {
  if (!ms || ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function strip(name: string | null): string {
  if (!name) return "";
  // Trim "mlx:" / "gguf:" prefix and any "<dir>/<file>" path noise.
  const noPrefix = name.replace(/^(mlx|gguf|ollama|vllm|mlx_studio):/, "");
  return noPrefix.split("/").pop() ?? noPrefix;
}

export function ModelLoadProgress() {
  const id = useModelsStore((s) => s.loadingModelId);
  const stage = useModelsStore((s) => s.loadStage);
  const pct = useModelsStore((s) => s.loadProgressPct);
  const elapsedMs = useModelsStore((s) => s.loadElapsedMs);
  const estMs = useModelsStore((s) => s.loadEstimatedMs);
  const cancel = useModelsStore((s) => s.cancelLoad);

  if (!id) return null;

  const label = strip(id);

  return (
    <div
      className="fixed bottom-4 right-4 z-[60] w-[min(360px,calc(100vw-2rem))]
                 rounded-2xl border border-indigo-500/30 bg-zinc-950/95 backdrop-blur-md
                 shadow-2xl shadow-indigo-900/40 p-4 animate-fade-in"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-indigo-500/15 flex items-center justify-center shrink-0">
          <Loader2 className="w-5 h-5 text-indigo-300 animate-spin" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <div className="text-sm font-semibold text-zinc-100 truncate" title={id}>
              {label}
            </div>
            {pct != null && (
              <div className="font-mono text-lg font-bold text-indigo-300 tabular-nums shrink-0 ml-auto">
                {pct}%
              </div>
            )}
          </div>
          <div className="text-[11px] text-zinc-400 mt-0.5 truncate">
            {stage || "Loading…"}
          </div>
        </div>
        <button
          onClick={cancel}
          className="shrink-0 -mt-1 -mr-1 p-1.5 rounded-lg text-zinc-500 hover:text-red-300 hover:bg-red-950/30 transition-colors"
          title="Cancel load"
          aria-label="Cancel load"
        >
          <Square className="w-3.5 h-3.5 fill-current" />
        </button>
      </div>

      <div className="mt-3 h-1.5 bg-zinc-800/80 rounded-full overflow-hidden">
        {pct != null ? (
          <div
            className="h-full bg-gradient-to-r from-indigo-500 to-indigo-400 rounded-full transition-all duration-500 ease-out shadow-[0_0_12px_rgba(99,102,241,0.5)]"
            style={{ width: `${pct}%` }}
          />
        ) : (
          <div className="h-full bg-indigo-500/70 rounded-full animate-pulse w-1/3" />
        )}
      </div>

      {(elapsedMs > 0 || estMs) && (
        <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-500 font-mono tabular-nums">
          <span>{fmtMs(elapsedMs)} elapsed</span>
          {estMs && <span>~{fmtMs(estMs)} estimated</span>}
        </div>
      )}
    </div>
  );
}
