"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useStatusStore } from "@/lib/stores/status";
import { useEffect } from "react";
import { Activity } from "lucide-react";

const NAV = [
  { href: "/", label: "Dashboard", icon: "⌂" },
  { href: "/models", label: "Models", icon: "◈" },
  { href: "/benchmark2", label: "Benchmark", icon: "⚡" },
  { href: "/benchmark/history", label: "History", icon: "📋" },
  { href: "/humaneval", label: "HumanEval", icon: "🧪" },
  { href: "/chat", label: "Chat", icon: "💬" },
  { href: "/chat/history", label: "Chat History", icon: "📜" },
  { href: "/chat/compare", label: "Compare", icon: "⇔" },
  { href: "/visualizer", label: "Visualizer", icon: "👁" },
  { href: "/diff", label: "Model Diff", icon: "⇋" },
  { href: "/arena", label: "Arena", icon: "⚔" },
  { href: "/dflash", label: "DFlash Bench", icon: "⚡" },
  { href: "/finetune", label: "Fine-tune", icon: "⚗" },
  { href: "/profiler", label: "Profiler", icon: "⏱" },
  { href: "/metrics", label: "Metrics", icon: "Activity" },
  { href: "/downloads", label: "Downloads", icon: "↓" },
  { href: "/schedules", label: "Schedules", icon: "⏱" },
  { href: "/recommender", label: "Recommender", icon: "✨" },
  { href: "/router", label: "Smart Router", icon: "🔀" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { status, fetch } = useStatusStore();

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, 10_000);
    return () => clearInterval(id);
  }, [fetch]);

  const thermalColor = {
    nominal: "text-green-400",
    fair: "text-yellow-400",
    serious: "text-orange-400",
    critical: "text-red-400",
    unknown: "text-zinc-500",
  }[status?.thermal_state ?? "unknown"] ?? "text-zinc-500";

  return (
    <aside className="flex flex-col w-56 min-h-screen bg-zinc-950 border-r border-white/10 p-4 gap-2 shrink-0">
      <div className="mb-4 px-2">
        <span className="text-lg font-bold text-indigo-400 tracking-tight">⚗ Crucible</span>
      </div>

      <nav className="flex flex-col gap-1 flex-1">
        {NAV.map(({ href, label, icon }) => {
          const active = href === "/" ? pathname === "/" : (pathname === href || pathname.startsWith(href + "/"));
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/30"
                  : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
              )}
            >
              {icon === "Activity" ? (
                <Activity className="w-5 h-5" />
              ) : (
                <span className="text-base">{icon}</span>
              )}
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Status footer */}
      <div className="border-t border-white/10 pt-3 mt-2 space-y-2">
        {status?.memory_pressure != null && (
          <div className="px-2">
            <div className="flex justify-between text-xs text-zinc-500 mb-1">
              <span>Memory</span>
              <span>{Math.round(status.memory_pressure * 100)}%</span>
            </div>
            <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  status.memory_pressure > 0.8
                    ? "bg-red-500"
                    : status.memory_pressure > 0.6
                    ? "bg-yellow-500"
                    : "bg-green-500"
                )}
                style={{ width: `${Math.round(status.memory_pressure * 100)}%` }}
              />
            </div>
          </div>
        )}
        {status?.thermal_state && (
          <div className={cn("px-2 text-xs capitalize", thermalColor)}>
            ⬡ {status.thermal_state}
          </div>
        )}
      </div>
    </aside>
  );
}
