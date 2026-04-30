"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Download, Sparkles, ListOrdered } from "lucide-react";
import BrowseTab from "./_tabs/browse";
import RecommenderTab from "./_tabs/recommender";
import DownloadsTab from "./_tabs/downloads";

const TABS = [
  { value: "browse", label: "Browse", icon: Download },
  { value: "recommender", label: "Recommender", icon: Sparkles },
  { value: "downloads", label: "Downloads", icon: ListOrdered },
] as const;

type TabValue = (typeof TABS)[number]["value"];

function StoreShell() {
  const sp = useSearchParams();
  const router = useRouter();
  const current = (sp.get("tab") as TabValue) || "browse";

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 px-6 pt-5 pb-3 border-b border-white/[0.04]">
        <Download className="w-5 h-5 text-indigo-400" />
        <h1 className="text-base font-semibold text-zinc-100">Store</h1>
        <Tabs
          value={current}
          onValueChange={(v) => router.replace(`/store?tab=${v}`)}
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
        {current === "browse" && <BrowseTab />}
        {current === "recommender" && <RecommenderTab />}
        {current === "downloads" && <DownloadsTab />}
      </div>
    </div>
  );
}

export default function StorePage() {
  return (
    <Suspense fallback={<div className="px-6 py-8 text-zinc-500">Loading…</div>}>
      <StoreShell />
    </Suspense>
  );
}
