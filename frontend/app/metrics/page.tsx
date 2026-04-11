"use client";

import { useEffect, useRef, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

type Point = { ts: number; value: number | null };

function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(" ");
}

function fmt(n: number | null | undefined, decimals = 1) {
  return n != null ? n.toFixed(decimals) : "—";
}

function fmtBytes(b: number) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(0) + " MB";
  return (b / 1e3).toFixed(0) + " KB";
}

export default function MetricsPage() {
  const [tpsBuffer, setTpsBuffer] = useState<Point[]>([]);
  const [promptTpsBuffer, setPromptTpsBuffer] = useState<Point[]>([]);
  const [ttftBuffer, setTtftBuffer] = useState<Point[]>([]);
  const [memBuffer, setMemBuffer] = useState<Point[]>([]);
  const [connState, setConnState] = useState<"connecting" | "connected" | "disconnected">("disconnected");
  const [lastPayload, setLastPayload] = useState<any>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket("ws://localhost:7777/ws/metrics");
      ws.onopen = () => setConnState("connected");
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLastPayload(data);
          if (data.tps != null)
            setTpsBuffer((p) => [...p, { ts: data.ts, value: data.tps }].slice(-60));
          if (data.prompt_tps != null)
            setPromptTpsBuffer((p) => [...p, { ts: data.ts, value: data.prompt_tps }].slice(-60));
          if (data.ttft_ms != null)
            setTtftBuffer((p) => [...p, { ts: data.ts, value: data.ttft_ms }].slice(-60));
          if (data.memory_pressure != null)
            setMemBuffer((p) => [...p, { ts: data.ts, value: data.memory_pressure * 100 }].slice(-60));
        } catch {}
      };
      ws.onclose = () => {
        setConnState("disconnected");
        setTimeout(connect, 2000);
      };
      ws.onerror = () => setConnState("disconnected");
      wsRef.current = ws;
    };
    connect();
    return () => wsRef.current?.close();
  }, []);

  const latestTps = tpsBuffer.at(-1)?.value ?? null;
  const latestPromptTps = promptTpsBuffer.at(-1)?.value ?? null;
  const latestTtft = ttftBuffer.at(-1)?.value ?? null;

  const thermalColors: Record<string, string> = {
    nominal: "text-green-400", fair: "text-yellow-400",
    serious: "text-orange-400", critical: "text-red-400",
  };
  const thermalBorders: Record<string, string> = {
    nominal: "border-green-500/40", fair: "border-yellow-500/40",
    serious: "border-orange-500/40", critical: "border-red-500/40",
  };
  const thermal = lastPayload?.thermal ?? "nominal";
  const statusColor = thermalColors[thermal] ?? "text-zinc-400";
  const thermalBorder = thermalBorders[thermal] ?? "border-zinc-700";

  const info = lastPayload?.model_info;
  const params = info?.params ?? {};

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Live Metrics</h1>
          <div className="flex items-center gap-3 mt-0.5">
            {lastPayload?.active_model
              ? <p className="text-xs font-mono text-zinc-400">{lastPayload.active_model}</p>
              : <p className="text-xs text-zinc-500">No model loaded</p>}
            <span className="flex items-center gap-1.5 text-xs text-zinc-500">
              {connState !== "connected" ? (
                <span className="h-2 w-2 rounded-full bg-zinc-600" />
              ) : lastPayload?.active_model ? (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inset-0 rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative rounded-full h-2 w-2 bg-emerald-500" />
                </span>
              ) : (
                <span className="h-2 w-2 rounded-full bg-zinc-500" />
              )}
              {connState !== "connected" ? "Disconnected" : lastPayload?.active_model ? "Live" : "No model loaded"}
            </span>
            <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full border capitalize", statusColor, thermalBorder)}>
              {thermal}
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Charts — 2x2 grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartCard title="Generation (tok/s)" color="#6366f1" data={tpsBuffer} domain={[0, "auto"]} />
          <ChartCard title="Prompt Eval (tok/s)" color="#a78bfa" data={promptTpsBuffer} domain={[0, "auto"]} />
          <ChartCard title="TTFT (ms)" color="#f59e0b" data={ttftBuffer} domain={[0, "auto"]} />
          <ChartCard title="Memory Pressure %" color="#10b981" data={memBuffer} domain={[0, 100]} />
        </div>

        {/* Stats row */}
        <div className="backdrop-blur border border-white/10 bg-white/5 rounded-xl p-4">
          <h3 className="text-xs font-medium text-zinc-500 mb-3">Current Values</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Gen tok/s" value={fmt(latestTps)} color="text-indigo-300" />
            <Stat label="Prompt tok/s" value={fmt(latestPromptTps)} color="text-violet-300" />
            <Stat label="TTFT (ms)" value={fmt(latestTtft, 0)} color="text-amber-300" />
            <Stat label="Memory" value={lastPayload?.memory_used_gb
              ? `${Number(lastPayload.memory_used_gb).toFixed(1)}/${Number(lastPayload.memory_total_gb).toFixed(1)} GB` : "—"}
              sub={lastPayload?.memory_pressure != null ? `${(lastPayload.memory_pressure * 100).toFixed(0)}% pressure` : undefined}
              color="text-emerald-300" nowrap />
          </div>
        </div>

        {/* Model params card */}
        {info && (
          <div className="backdrop-blur border border-white/10 bg-white/5 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-zinc-500">Active Model</h3>
              <div className="flex items-center gap-2">
                {info.quant && <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{info.quant}</span>}
                <span className={cn("text-xs px-1.5 py-0.5 rounded font-medium",
                  info.kind === "mlx" ? "bg-indigo-900/50 text-indigo-300" :
                  info.kind === "gguf" ? "bg-amber-900/50 text-amber-300" :
                  "bg-emerald-900/50 text-emerald-300"
                )}>{info.kind?.toUpperCase()}</span>
              </div>
            </div>
            <p className="text-sm font-mono text-zinc-200 mb-3 truncate">{info.name}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
              <ParamRow label="Context" value={info.context_window ? info.context_window.toLocaleString() + " tok" : "—"} />
              <ParamRow label="Size" value={info.size_bytes ? fmtBytes(info.size_bytes) : "—"} />
              <ParamRow label="Temperature" value={fmt(params.temperature)} />
              <ParamRow label="Max tokens" value={params.max_tokens?.toString() ?? "—"} />
              <ParamRow label="Top-K" value={params.top_k?.toString() ?? "—"} />
              <ParamRow label="Top-P" value={fmt(params.top_p)} />
              <ParamRow label="Min-P" value={fmt(params.min_p)} />
              <ParamRow label="Rep. penalty" value={fmt(params.repetition_penalty)} />
              {params.ttl_minutes ? <ParamRow label="TTL" value={`${params.ttl_minutes}m`} /> : null}
              {params.context_window ? <ParamRow label="Ctx override" value={params.context_window.toLocaleString()} /> : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ChartCard({ title, color, data, domain }: {
  title: string; color: string; data: Point[]; domain: [number | string, number | string];
}) {
  return (
    <div className="backdrop-blur border border-white/10 bg-white/5 rounded-xl p-4">
      <h3 className="text-xs font-medium text-zinc-500 mb-3">{title}</h3>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid stroke="#ffffff10" vertical={false} />
            <XAxis dataKey="ts" hide />
            <YAxis domain={domain} tick={{ fill: "#94a3b8", fontSize: 11 }} stroke="#ffffff10" width={36} />
            <Tooltip
              contentStyle={{ backgroundColor: "#18181b", border: "1px solid #27272a", color: "#f8fafc", fontSize: 12 }}
              itemStyle={{ color }}
            />
            <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, color, nowrap, capitalize }: {
  label: string; value: string; sub?: string; color?: string; nowrap?: boolean; capitalize?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-zinc-500 mb-0.5">{label}</p>
      <p className={cn("text-xl font-mono", color ?? "text-zinc-100", nowrap && "whitespace-nowrap", capitalize && "capitalize")}>
        {value}
      </p>
      {sub && <p className="text-xs text-zinc-200 mt-0.5">{sub}</p>}
    </div>
  );
}

function ParamRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-zinc-500 shrink-0">{label}</span>
      <span className="text-xs font-mono text-zinc-300">{value}</span>
    </div>
  );
}
