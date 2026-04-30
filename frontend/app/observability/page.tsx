"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FileText, ScrollText, HeartPulse, Bell } from "lucide-react";
import LogsTab from "./_tabs/logs";
import AuditTab from "./_tabs/audit";
import HealthTab from "./_tabs/health";
import AlertsTab from "./_tabs/alerts";

const TABS = [
  { value: "logs", label: "Logs", icon: FileText },
  { value: "audit", label: "Audit", icon: ScrollText },
  { value: "health", label: "Health", icon: HeartPulse },
  { value: "alerts", label: "Alerts", icon: Bell },
] as const;

type TabValue = (typeof TABS)[number]["value"];

function ObservabilityShell() {
  const sp = useSearchParams();
  const router = useRouter();
  const current = (sp.get("tab") as TabValue) || "logs";

  const onTab = (v: string) => {
    // replace, not push, so this doesn't pollute history with every click.
    router.replace(`/observability?tab=${v}`);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 px-6 pt-5 pb-3 border-b border-white/[0.04]">
        <h1 className="text-base font-semibold text-zinc-100">Observability</h1>
        <Tabs value={current} onValueChange={onTab} className="ml-2">
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
        {current === "logs" && <LogsTab />}
        {current === "audit" && <AuditTab />}
        {current === "health" && <HealthTab />}
        {current === "alerts" && <AlertsTab />}
      </div>
    </div>
  );
}

export default function ObservabilityPage() {
  return (
    <Suspense fallback={<div className="px-6 py-8 text-zinc-500">Loading…</div>}>
      <ObservabilityShell />
    </Suspense>
  );
}
