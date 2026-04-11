"use client";

import { useEffect } from "react";
import { useModelsStore } from "@/lib/stores/models";
import { cn } from "@/lib/utils";

export function TopBar() {
  const { activeModelId, loadingModelId, loadStage, syncStatus } = useModelsStore();

  useEffect(() => {
    syncStatus();
  }, [syncStatus]);

  const isLoading = !!loadingModelId;

  return (
    <div className="flex items-center gap-3 px-5 py-2 border-b border-white/8 bg-zinc-950/80 backdrop-blur-sm text-xs">
      <span className="text-zinc-600 shrink-0">Active model</span>

      {isLoading ? (
        <div className="flex items-center gap-2 text-indigo-400">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse inline-block shrink-0" />
          <span className="font-mono truncate">{loadingModelId}</span>
          {loadStage && <span className="text-zinc-500">— {loadStage}</span>}
        </div>
      ) : activeModelId ? (
        <div className="flex items-center gap-2 text-green-400">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block shrink-0" />
          <span className="font-mono truncate text-zinc-200">{activeModelId}</span>
        </div>
      ) : (
        <span className="text-zinc-600 italic">None</span>
      )}
    </div>
  );
}
