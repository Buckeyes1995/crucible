"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useStatusStore } from "@/lib/stores/status";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Cpu, MessageSquare, GitCompare, Swords, Trophy,
  Eye, FlaskConical, Zap, Bolt, Wrench, Activity, Timer, Calendar,
  DollarSign, BarChart3, FolderOpen, ListOrdered, Hash, Download,
  Clock, Bell, HeartPulse, Sparkles, GitBranch, Archive, Settings,
  ChevronDown, Search, Bot, Pin, FileText, ScrollText, Info, Newspaper,
} from "lucide-react";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";

type NavItem = { href: string; label: string; icon: React.ReactNode };
type NavGroup = { label: string; items: NavItem[]; defaultOpen?: boolean };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    defaultOpen: true,
    items: [
      { href: "/", label: "Dashboard", icon: <LayoutDashboard className="w-4 h-4" /> },
      { href: "/models", label: "Models", icon: <Cpu className="w-4 h-4" /> },
    ],
  },
  {
    label: "Inference",
    defaultOpen: true,
    items: [
      { href: "/chat", label: "Chat", icon: <MessageSquare className="w-4 h-4" /> },
      { href: "/chat/history", label: "History", icon: <Clock className="w-4 h-4" /> },
      { href: "/snippets", label: "Snippets", icon: <Pin className="w-4 h-4" /> },
      { href: "/reddit", label: "Reddit", icon: <MessageSquare className="w-4 h-4" /> },
      { href: "/news", label: "News", icon: <Newspaper className="w-4 h-4" /> },
      { href: "/logs", label: "Logs", icon: <FileText className="w-4 h-4" /> },
      { href: "/audit", label: "Audit", icon: <ScrollText className="w-4 h-4" /> },
      { href: "/ops", label: "Ops", icon: <Activity className="w-4 h-4" /> },
      { href: "/usage", label: "Usage", icon: <DollarSign className="w-4 h-4" /> },
      { href: "/usage/leaderboard", label: "Model Leaderboard", icon: <Trophy className="w-4 h-4" /> },
      { href: "/visualizer", label: "Visualizer", icon: <Eye className="w-4 h-4" /> },
      { href: "/batch-inference", label: "Batch", icon: <ListOrdered className="w-4 h-4" /> },
    ],
  },
  {
    label: "Compare",
    defaultOpen: true,
    items: [
      { href: "/chat/compare", label: "Side by Side", icon: <GitCompare className="w-4 h-4" /> },
      { href: "/diff", label: "Model Diff", icon: <GitCompare className="w-4 h-4" /> },
      { href: "/arena", label: "Arena", icon: <Swords className="w-4 h-4" /> },
      { href: "/arena/review", label: "Review Queue", icon: <Swords className="w-4 h-4" /> },
      { href: "/arena/leaderboard", label: "Leaderboard", icon: <Trophy className="w-4 h-4" /> },
    ],
  },
  {
    label: "Benchmark",
    items: [
      { href: "/benchmark2", label: "New Run", icon: <Zap className="w-4 h-4" /> },
      { href: "/benchmark/history", label: "History", icon: <BarChart3 className="w-4 h-4" /> },
      { href: "/benchmark/diff", label: "Diff", icon: <GitCompare className="w-4 h-4" /> },
      { href: "/humaneval", label: "HumanEval", icon: <FlaskConical className="w-4 h-4" /> },
      { href: "/dflash", label: "DFlash Bench", icon: <Bolt className="w-4 h-4" /> },
      { href: "/optimizer", label: "Optimizer", icon: <FlaskConical className="w-4 h-4" /> },
    ],
  },
  {
    label: "Analytics",
    items: [
      { href: "/profiler", label: "Profiler", icon: <Timer className="w-4 h-4" /> },
      { href: "/heatmap", label: "Heatmap", icon: <Calendar className="w-4 h-4" /> },
      { href: "/cost", label: "Cost", icon: <DollarSign className="w-4 h-4" /> },
      { href: "/token-analytics", label: "Tokens", icon: <Hash className="w-4 h-4" /> },
      { href: "/metrics", label: "Live Metrics", icon: <Activity className="w-4 h-4" /> },
    ],
  },
  {
    label: "Manage",
    items: [
      { href: "/agents", label: "Agents", icon: <Bot className="w-4 h-4" /> },
      { href: "/groups", label: "Groups", icon: <FolderOpen className="w-4 h-4" /> },
      { href: "/store", label: "Store", icon: <Download className="w-4 h-4" /> },
      { href: "/schedules", label: "Schedules", icon: <Clock className="w-4 h-4" /> },
      { href: "/finetune", label: "Fine-tune", icon: <Wrench className="w-4 h-4" /> },
      { href: "/recommender", label: "Recommender", icon: <Sparkles className="w-4 h-4" /> },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/health", label: "Health", icon: <HeartPulse className="w-4 h-4" /> },
      { href: "/notifications", label: "Alerts", icon: <Bell className="w-4 h-4" /> },
      { href: "/router", label: "Smart Router", icon: <GitBranch className="w-4 h-4" /> },
      { href: "/backup", label: "Backup", icon: <Archive className="w-4 h-4" /> },
      { href: "/settings", label: "Settings", icon: <Settings className="w-4 h-4" /> },
      { href: "/about", label: "About", icon: <Info className="w-4 h-4" /> },
    ],
  },
];

