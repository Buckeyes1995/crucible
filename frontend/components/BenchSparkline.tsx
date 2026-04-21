"use client";

import { useEffect, useState } from "react";

type Point = { run_id: string; created_at: string; avg_tps: number };

export function BenchSparkline({ modelId, width = 60, height = 16 }: {
  modelId: string; width?: number; height?: number;
}) {
  const [pts, setPts] = useState<Point[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const resp = await fetch(`/api/benchmark/model/${encodeURIComponent(modelId)}/history?limit=12`);
        if (!resp.ok) return;
        const data = (await resp.json()) as Point[];
        if (alive) setPts(data.filter((p) => typeof p.avg_tps === "number" && p.avg_tps > 0));
      } catch {}
    })();
    return () => { alive = false; };
  }, [modelId]);

  if (!pts || pts.length < 2) return null;

  const values = pts.map((p) => p.avg_tps);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);

  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`)
    .join(" ");

  const last = values[values.length - 1];
  const first = values[0];
  const trend = last > first * 1.05 ? "up" : last < first * 0.95 ? "down" : "flat";
  const stroke = trend === "up" ? "#34d399" : trend === "down" ? "#f87171" : "#6366f1";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="inline-block"
      aria-label={`Last ${pts.length} benchmark runs`}
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
