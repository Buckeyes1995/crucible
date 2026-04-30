// Single source of truth for sidebar navigation + Cmd+K command palette.
// Sidebar shows the grouped tree; the palette flattens to leaf entries.
//
// Icons are referenced by string key (not JSX) so this module stays
// pure-data and serializable. The lookup is exported as ICONS for renderers.

import {
  LayoutDashboard, Cpu, MessageSquare, GitCompare, Swords, Trophy,
  Eye, FlaskConical, Zap, Bolt, Wrench, Activity, Timer, Calendar,
  DollarSign, BarChart3, FolderOpen, ListOrdered, Hash, Download,
  Clock, Bell, HeartPulse, Sparkles, GitBranch, Archive, Settings,
  Bot, Pin, FileText, ScrollText, Info, Newspaper, Database,
  Workflow, Image as ImageIcon, Film,
  type LucideIcon,
} from "lucide-react";

export type IconKey =
  | "dashboard" | "cpu" | "chat" | "diff" | "swords" | "trophy"
  | "eye" | "flask" | "zap" | "bolt" | "wrench" | "activity"
  | "timer" | "calendar" | "dollar" | "barchart" | "folder" | "list"
  | "hash" | "download" | "clock" | "bell" | "heart" | "sparkles"
  | "branch" | "archive" | "settings" | "bot" | "pin" | "file"
  | "scroll" | "info" | "newspaper" | "database" | "workflow"
  | "image" | "film";

export const ICONS: Record<IconKey, LucideIcon> = {
  dashboard: LayoutDashboard, cpu: Cpu, chat: MessageSquare, diff: GitCompare,
  swords: Swords, trophy: Trophy, eye: Eye, flask: FlaskConical, zap: Zap,
  bolt: Bolt, wrench: Wrench, activity: Activity, timer: Timer, calendar: Calendar,
  dollar: DollarSign, barchart: BarChart3, folder: FolderOpen, list: ListOrdered,
  hash: Hash, download: Download, clock: Clock, bell: Bell, heart: HeartPulse,
  sparkles: Sparkles, branch: GitBranch, archive: Archive, settings: Settings,
  bot: Bot, pin: Pin, file: FileText, scroll: ScrollText, info: Info,
  newspaper: Newspaper, database: Database, workflow: Workflow,
  image: ImageIcon, film: Film,
};

export type NavItem = {
  href: string;
  label: string;
  iconKey: IconKey;
  // Extra search terms for the command palette (optional).
  keywords?: string[];
};

export type NavGroup = {
  label: string;
  items: NavItem[];
  defaultOpen?: boolean;
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    defaultOpen: true,
    items: [
      { href: "/", label: "Dashboard", iconKey: "dashboard" },
      { href: "/models", label: "Models", iconKey: "cpu" },
    ],
  },
  {
    label: "Inference",
    items: [
      { href: "/chat", label: "Chat", iconKey: "chat" },
      { href: "/images", label: "Images", iconKey: "image" },
      { href: "/videos", label: "Videos", iconKey: "film" },
      { href: "/chat/history", label: "History", iconKey: "clock" },
      { href: "/snippets", label: "Snippets", iconKey: "pin" },
      { href: "/batch-inference", label: "Batch", iconKey: "list" },
      { href: "/runs", label: "Agent Runs", iconKey: "bot" },
      { href: "/rag", label: "RAG", iconKey: "database" },
      { href: "/prompts", label: "Prompts", iconKey: "file" },
    ],
  },
  {
    label: "Compare",
    items: [
      { href: "/chat/compare", label: "Side by Side", iconKey: "diff" },
      { href: "/diff", label: "Model Diff", iconKey: "diff" },
      { href: "/arena", label: "Arena", iconKey: "swords",
        keywords: ["battle", "elo", "leaderboard", "review", "vote"] },
    ],
  },
  {
    label: "Benchmark",
    items: [
      { href: "/benchmark", label: "Benchmark", iconKey: "zap",
        keywords: ["run", "history", "diff", "dflash", "optimizer", "speed"] },
      { href: "/evals", label: "Evals", iconKey: "flask",
        keywords: ["humaneval", "suites", "gsm8k"] },
    ],
  },
  {
    label: "Analytics",
    items: [
      { href: "/analytics", label: "Analytics", iconKey: "timer",
        keywords: ["profiler", "heatmap", "cost", "usage", "leaderboard", "tokens", "metrics", "ops"] },
    ],
  },
  {
    label: "Manage",
    items: [
      { href: "/agents", label: "Agents", iconKey: "bot" },
      { href: "/groups", label: "Groups", iconKey: "folder" },
      { href: "/store", label: "Store", iconKey: "download",
        keywords: ["browse", "recommender", "downloads", "huggingface", "hf"] },
      { href: "/schedules", label: "Schedules", iconKey: "clock" },
      { href: "/automation", label: "Automation", iconKey: "workflow" },
      { href: "/finetune", label: "Fine-tune", iconKey: "wrench",
        keywords: ["jobs", "studio", "training", "lora"] },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/observability", label: "Observability", iconKey: "activity",
        keywords: ["logs", "audit", "health", "alerts", "notifications"] },
      { href: "/router", label: "Smart Router", iconKey: "branch" },
      { href: "/backup", label: "Backup", iconKey: "archive" },
      { href: "/settings", label: "Settings", iconKey: "settings" },
      { href: "/about", label: "About", iconKey: "info" },
    ],
  },
];