function NavGroupSection({ group, pathname }: { group: NavGroup; pathname: string }) {
  const hasActive = group.items.some(
    (item) => item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/")
  );
  const [open, setOpen] = useState(group.defaultOpen ?? hasActive);

  return (
    <div className="space-y-0.5">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500 hover:text-zinc-400 transition-colors"
      >
        {group.label}
        <ChevronDown className={cn("w-3 h-3 transition-transform", open ? "" : "-rotate-90")} />
      </button>
      {open && (
        <div className="space-y-px">
          {group.items.map(({ href, label, icon }, i) => {
            const active = href === "/" ? pathname === "/" : (pathname === href || pathname.startsWith(href + "/"));
            // Auto-indent sub-routes: if another item in this same group is a
            // strict prefix of this item's path, render it as a nested child.
            const isSubItem = group.items.some(
              (other, j) => j !== i && href !== other.href && href.startsWith(other.href + "/"),
            );
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2.5 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-150",
                  isSubItem ? "pl-7 pr-3 text-[12px]" : "px-3",
                  active
                    ? "bg-indigo-500/15 text-indigo-300 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.2)]"
                    : "text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04]"
                )}
              >
                <span className={cn("transition-colors", active ? "text-indigo-400" : "text-zinc-600")}>{icon}</span>
                {label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

type Telemetry = {
  cpu_percent: number;
  mem_percent: number;
  thermal_state: string;
  package_watts: number | null;
};

export function Sidebar() {
  const pathname = usePathname();
  const { status, fetch } = useStatusStore();
  const [telHistory, setTelHistory] = useState<Telemetry[]>([]);

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, 10_000);
    return () => clearInterval(id);
  }, [fetch]);

  // Lightweight live telemetry poll — 5s cadence, 60-sample rolling buffer.
  useEffect(() => {
    let stop = false;
    const pull = async () => {
      try {
        const r = await window.fetch("/api/system/telemetry");
        if (!r.ok) return;
        const t = (await r.json()) as Telemetry;
        if (stop) return;
        setTelHistory((prev) => [...prev.slice(-59), t]);
      } catch { /* ignore */ }
    };
    pull();
    const id = setInterval(pull, 5000);
    return () => { stop = true; clearInterval(id); };
  }, []);
  const latestTel = telHistory[telHistory.length - 1];

  const memPct = status?.memory_pressure != null ? Math.round(status.memory_pressure * 100) : null;
  const thermalColor = {
    nominal: "text-emerald-400",
    fair: "text-yellow-400",
    serious: "text-orange-400",
    critical: "text-red-400",
  }[status?.thermal_state ?? ""] ?? "text-zinc-600";

  return (
    <aside className="flex flex-col w-[var(--sidebar-width)] min-h-screen bg-zinc-950 border-r border-white/[0.06] shrink-0">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
            <FlaskConical className="w-4 h-4 text-white" />
          </div>
          <span className="text-[15px] font-bold tracking-tight text-zinc-100">Crucible</span>
        </div>
      </div>

      {/* Project switcher — v4 #4 */}
      <ProjectSwitcher />

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-3">
        {NAV_GROUPS.map((group) => (
          <NavGroupSection key={group.label} group={group} pathname={pathname} />
        ))}
      </nav>

      {/* Status footer */}
      <div className="border-t border-white/[0.06] px-3 py-3 space-y-2">
        {memPct != null && (
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-zinc-600">
              <span>Memory</span>
              <span className={cn("font-mono", memPct > 80 ? "text-red-400" : memPct > 60 ? "text-yellow-400" : "text-zinc-500")}>{memPct}%</span>
            </div>
            <div className="h-1 bg-zinc-800/80 rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  memPct > 80 ? "bg-red-500" : memPct > 60 ? "bg-yellow-500" : "bg-indigo-500/70"
                )}
                style={{ width: `${memPct}%` }}
              />
            </div>
          </div>
        )}
        {status?.thermal_state && (
          <div className={cn("flex items-center gap-1.5 text-[10px]", thermalColor)}>
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            <span className="capitalize">{status.thermal_state}</span>
            {latestTel?.package_watts != null && (
              <span className="ml-auto font-mono text-zinc-500">
                {latestTel.package_watts.toFixed(1)}W
              </span>
            )}
          </div>
        )}
        {latestTel && (
          <CpuSpark history={telHistory} />
        )}
      </div>
    </aside>
  );
}

// Compact 60-sample CPU-% sparkline rendered inline as SVG polyline so we
// don't drag a chart library into the sidebar hot path. x: sample index,
// y: cpu_percent inverted (y=0 is top of the box).
function CpuSpark({ history }: { history: Telemetry[] }) {
  if (history.length < 2) {
    const latest = history[0];
    return (
      <div className="flex items-center justify-between text-[10px] text-zinc-500">
        <span>CPU</span>
        <span className="font-mono">{latest ? `${latest.cpu_percent.toFixed(0)}%` : "—"}</span>
      </div>
    );
  }
  const w = 160;
  const h = 24;
  const maxSamples = 60;
  const slice = history.slice(-maxSamples);
  const n = slice.length;
  const pts = slice
    .map((t, i) => {
      const x = (i / (maxSamples - 1)) * w;
      const y = h - Math.min(100, Math.max(0, t.cpu_percent)) / 100 * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const latest = slice[n - 1];
  const color = latest.cpu_percent > 80 ? "#f87171" : latest.cpu_percent > 50 ? "#fbbf24" : "#818cf8";
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-0.5">
        <span>CPU</span>
        <span className="font-mono" style={{ color }}>{latest.cpu_percent.toFixed(0)}%</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-6" preserveAspectRatio="none">
        <polyline
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth="1.25"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
