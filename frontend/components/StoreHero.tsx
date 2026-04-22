"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StoreArt } from "@/components/StoreArt";
import type { StoreRailItem } from "@/lib/api";
import { cn } from "@/lib/utils";

const ROTATE_MS = 8000;

type HeroItem = StoreRailItem;

const KIND_LABEL: Record<StoreRailItem["kind"], string> = {
  models: "MODEL",
  prompts: "PROMPT",
  workflows: "WORKFLOW",
  system_prompts: "SYSTEM PROMPT",
  mcps: "MCP SERVER",
};

export function StoreHero({
  items,
  onAction,
  installed,
  ctaLabel,
}: {
  items: HeroItem[];
  onAction: (it: HeroItem) => void;
  installed: (it: HeroItem) => boolean;
  ctaLabel: (it: HeroItem) => string;
}) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-rotate every ROTATE_MS unless hovered.
  useEffect(() => {
    if (paused || items.length < 2) return;
    timer.current = setTimeout(() => {
      setIdx((i) => (i + 1) % items.length);
    }, ROTATE_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [idx, paused, items.length]);

  if (items.length === 0) return null;
  const it = items[idx];

  const go = (d: 1 | -1) => setIdx((i) => (i + d + items.length) % items.length);

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 h-[200px] mb-8 group"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Background art — scaled up copy of the item's StoreArt with a
          left-to-right vignette so the copy stays readable. */}
      <div className="absolute inset-0">
        <StoreArt id={it.id} kind={it.kind} sizeGb={it.size_gb} height={200} />
      </div>
      <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/95 via-zinc-950/70 to-transparent" />

      {/* Copy */}
      <div className="relative h-full flex flex-col justify-center px-8 py-6 max-w-xl">
        <div className="text-[10px] uppercase tracking-[0.2em] text-indigo-300 font-semibold mb-1.5">
          Featured · {KIND_LABEL[it.kind]}
        </div>
        <h2 className="text-3xl font-semibold text-zinc-50 tracking-tight leading-tight truncate" title={it.name}>
          {it.name}
        </h2>
        {it.description && (
          <p className="text-sm text-zinc-300 mt-2 line-clamp-2 leading-relaxed">{it.description}</p>
        )}
        <div className="flex items-center gap-3 mt-4">
          {installed(it) ? (
            <span className="text-xs text-emerald-300 bg-emerald-900/20 border border-emerald-500/30 rounded px-3 py-1.5">
              Installed ✓
            </span>
          ) : (
            <Button variant="primary" size="sm" onClick={() => onAction(it)} className="gap-1.5 shadow-lg">
              <Download className="w-3.5 h-3.5" /> {ctaLabel(it)}
            </Button>
          )}
          <div className="flex gap-2 text-[11px] text-zinc-400 font-mono">
            {it.size_gb ? <span>{it.size_gb} GB</span> : null}
            {it.repo_id ? <span className="truncate max-w-[180px]" title={it.repo_id}>{it.repo_id}</span> : null}
            {it.runtime ? <span>via {it.runtime}</span> : null}
            {it.agent ? <span>agent: {it.agent}</span> : null}
          </div>
        </div>
      </div>

      {/* Prev / next arrows — visible only on hover, only when ≥ 2 items */}
      {items.length > 1 && (
        <>
          <button
            onClick={() => go(-1)}
            className="absolute left-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-zinc-950/80 border border-white/10 text-zinc-200 hover:bg-zinc-900 opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Previous"
          >
            <ChevronLeft className="w-4 h-4 mx-auto" />
          </button>
          <button
            onClick={() => go(1)}
            className="absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-zinc-950/80 border border-white/10 text-zinc-200 hover:bg-zinc-900 opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Next"
          >
            <ChevronRight className="w-4 h-4 mx-auto" />
          </button>
          <div className="absolute bottom-3 right-4 flex gap-1.5">
            {items.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                className={cn(
                  "w-1.5 h-1.5 rounded-full transition-all",
                  i === idx ? "bg-zinc-100 w-5" : "bg-zinc-600 hover:bg-zinc-400",
                )}
                aria-label={`Go to slide ${i + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