// Extra palette-only entries: deep links into hub tabs so users can still
// jump straight to "Logs" via Cmd+K even though the sidebar collapses to
// "Observability". These do not appear in NAV_GROUPS.
const HUB_DEEP_LINKS: PaletteItem[] = [
  { href: "/observability?tab=logs", label: "Logs", group: "Observability", iconKey: "file" },
  { href: "/observability?tab=audit", label: "Audit", group: "Observability", iconKey: "scroll" },
  { href: "/observability?tab=health", label: "Health", group: "Observability", iconKey: "heart" },
  { href: "/observability?tab=alerts", label: "Alerts", group: "Observability", iconKey: "bell" },
  { href: "/evals?tab=humaneval", label: "HumanEval", group: "Evals", iconKey: "flask" },
  { href: "/arena?tab=review", label: "Arena Review Queue", group: "Compare", iconKey: "swords" },
  { href: "/arena?tab=leaderboard", label: "Arena Leaderboard", group: "Compare", iconKey: "trophy" },
  { href: "/benchmark?tab=run", label: "New Benchmark Run", group: "Benchmark", iconKey: "zap" },
  { href: "/benchmark?tab=history", label: "Benchmark History", group: "Benchmark", iconKey: "barchart" },
  { href: "/benchmark?tab=diff", label: "Benchmark Diff", group: "Benchmark", iconKey: "diff" },
  { href: "/benchmark?tab=dflash", label: "DFlash Bench", group: "Benchmark", iconKey: "bolt" },
  { href: "/benchmark?tab=optimizer", label: "Optimizer", group: "Benchmark", iconKey: "flask" },
  { href: "/store?tab=browse", label: "Browse Models", group: "Store", iconKey: "download" },
  { href: "/store?tab=recommender", label: "Recommender", group: "Store", iconKey: "sparkles" },
  { href: "/store?tab=downloads", label: "Active Downloads", group: "Store", iconKey: "list" },
  { href: "/analytics?tab=profiler", label: "Profiler", group: "Analytics", iconKey: "timer" },
  { href: "/analytics?tab=heatmap", label: "Heatmap", group: "Analytics", iconKey: "calendar" },
  { href: "/analytics?tab=cost", label: "Cost", group: "Analytics", iconKey: "dollar" },
  { href: "/analytics?tab=usage", label: "Usage", group: "Analytics", iconKey: "dollar" },
  { href: "/analytics?tab=leaderboard", label: "Model Leaderboard", group: "Analytics", iconKey: "trophy" },
  { href: "/analytics?tab=tokens", label: "Tokens", group: "Analytics", iconKey: "hash" },
  { href: "/analytics?tab=metrics", label: "Live Metrics", group: "Analytics", iconKey: "activity" },
  { href: "/analytics?tab=ops", label: "Ops", group: "Analytics", iconKey: "activity" },
  { href: "/finetune?tab=jobs", label: "Fine-tune Jobs", group: "Manage", iconKey: "sparkles" },
];

// Flat list for the command palette. Group label is preserved for display
// and grouping in the palette UI. The palette can include items not in
// NAV_GROUPS (e.g., per-tab deep-links into hub pages); add those here
// without polluting the sidebar.
export type PaletteItem = {
  href: string;
  label: string;
  group: string;
  iconKey: IconKey;
  keywords?: string[];
};

export const PALETTE_ITEMS: PaletteItem[] = [
  ...NAV_GROUPS.flatMap((g) =>
    g.items.map((it) => ({
      href: it.href,
      label: it.label,
      group: g.label,
      iconKey: it.iconKey,
      keywords: it.keywords,
    })),
  ),
  ...HUB_DEEP_LINKS,
];
