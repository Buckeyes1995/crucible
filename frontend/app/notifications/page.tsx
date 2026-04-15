"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Bell, Check, CheckCheck } from "lucide-react";

type Notif = { id: string; title: string; message: string; type: string; link: string; read: boolean; ts: number };

const TYPE_COLORS: Record<string, string> = { info: "border-indigo-500/30", success: "border-emerald-500/30", warning: "border-amber-500/30", error: "border-red-500/30" };

export default function NotificationsPage() {
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const load = () => fetch("/api/notifications").then(r => r.json()).then(setNotifs);
  useEffect(() => { load(); }, []);

  const markRead = async (id: string) => { await fetch(`/api/notifications/${id}/read`, { method: "POST" }); load(); };
  const markAllRead = async () => { await fetch("/api/notifications/read-all", { method: "POST" }); load(); };

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bell className="w-6 h-6 text-indigo-400" />
          <h1 className="text-xl font-semibold text-zinc-100">Notifications</h1>
          <span className="text-xs text-zinc-500">{notifs.filter(n => !n.read).length} unread</span>
        </div>
        <Button variant="ghost" onClick={markAllRead} className="gap-1.5 text-xs"><CheckCheck className="w-3.5 h-3.5" /> Mark all read</Button>
      </div>
      {notifs.length === 0 ? <div className="text-center py-16 text-zinc-500">No notifications</div> :
        notifs.map((n) => (
          <div key={n.id} className={cn("px-4 py-3 rounded-xl border bg-zinc-900/50 transition-opacity",
            TYPE_COLORS[n.type] ?? "border-white/10", n.read && "opacity-50")}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm font-medium text-zinc-200">{n.title}</div>
                <div className="text-xs text-zinc-500 mt-0.5">{n.message}</div>
                <div className="text-[10px] text-zinc-600 mt-1">{new Date(n.ts * 1000).toLocaleString()}</div>
              </div>
              {!n.read && <Button variant="ghost" className="px-2" onClick={() => markRead(n.id)}><Check className="w-3.5 h-3.5" /></Button>}
            </div>
          </div>
        ))
      }
    </div>
  );
}
