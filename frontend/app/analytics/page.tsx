"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Timer, Calendar, DollarSign, Trophy, Hash, Activity,
} from "lucide-react";
import ProfilerTab from "./_tabs/profiler";
import HeatmapTab from "./_tabs/heatmap";
import CostTab from "./_tabs/cost";
import UsageTab from "./_tabs/usage";
import LeaderboardTab from "./_tabs/leaderboard";
import TokensTab from "./_tabs/tokens";
import MetricsTab from "./_tabs/metrics";
import OpsTab from "./_tabs/ops";

const TABS = [
  { value: "profiler", label: "Profiler", icon: Timer },
  { value: "heatmap", label: "Heatmap", icon: Calendar },
  { value: "cost", label: "Cost", icon: DollarSign },
  { value: "usage", label: "Usage", icon: DollarSign },
  { value: "leaderboard", label: "Leaderboard", icon: Trophy },
  { value: "tokens", label: "Tokens", icon: Hash },
  { value: "metrics", label: "Live Metrics", icon: Activity },
  { value: "ops", label: "Ops", icon: Activity },
] as const;

type TabValue = (typeof TABS)[number]["value"];

function AnalyticsShell() {
  const sp = useSearchParams();
  const router = useRouter();
  const current = (sp.get("tab") as TabValue) || "profiler";

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 px-6 pt-5 pb-3 border-b border-white/[0.04]">
        <Activity className="w-5 h-5 text-indigo-400" />
        <h1 className="text-base font-semibold text-zinc-100">Analytics</h1>
        <Tabs
          value={current}
          onValueChange={(v) => router.replace(`/analytics?tab=${v}`)}
          className="ml-2 overflow-x-auto"
        >
          <TabsList>
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <TabsTrigger key={t.value} value={t.value}>
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {current === "profiler" && <ProfilerTab />}
        {current === "heatmap" && <HeatmapTab />}
        {current === "cost" && <CostTab />}
        {current === "usage" && <UsageTab />}
        {current === "leaderboard" && <LeaderboardTab />}
        {current === "tokens" && <TokensTab />}
        {current === "metrics" && <MetricsTab />}
        {current === "ops" && <OpsTab />}
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<div className="px-6 py-8 text-zinc-500">Loading…</div>}>
      <AnalyticsShell />
    </Suspense>
  );
}
