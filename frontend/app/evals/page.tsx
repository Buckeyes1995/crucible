"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FlaskConical } from "lucide-react";
import SuitesTab from "./_tabs/suites";
import HumanEvalTab from "./_tabs/humaneval";

const TABS = [
  { value: "suites", label: "Suites" },
  { value: "humaneval", label: "HumanEval" },
] as const;

type TabValue = (typeof TABS)[number]["value"];

function EvalsShell() {
  const sp = useSearchParams();
  const router = useRouter();
  const current = (sp.get("tab") as TabValue) || "suites";

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 px-6 pt-5 pb-3 border-b border-white/[0.04]">
        <FlaskConical className="w-5 h-5 text-indigo-400" />
        <h1 className="text-base font-semibold text-zinc-100">Evals</h1>
        <Tabs
          value={current}
          onValueChange={(v) => router.replace(`/evals?tab=${v}`)}
          className="ml-2"
        >
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {current === "suites" && <SuitesTab />}
        {current === "humaneval" && <HumanEvalTab />}
      </div>
    </div>
  );
}

export default function EvalsPage() {
  return (
    <Suspense fallback={<div className="px-6 py-8 text-zinc-500">Loading…</div>}>
      <EvalsShell />
    </Suspense>
  );
}
