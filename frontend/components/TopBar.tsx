"use client";

import { useEffect } from "react";
import { useModelsStore } from "@/lib/stores/models";
import { usePrivacyStore } from "@/lib/stores/privacy";
import { cn } from "@/lib/utils";
import { Cpu, Loader2, Eye, EyeOff } from "lucide-react";

export function TopBar() {
  const { activeModelId, loadingModelId, loadStage, syncStatus } = useModelsStore();
  const ephemeral = usePrivacyStore((s) => s.ephemeral);
  const toggleEphemeral = usePrivacyStore((s) => s.toggleEphemeral);

  useEffect(() => {
    syncStatus();
  }, [syncStatus]);

  const isLoading = !!loadingModelId;

  return (
    <div className="flex items-center gap-3 px-5 h-[var(--topbar-height)] border-b border-white/[0.04] bg-zinc-950/90 backdrop-blur-md text-xs shrink-0">
      <Cpu className="w-3.5 h-3.5 text-zinc-600" />

      {isLoading ? (
        <div className="flex items-center gap-2 text-indigo-400">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span className="font-mono truncate">{loadingModelId?.replace(/^mlx:/, "")}</span>
          {loadStage && <span className="text-zinc-600">— {loadStage}</span>}
        </div>
      ) : activeModelId ? (
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          <span className="font-mono text-zinc-300 truncate">{activeModelId.replace(/^mlx:/, "")}</span>
        </div>
      ) : (
        <span className="text-zinc-600">No model loaded</span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={toggleEphemeral}
          title={ephemeral ? "Ephemeral mode on — chats aren't saved to history" : "Ephemeral mode off — chats persist to history"}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-md border transition-colors",
            ephemeral
              ? "border-amber-700/40 bg-amber-950/30 text-amber-300"
              : "border-white/10 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900",
          )}
        >
          {ephemeral ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          <span className="text-[11px]">{ephemeral ? "Ephemeral" : "Persistent"}</span>
        </button>
      </div>
    </div>
  );
}
