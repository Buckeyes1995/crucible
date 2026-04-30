"use client";

import { useEffect, useState } from "react";
import { Keyboard, X } from "lucide-react";

type Row = { keys: string[]; desc: string };

const SHORTCUTS: { group: string; rows: Row[] }[] = [
  {
    group: "Global",
    rows: [
      { keys: ["?"], desc: "Show this shortcut list" },
      { keys: ["⌘", "K"], desc: "Open command palette (any page)" },
      { keys: ["g", "m"], desc: "Go to Models" },
      { keys: ["g", "c"], desc: "Go to Chat" },
      { keys: ["g", "b"], desc: "Go to Benchmarks" },
      { keys: ["g", "s"], desc: "Go to Settings" },
      { keys: ["Esc"], desc: "Close dialog / cancel" },
    ],
  },
  {
    group: "Chat",
    rows: [
      { keys: ["Enter"], desc: "Send message" },
      { keys: ["Shift", "Enter"], desc: "New line" },
      { keys: ["/"], desc: "Focus model picker" },
    ],
  },
  {
    group: "Benchmark detail",
    rows: [
      { keys: ["d"], desc: "Download CSV" },
    ],
  },
];

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      const inField = tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable);
      if (inField) return;
      if (e.key === "?" && (e.shiftKey || true)) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[min(560px,95vw)] max-h-[85vh] overflow-y-auto rounded-xl border border-white/10 bg-zinc-950 p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-zinc-100">
            <Keyboard className="w-4 h-4" />
            <h2 className="font-semibold">Keyboard shortcuts</h2>
          </div>
          <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-200">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-5 text-sm">
          {SHORTCUTS.map((s) => (
            <div key={s.group}>
              <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">{s.group}</div>
              <ul className="space-y-1.5">
                {s.rows.map((r) => (
                  <li key={r.desc} className="flex items-center justify-between gap-4">
                    <span className="text-zinc-300">{r.desc}</span>
                    <div className="flex gap-1">
                      {r.keys.map((k) => (
                        <kbd
                          key={k}
                          className="font-mono text-[11px] px-1.5 py-0.5 rounded border border-white/10 bg-zinc-900 text-zinc-200"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[11px] text-zinc-500">
          Press <kbd className="px-1 py-0.5 rounded bg-zinc-800 font-mono">?</kbd> any time to toggle this list.
        </p>
      </div>
    </div>
  );
}
