"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Bell, Check, CheckCheck, Download, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "@/components/Toast";

type NotifMeta = {
  kind?: string;
  model_id?: string;
  model_kind?: string;
  repo_id?: string;
};

type Notif = {
  id: string;
  title: string;
  message: string;
  type: string;
  link: string;
  read: boolean;
  ts: number;
  meta?: NotifMeta;
};

const TYPE_COLORS: Record<string, string> = {
  info: "border-indigo-500/30",
  success: "border-emerald-500/30",
  warning: "border-amber-500/30",
  error: "border-red-500/30",
};

export default function AlertsTab() {
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [pendingJobs, setPendingJobs] = useState<Record<string, { jobId: string; modelId: string; repo: string }>>({});
  const pollRef = useRef<number | null>(null);

  const load = useCallback(() => fetch("/api/notifications").then((r) => r.json()).then(setNotifs), []);
  useEffect(() => { load(); }, [load]);

  const markRead = async (id: string) => { await fetch(`/api/notifications/${id}/read`, { method: "POST" }); load(); };
  const markAllRead = async () => { await fetch("/api/notifications/read-all", { method: "POST" }); load(); };

  const startReplace = async (n: Notif) => {
    const { model_id, model_kind, repo_id } = n.meta ?? {};
    if (!model_id || !repo_id) return;
    if (!confirm(
      `Download ${repo_id} and replace the existing ${model_id}?\n\n` +
      `The new version is staged into a sibling directory; the existing model is kept untouched until the download completes successfully, then atomically swapped in. A failed download leaves the old model in place.`,
    )) return;

    try {
      const job = await api.hf.startDownload(repo_id, model_kind || "mlx", undefined, model_id);
      setPendingJobs((m) => ({ ...m, [n.id]: { jobId: job.job_id, modelId: model_id, repo: repo_id } }));
      toast(`Downloading ${repo_id} — old version stays until swap succeeds`, "success");
      await fetch(`/api/notifications/${n.id}/read`, { method: "POST" });
      load();
    } catch (e) {
      toast(`Download failed to start: ${(e as Error).message}`, "error");
    }
  };

  // Poll downloads we kicked off. When one finishes, delete the corresponding old model.
  useEffect(() => {
    if (Object.keys(pendingJobs).length === 0) {
      if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = window.setInterval(async () => {
      const jobs = await api.hf.listDownloads().catch(() => []);
      const updates: Record<string, { jobId: string; modelId: string; repo: string }> = { ...pendingJobs };
      let changed = false;
      for (const [notifId, info] of Object.entries(pendingJobs)) {
        const j = jobs.find((x) => x.job_id === info.jobId);
        if (!j) continue;
        if (j.status === "done") {
          // Backend owns the atomic swap when replace_model_id was set on
          // the download. No separate deleteFromDisk call needed (and doing
          // it would be harmful — it would delete the freshly-swapped model).
          toast(`Replaced ${info.modelId} with ${info.repo}`, "success");
          delete updates[notifId];
          changed = true;
        } else if (j.status === "error" || j.status === "cancelled") {
          toast(`Download ${info.repo} ${j.status} — old version kept`, "error");
          delete updates[notifId];
          changed = true;
        }
      }
      if (changed) setPendingJobs(updates);
    }, 4000);
    return () => {
      if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [pendingJobs]);

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bell className="w-6 h-6 text-indigo-400" />
          <h1 className="text-xl font-semibold text-zinc-100">Notifications</h1>
          <span className="text-xs text-zinc-500">{notifs.filter((n) => !n.read).length} unread</span>
        </div>
        <Button variant="ghost" onClick={markAllRead} className="gap-1.5 text-xs">
          <CheckCheck className="w-3.5 h-3.5" /> Mark all read
        </Button>
      </div>
      {notifs.length === 0 ? (
        <div className="text-center py-16 text-zinc-500">No notifications</div>
      ) : (
        notifs.map((n) => {
          const isUpdate = n.meta?.kind === "model_update" && n.meta?.model_id && n.meta?.repo_id;
          const pending = pendingJobs[n.id];
          return (
            <div
              key={n.id}
              className={cn(
                "px-4 py-3 rounded-xl border bg-zinc-900/50 transition-opacity",
                TYPE_COLORS[n.type] ?? "border-white/10",
                n.read && "opacity-50",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-zinc-200">{n.title}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{n.message}</div>
                  <div className="text-[10px] text-zinc-600 mt-1">{new Date(n.ts * 1000).toLocaleString()}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {isUpdate && (
                    pending ? (
                      <Button variant="ghost" disabled className="gap-1.5 text-xs">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Downloading…
                      </Button>
                    ) : (
                      <Button variant="primary" size="sm" className="gap-1.5" onClick={() => startReplace(n)}>
                        <Download className="w-3.5 h-3.5" /> Update &amp; replace
                      </Button>
                    )
                  )}
                  {!n.read && (
                    <Button variant="ghost" className="px-2" onClick={() => markRead(n.id)}>
                      <Check className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
