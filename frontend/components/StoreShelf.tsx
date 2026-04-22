"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// A horizontal scroller with lazily-appearing arrow buttons. Children are laid
// out as flex row items — the caller controls card width, we handle scrolling,
// snap behaviour, and overflow shadows.
export function StoreShelf({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateArrows();
    el.addEventListener("scroll", updateArrows, { passive: true });
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateArrows);
      ro.disconnect();
    };
  }, [updateArrows]);

  const scrollBy = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.8, 360), behavior: "smooth" });
  };

  return (
    <section className={cn("relative", className)}>
      <div className="flex items-end justify-between mb-2 px-1">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-100 tracking-tight truncate">{title}</h2>
          {subtitle && (
            <p className="text-[11px] text-zinc-500 truncate">{subtitle}</p>
          )}
        </div>
        {action}
      </div>

      <div className="relative group">
        {canLeft && (
          <button
            onClick={() => scrollBy(-1)}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 h-9 w-9 rounded-full bg-zinc-950/90 border border-white/10 text-zinc-200 hover:bg-zinc-900 hover:text-white shadow-lg transition-opacity opacity-0 group-hover:opacity-100"
            aria-label="Scroll left"
          >
            <ChevronLeft className="w-4 h-4 mx-auto" />
          </button>
        )}
        {canRight && (
          <button
            onClick={() => scrollBy(1)}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 h-9 w-9 rounded-full bg-zinc-950/90 border border-white/10 text-zinc-200 hover:bg-zinc-900 hover:text-white shadow-lg transition-opacity opacity-0 group-hover:opacity-100"
            aria-label="Scroll right"
          >
            <ChevronRight className="w-4 h-4 mx-auto" />
          </button>
        )}

        <div
          ref={scrollerRef}
          className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden snap-x snap-mandatory scroll-smooth pb-2 -mx-1 px-1 w-full"
          style={{ scrollbarWidth: "thin" }}
        >
          {children}
        </div>

        {/* Edge fades hint that more content scrolls off-screen */}
        {canLeft && (
          <div className="pointer-events-none absolute left-0 top-0 bottom-2 w-8 bg-gradient-to-r from-zinc-950 to-transparent" />
        )}
        {canRight && (
          <div className="pointer-events-none absolute right-0 top-0 bottom-2 w-8 bg-gradient-to-l from-zinc-950 to-transparent" />
        )}
      </div>
    </section>
  );
}

// Wrapper for each card inside a shelf — fixed width + height + snap so
// every shelf row is uniform. Cards inside must set w-full + h-full
// themselves (ItemCard does this when `compact` is passed).
export function ShelfCardWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="snap-start shrink-0 w-[240px] h-[260px]">
      {children}
    </div>
  );
}
