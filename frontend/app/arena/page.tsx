"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Swords, MessagesSquare, Trophy } from "lucide-react";
import PlayTab from "./_tabs/play";
import ReviewTab from "./_tabs/review";
import LeaderboardTab from "./_tabs/leaderboard";

const TABS = [
  { value: "play", label: "Play", icon: Swords },
  { value: "review", label: "Review", icon: MessagesSquare },
  { value: "leaderboard", label: "Leaderboard", icon: Trophy },
] as const;

type TabValue = (typeof TABS)[number]["value"];

function ArenaShell() {
  const sp = useSearchParams();
  const router = useRouter();
  const current = (sp.get("tab") as TabValue) || "play";

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 px-6 pt-5 pb-3 border-b border-white/[0.04]">
        <Swords className="w-5 h-5 text-indigo-400" />
        <h1 className="text-base font-semibold text-zinc-100">Arena</h1>
        <Tabs
          value={current}
          onValueChange={(v) => router.replace(`/arena?tab=${v}`)}
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
        {current === "play" && <PlayTab />}
        {current === "review" && <ReviewTab />}
        {current === "leaderboard" && <LeaderboardTab />}
      </div>
    </div>
  );
}

export default function ArenaPage() {
  return (
    <Suspense fallback={<div className="px-6 py-8 text-zinc-500">Loading…</div>}>
      <ArenaShell />
    </Suspense>
  );
}
