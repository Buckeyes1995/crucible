"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Search } from "lucide-react";
import { ICONS, PALETTE_ITEMS, type PaletteItem } from "@/lib/nav";

// Subsequence fuzzy match: returns a positive score (lower = better match)
// or null when the query letters don't appear in order in the haystack.
function fuzzyScore(query: string, hay: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const h = hay.toLowerCase();
  let qi = 0;
  let lastIdx = -1;
  let score = 0;
  for (let i = 0; i < h.length && qi < q.length; i++) {
    if (h[i] === q[qi]) {
      // Penalty for distance between matches; reward consecutive runs.
      score += i - (lastIdx + 1);
      lastIdx = i;
      qi++;
    }
  }
  if (qi < q.length) return null;
  // Prefix match bonus.
  if (h.startsWith(q)) score -= 10;
  return score;
}

type Ranked = PaletteItem & { _score: number };

function rank(query: string, items: PaletteItem[]): Ranked[] {
  if (!query) {
    return items.map((it) => ({ ...it, _score: 0 }));
  }
  const out: Ranked[] = [];
  for (const it of items) {
    const labelScore = fuzzyScore(query, it.label);
    const groupScore = fuzzyScore(query, it.group);
    const kwScore = it.keywords?.length
      ? Math.min(...it.keywords.map((k) => fuzzyScore(query, k) ?? Infinity))
      : Infinity;
    const best = Math.min(
      labelScore ?? Infinity,
      (groupScore ?? Infinity) + 5, // group matches rank lower than label matches
      kwScore + 3,
    );
    if (best !== Infinity) out.push({ ...it, _score: best });
  }
  return out.sort((a, b) => a._score - b._score);
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Cmd/Ctrl+K toggles. Esc + outside-click handled by Dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ranked = useMemo(() => rank(q, PALETTE_ITEMS), [q]);

  // Reset when (re)opening or query changes.
  useEffect(() => {
    setActiveIdx(0);
  }, [q, open]);

  // Reset query on close.
  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  // Keep active item scrolled into view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  const navigate = useCallback(
    (item: PaletteItem) => {
      setOpen(false);
      router.push(item.href);
    },
    [router],
  );

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, ranked.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = ranked[activeIdx];
      if (pick) navigate(pick);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[9998] bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[18vh] z-[9999] w-[min(640px,95vw)] -translate-x-1/2 rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
            <Search className="w-4 h-4 text-zinc-500 shrink-0" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search pages…"
              className="flex-1 bg-transparent text-[14px] text-zinc-100 placeholder:text-zinc-600 outline-none"
            />
            <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-white/10 bg-zinc-900 text-zinc-400">
              esc
            </kbd>
          </div>
          <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-1.5">
            {ranked.length === 0 ? (
              <div className="px-4 py-8 text-center text-[13px] text-zinc-500">
                No matches for &ldquo;{q}&rdquo;
              </div>
            ) : (
              ranked.map((item, i) => {
                const Icon = ICONS[item.iconKey];
                const active = i === activeIdx;
                return (
                  <button
                    key={`${item.href}::${i}`}
                    data-idx={i}
                    onClick={() => navigate(item)}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={
                      "flex items-center gap-3 w-full px-4 py-2 text-left transition-colors " +
                      (active
                        ? "bg-indigo-500/15 text-indigo-100"
                        : "text-zinc-300 hover:bg-white/[0.03]")
                    }
                  >
                    <Icon
                      className={
                        "w-4 h-4 shrink-0 " +
                        (active ? "text-indigo-300" : "text-zinc-500")
                      }
                    />
                    <span className="flex-1 text-[13px] font-medium truncate">
                      {item.label}
                    </span>
                    <span className="text-[11px] text-zinc-500 uppercase tracking-wider shrink-0">
                      {item.group}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          <div className="flex items-center justify-between px-4 py-2 border-t border-white/[0.06] text-[11px] text-zinc-500">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="font-mono px-1 py-0.5 rounded border border-white/10 bg-zinc-900">↑↓</kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="font-mono px-1 py-0.5 rounded border border-white/10 bg-zinc-900">↵</kbd>
                open
              </span>
            </div>
            <span>
              <kbd className="font-mono px-1 py-0.5 rounded border border-white/10 bg-zinc-900">⌘K</kbd>
              to toggle
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
