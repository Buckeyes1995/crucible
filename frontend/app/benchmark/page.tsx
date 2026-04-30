"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Zap, BarChart3, GitCompare, Bolt, FlaskConical } from "lucide-react";
import RunTab from "./_tabs/run";
import HistoryTab from "./_tabs/history";
import DiffTab from "./_tabs/diff";
import DFlashTab from "./_tabs/dflash";
import OptimizerTab from "./_tabs/optimizer";

const TABS = [
  { value: "run", label: "Run", icon: Zap },
  { value: "history", label: "History", icon: BarChart3 },
  { value: "diff", label: "Diff", icon: GitCompare },
  { value: "dflash", label: "DFlash", icon: Bolt },
  { value: "optimizer", label: "Optimizer", icon: FlaskConical },
] as const;

type TabValue = (typeof TABS)[number]["value"];

function BenchmarkShell() {
  const sp = useSearchParams();
  const router = useRouter();
  const current = (sp.get("tab") as TabValue) || "run";

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 px-6 pt-5 pb-3 border-b border-white/[0.04]">
        <Zap className="w-5 h-5 text-indigo-400" />
        <h1 className="text-base font-semibold text-zinc-100">Benchmark</h1>
        <Tabs
          value={current}
          onValueChange={(v) => router.replace(`/benchmark?tab=${v}`)}
          className="ml-2"
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
        {current === "run" && <RunTab />}
        {current === "history" && <HistoryTab />}
        {current === "diff" && <DiffTab />}
        {current === "dflash" && <DFlashTab />}
        {current === "optimizer" && <OptimizerTab />}
      </div>
    </div>
  );
}

export default function BenchmarkPage() {
  return (
    <Suspense fallback={<div className="px-6 py-8 text-zinc-500">Loading…</div>}>
      <BenchmarkShell />
    </Suspense>
  );
}
