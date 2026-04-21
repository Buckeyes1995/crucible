"use client";

import { useEffect, useState } from "react";
import { Sparkles, ChevronRight, Cpu, Zap, MessageSquare, Swords, Keyboard, X } from "lucide-react";
import Link from "next/link";

const STORAGE_KEY = "crucible.first-run-dismissed";

type Step = {
  icon: React.ReactNode;
  title: string;
  body: string;
  href?: string;
  cta?: string;
};

const STEPS: Step[] = [
  {
    icon: <Cpu className="w-5 h-5" />,
    title: "Your local model library",
    body: "Crucible scans the MLX, GGUF, and vLLM folders in your config and surfaces everything you already have. Load a model with one click.",
    href: "/models",
    cta: "Browse Models",
  },
  {
    icon: <MessageSquare className="w-5 h-5" />,
    title: "Chat that stays on your machine",
    body: "Chat sessions save to a local SQLite database — tag, pin, search them later. Toggle ephemeral mode in the top bar to skip history entirely.",
    href: "/chat",
    cta: "Open Chat",
  },
  {
    icon: <Zap className="w-5 h-5" />,
    title: "Benchmark anything",
    body: "Run throughput/TTFT suites across multiple models. View history, diff runs, export CSV, catch regressions automatically.",
    href: "/benchmark2",
    cta: "Start a Run",
  },
  {
    icon: <Swords className="w-5 h-5" />,
    title: "Arena & leaderboards",
    body: "Blind A/B battles update an ELO leaderboard across your models, so you know which one to reach for.",
    href: "/arena",
    cta: "Enter Arena",
  },
  {
    icon: <Keyboard className="w-5 h-5" />,
    title: "Power-user tips",
    body: "Press ? anywhere for keyboard shortcuts. Check /about for build info. Metrics live at /metrics in Prometheus format.",
  },
];

export function FirstRunWizard() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setOpen(true);
    } catch {
      // storage blocked — just skip
    }
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
    setOpen(false);
  };

  if (!open) return null;
  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div className="w-[min(520px,95vw)] rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06] bg-gradient-to-r from-indigo-950/30 to-transparent">
          <div className="flex items-center gap-2 text-zinc-100">
            <Sparkles className="w-4 h-4 text-indigo-300" />
            <span className="text-sm font-semibold">Welcome to Crucible</span>
          </div>
          <button onClick={dismiss} className="text-zinc-500 hover:text-zinc-200">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-6 space-y-4">
          <div className="flex items-center gap-3 text-indigo-300">
            {s.icon}
            <h3 className="text-base font-semibold text-zinc-100">{s.title}</h3>
          </div>
          <p className="text-sm text-zinc-300 leading-relaxed">{s.body}</p>
          {s.href && s.cta && (
            <Link
              href={s.href}
              onClick={dismiss}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              {s.cta} <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
        <div className="flex items-center justify-between px-6 py-3 border-t border-white/[0.06] bg-black/20">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={
                  "w-2 h-2 rounded-full transition-colors " +
                  (i === step ? "bg-indigo-400" : "bg-zinc-700")
                }
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={dismiss}
              className="text-xs text-zinc-500 hover:text-zinc-200 px-2 py-1"
            >
              Skip
            </button>
            {last ? (
              <button
                onClick={dismiss}
                className="text-xs px-3 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                Done
              </button>
            ) : (
              <button
                onClick={() => setStep((s) => s + 1)}
                className="text-xs px-3 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-100 flex items-center gap-1"
              >
                Next <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
