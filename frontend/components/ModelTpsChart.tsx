"use client";

import { useEffect, useState } from "react";
import { LineChart, Line, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { api, type ModelBenchmarkPoint } from "@/lib/api";

export function ModelTpsChart({ modelId, height = 60 }: { modelId: string; height?: number }) {
  const [data, setData] = useState<ModelBenchmarkPoint[]>([]);

  useEffect(() => {
    api.benchmark.modelHistory(modelId, 20)
      .then(setData)
      .catch(() => {});
  }, [modelId]);

  if (data.length < 2) return null;

  const mean = data.reduce((s, d) => s + (d.avg_tps ?? 0), 0) / data.length;
  const latest = data.at(-1)?.avg_tps ?? null;
  const prev = data.at(-2)?.avg_tps ?? null;
  const trending = latest !== null && prev !== null ? latest - prev : 0;
  const lineColor = trending >= 0 ? "#6366f1" : "#f59e0b";

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <ReferenceLine y={mean} stroke="#ffffff15" strokeDasharray="3 3" />
          <Tooltip
            contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 11, borderRadius: 6 }}
            formatter={(v) => [`${Number(v).toFixed(1)} tok/s`, "avg"]}
            labelFormatter={(_, payload) => payload?.[0]?.payload?.run_name ?? ""}
          />
          <Line
            type="monotone"
            dataKey="avg_tps"
            stroke={lineColor}
            strokeWidth={1.5}
            dot={data.length === 1}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
