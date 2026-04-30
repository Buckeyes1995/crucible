"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Wrench, Sparkles } from "lucide-react";
import StudioTab from "./_tabs/studio";
import JobsTab from "./_tabs/jobs";

const TABS = [
  { value: "studio", label: "Studio", icon: Wrench },
  { value: "jobs", label: "Jobs", icon: Sparkles },
] as const;

type TabValue = (typeof TABS)[number]["value"];

function FinetuneShell() {
  const sp = useSearchParams();
  const router = useRouter();
  const current = (sp.get("tab") as TabValue) || "studio";

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 px-6 pt-5 pb-3 border-b border-white/[0.04]">
        <Wrench className="w-5 h-5 text-indigo-400" />
        <h1 className="text-base font-semibold text-zinc-100">Fine-tune</h1>
        <Tabs
          value={current}
          onValueChange={(v) => router.replace(`/finetune?tab=${v}`)}
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
        {current === "studio" && <StudioTab />}
        {current === "jobs" && <JobsTab />}
      </div>
    </div>
  );
}

export default function FinetunePage() {
  return (
    <Suspense fallback={<div className="px-6 py-8 text-zinc-500">Loading…</div>}>
      <FinetuneShell />
    </Suspense>
  );
}
