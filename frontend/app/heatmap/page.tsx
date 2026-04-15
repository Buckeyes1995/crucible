"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Calendar } from "lucide-react";

const BASE = "/api";

type HeatmapData = { by_date: Record<string, number>; by_hour: Record<string, number>; by_model: Record<string, number>; total: number };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function getIntensity(count: number, max: number): string {
  if (count === 0) return "bg-zinc-800";
  const ratio = count / (max || 1);
  if (ratio < 0.25) return "bg-indigo-900";
  if (ratio < 0.5) return "bg-indigo-700";
  if (ratio < 0.75) return "bg-indigo-500";
  return "bg-indigo-400";
}

export default function HeatmapPage() {
  const [data, setData] = useState<HeatmapData | null>(null);
  useEffect(() => { fetch(`${BASE}/profiler/heatmap`).then((r) => r.json()).then(setData); }, []);

  if (!data) return <div className="p-8 text-zinc-500">Loading…</div>;

  const dates = Object.keys(data.by_date).sort();
  const maxDaily = Math.max(...Object.values(data.by_date), 1);
  const maxHourly = Math.max(...Object.values(data.by_hour), 1);

  // Build calendar grid (last 90 days)
  const today = new Date();
  const grid: { date: string; count: number; day: number }[] = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    grid.push({ date: key, count: data.by_date[key] || 0, day: d.getDay() });
  }

  // Group into weeks
  const weeks: typeof grid[] = [];
  let current: typeof grid = [];
  for (const cell of grid) {
    if (cell.day === 0 && current.length > 0) {
      weeks.push(current);
      current = [];
    }
    current.push(cell);
  }
  if (current.length > 0) weeks.push(current);

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Calendar className="w-6 h-6 text-indigo-400" />
        <h1 className="text-xl font-semibold text-zinc-100">Inference Heatmap</h1>
        <span className="text-xs text-zinc-500">{data.total.toLocaleString()} total requests</span>
      </div>

      {data.total === 0 ? (
        <div className="text-center py-16 text-zinc-500">No inference data yet. Use Chat to generate activity.</div>
      ) : (
        <>
          {/* Calendar heatmap */}
          <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4">
            <h3 className="text-sm font-medium text-zinc-400 mb-3">Last 90 Days</h3>
            <div className="flex gap-[3px]">
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-[3px]">
                  {week.map((cell) => (
                    <div key={cell.date}
                      className={cn("w-3 h-3 rounded-sm", getIntensity(cell.count, maxDaily))}
                      title={`${cell.date}: ${cell.count} requests`} />
                  ))}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-3 text-xs text-zinc-500">
              <span>Less</span>
              {["bg-zinc-800", "bg-indigo-900", "bg-indigo-700", "bg-indigo-500", "bg-indigo-400"].map((c) => (
                <div key={c} className={cn("w-3 h-3 rounded-sm", c)} />
              ))}
              <span>More</span>
            </div>
          </div>

          {/* Hour distribution */}
          <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4">
            <h3 className="text-sm font-medium text-zinc-400 mb-3">Activity by Hour</h3>
            <div className="flex items-end gap-1 h-24">
              {Array.from({ length: 24 }, (_, h) => {
                const count = data.by_hour[h] || 0;
                const height = (count / maxHourly) * 100;
                return (
                  <div key={h} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full rounded-t-sm bg-indigo-500/70" style={{ height: `${Math.max(height, 2)}%` }}
                      title={`${h}:00 — ${count} requests`} />
                    {h % 3 === 0 && <span className="text-[9px] text-zinc-600">{h}</span>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top models */}
          <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4">
            <h3 className="text-sm font-medium text-zinc-400 mb-3">Most Used Models</h3>
            <div className="space-y-2">
              {Object.entries(data.by_model).map(([name, count]) => (
                <div key={name} className="flex items-center gap-3">
                  <span className="text-sm text-zinc-300 w-48 truncate">{name}</span>
                  <div className="flex-1 h-3 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full"
                      style={{ width: `${(count / data.total) * 100}%` }} />
                  </div>
                  <span className="text-xs font-mono text-zinc-500 w-16 text-right">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
