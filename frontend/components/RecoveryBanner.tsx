"use client";

// Detects a previous-process crash that had a model loaded and shows a
// restore banner. One-time check per page load, quiet if nothing to recover.

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useModelsStore } from "@/lib/stores/models";
import { toast } from "@/components/Toast";
import { AlertTriangle, X } from "lucide-react";

type Snap = { model_id: string; engine: string | null; loaded_at: number };

export function RecoveryBanner() {
  const [snap, setSnap] = useState<Snap | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const loadModel = useModelsStore((s) => s.loadModel);

  useEffect(() => {
    let cancelled = false;
    api.recovery.check().then((r) => {
      if (cancelled) return;
      if (r.available && r.snapshot) setSnap(r.snapshot);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!snap) return null;

  const minutesAgo = Math.max(1, Math.round((Date.now() - snap.loaded_at * 1000) / 60000));

  const dismiss = async () => {
    setDismissing(true);
    try { await api.recovery.dismiss(); } catch {}
    setSnap(null);
  };

  const restore = async () => {
    setRestoring(true);
    try {
      await loadModel(snap.model_id);
      toast(`Restoring ${snap.model_id}…`, "info");
      await api.recovery.dismiss();
      setSnap(null);
    } catch (e) {
      toast(`Restore failed: ${(e as Error).message}`, "error");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="px-4 py-2 bg-amber-950/40 border-b border-amber-500/30 flex items-center gap-3 text-sm text-amber-100">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <div className="flex-1 min-w-0">
        Previous session had{" "}
        <span className="font-mono text-amber-50">{snap.model_id}</span>
        {" "}loaded
        {snap.engine && <span className="text-amber-300"> via {snap.engine}</span>}
        {" "}({minutesAgo}m ago) and didn't shut down cleanly.
      </div>
      <button
        onClick={restore}
        disabled={restoring}
        className="px-2.5 py-1 rounded bg-amber-500/30 hover:bg-amber-500/40 text-amber-50 text-xs font-medium transition-colors"
      >
        {restoring ? "Restoring…" : "Restore"}
      </button>
      <button
        onClick={async () => {
          if (!confirm("Clean start? Clears the recovery snapshot and wipes finished-download history. Chat history and benchmark data are kept.")) return;
          setCleaning(true);
          try {
            const r = await api.recovery.cleanRestore();
            toast(`Clean start — ${r.downloads_cleared} download${r.downloads_cleared === 1 ? "" : "s"} removed from history`, "success");
            setSnap(null);
          } catch (e) {
            toast(`Clean start failed: ${(e as Error).message}`, "error");
          } finally {
            setCleaning(false);
          }
        }}
        disabled={cleaning}
        className="px-2.5 py-1 rounded border border-amber-400/40 text-amber-100 hover:bg-amber-500/20 text-xs font-medium transition-colors"
        title="Forget previous session entirely — keeps chat + benchmarks, wipes download history"
      >
        {cleaning ? "Wiping…" : "Clean start"}
      </button>
      <button
        onClick={dismiss}
        disabled={dismissing}
        className="px-1.5 py-1 text-amber-300 hover:text-amber-100 transition-colors"
        title="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
