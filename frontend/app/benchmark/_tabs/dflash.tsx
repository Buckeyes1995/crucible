"use client";

import { useEffect, useState } from "react";
import { api, type ModelEntry } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Bolt, Play, Loader2, AlertTriangle } from "lucide-react";
import { BarChart, Bar, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend } from "recharts";

type BenchResult = {
  tps: number | null;
  ttft_ms: number | null;
  output_tokens: number;
  total_ms: number;
};

type BenchSummary = {
  model: string;
  prompts_count: number;
  normal: { avg_tps: number; avg_ttft_ms: number; results: BenchResult[] };
  dflash: { avg_tps: number; avg_ttft_ms: number; results: BenchResult[] };
  speedup: number;
};

type PresetInfo = { label: string; description: string; max_tokens: number; count: number };

export default function DFlashTab() {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [presets, setPresets] = useState<Record<string, PresetInfo>>({});
  const [selectedPreset, setSelectedPreset] = useState<string>("quick");
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string>("");
  const [step, setStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);
  const [summary, setSummary] = useState<BenchSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveResults, setLiveResults] = useState<{ normal: BenchResult[]; dflash: BenchResult[] }>({ normal: [], dflash: [] });
  const [stageMsg, setStageMsg] = useState<string>("");
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [currentPromptIdx, setCurrentPromptIdx] = useState<number | null>(null);

  useEffect(() => {
    api.models.list().then((all) => {
      // Include both models with a local draft AND models with a z-lab draft available
      // to download. The bench auto-downloads the draft if needed.
      const eligible = all.filter((m) => m.dflash_draft || m.available_draft_repo);
      // Sort: locally-ready drafts first, then downloadable ones
      eligible.sort((a, b) => {
        const aReady = a.dflash_draft ? 0 : 1;
        const bReady = b.dflash_draft ? 0 : 1;
        return aReady - bReady || a.name.localeCompare(b.name);
      });
      setModels(eligible);
      if (eligible.length > 0) setSelectedModel(eligible[0].id);
    });
    fetch(`/api/dflash/presets`).then(r => r.json()).then(setPresets).catch(() => {});
  }, []);

  async function runBenchmark() {
    if (!selectedModel) return;
    setRunning(true);
    setError(null);
    setSummary(null);
    setStep(0);
    setLiveResults({ normal: [], dflash: [] });
    setStageMsg("Starting bench…");
    setDownloadProgress(null);
    setCurrentPromptIdx(null);
    setPhase("");

    try {
      // Kick off the bench — returns { run_id } immediately
      const startResp = await fetch("/api/dflash/bench/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: selectedModel, preset: selectedPreset, temperature: 0.7 }),
      });
      if (!startResp.ok) throw new Error(`start failed: ${startResp.status}`);
      const { run_id } = (await startResp.json()) as { run_id: string };

      setTotalSteps(0); // will be derived from prompts_count after first poll

      // Poll status every 1s until done or error
      let keepGoing = true;
      while (keepGoing) {
        await new Promise((r) => setTimeout(r, 1000));
        const snapResp = await fetch(`/api/dflash/bench/${run_id}`);
        if (!snapResp.ok) {
          if (snapResp.status === 404) {
            setError("Bench run was rotated out before completion");
            break;
          }
          continue;
        }
        const snap = await snapResp.json();
        setPhase((snap.phase as string) ?? "");
        setStageMsg((snap.stage_msg as string) ?? "");
        setTotalSteps(((snap.prompts_count as number) ?? 0) * 2);
        if (typeof snap.download_progress === "number") {
          setDownloadProgress(snap.download_progress * 100);
        } else if (snap.download_progress === null) {
          setDownloadProgress(null);
        }
        setCurrentPromptIdx(snap.current_prompt_index ?? null);
        const newNormal = (snap.results_normal as BenchResult[]) ?? [];
        const newDflash = (snap.results_dflash as BenchResult[]) ?? [];
        setLiveResults({ normal: newNormal, dflash: newDflash });
        setStep(newNormal.length + newDflash.length);

        if (snap.status === "done") {
          if (snap.summary) setSummary(snap.summary as BenchSummary);
          setStageMsg("Done.");
          keepGoing = false;
        } else if (snap.status === "error") {
          setError((snap.error as string) ?? "Bench failed");
          keepGoing = false;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Benchmark failed");
    } finally {
      setRunning(false);
      setPhase("");
    }
  }

  const chartData = summary
    ? [
        { name: "Normal", tps: summary.normal.avg_tps, fill: "#6366f1" },
        { name: "DFlash", tps: summary.dflash.avg_tps, fill: "#f59e0b" },
      ]
    : [];

  const ttftData = summary
    ? [
        { name: "Normal", ttft: summary.normal.avg_ttft_ms, fill: "#6366f1" },
        { name: "DFlash", ttft: summary.dflash.avg_ttft_ms, fill: "#f59e0b" },
      ]
    : [];

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Bolt className="w-6 h-6 text-amber-400" />
        <h1 className="text-xl font-semibold text-zinc-100">DFlash Benchmark</h1>
        <span className="text-xs text-zinc-500">Compare speculative decoding speed</span>
        <span className="ml-auto text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-500">
          debug: {models.length} models · phase={phase || "—"} · running={running ? "yes" : "no"} · stage={stageMsg.slice(0, 40)}
        </span>
      </div>

      {/* Controls */}
      <div className="p-4 rounded-2xl border border-white/[0.06] bg-zinc-900/40 backdrop-blur space-y-3">
        <div className="flex items-center gap-4">
          <select
            className="flex-1 bg-zinc-800 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-zinc-200"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={running}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}{m.dflash_draft ? "" : "  (draft will be downloaded)"}
              </option>
            ))}
          </select>
          <Button onClick={runBenchmark} disabled={running || !selectedModel} variant="primary" className="gap-2 min-w-[160px]">
            {running ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> {phase === "dflash" ? "DFlash…" : "Normal…"}</>
            ) : (
              <><Play className="w-4 h-4" /> Run Benchmark</>
            )}
          </Button>
        </div>

        {Object.keys(presets).length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs text-zinc-500 uppercase tracking-wider font-medium">Prompt preset</div>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(presets).map(([key, info]) => (
                <button
                  key={key}
                  onClick={() => setSelectedPreset(key)}
                  disabled={running}
                  className={cn(
                    "text-left p-3 rounded-lg border transition-colors",
                    selectedPreset === key
                      ? "border-amber-500/50 bg-amber-900/20"
                      : "border-white/[0.06] bg-zinc-800/40 hover:border-white/[0.12]"
                  )}
                >
                  <div className="text-sm font-medium text-zinc-100">{info.label}</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2">{info.description}</div>
                  <div className="text-[10px] text-zinc-600 font-mono mt-1.5">
                    {info.count} prompt{info.count === 1 ? "" : "s"} · {info.max_tokens} max tokens
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Live progress panel */}
      {running && (
        <div className="space-y-3 p-4 rounded-2xl border border-white/[0.06] bg-zinc-900/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              <div
                className={cn(
                  "flex items-center gap-2 px-3 py-1 rounded-lg border text-sm font-semibold",
                  phase === "dflash"
                    ? "border-amber-500/50 bg-amber-900/25 text-amber-300"
                    : phase === "normal"
                    ? "border-zinc-500/50 bg-zinc-800/50 text-zinc-200"
                    : "border-zinc-600/40 bg-zinc-800/30 text-zinc-400"
                )}
              >
                <Bolt className={cn("w-4 h-4", phase === "dflash" ? "text-amber-400" : phase === "normal" ? "text-zinc-500 opacity-40" : "opacity-30")} />
                <span>
                  DFlash: {phase === "dflash" ? "ON" : phase === "normal" ? "OFF" : "—"}
                </span>
                {phase && (
                  <span className="text-[10px] text-zinc-500 font-normal">
                    · {phase === "dflash" ? "speculative decoding engaged" : "baseline generation"}
                  </span>
                )}
              </div>
            </div>
            {totalSteps > 0 && <span className="font-mono text-xs text-zinc-500">{step}/{totalSteps} prompts</span>}
          </div>

          {stageMsg && (
            <div className="text-xs text-zinc-300 font-mono truncate">{stageMsg}</div>
          )}

          {downloadProgress !== null && (
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-amber-500 transition-all"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
          )}

          {totalSteps > 0 && (
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all"
                style={{ width: `${(step / totalSteps) * 100}%` }}
              />
            </div>
          )}

          {(liveResults.normal.length > 0 || liveResults.dflash.length > 0) && (() => {
            // Shared y-axis scale so the two charts are directly visually comparable
            const allTps = [...liveResults.normal, ...liveResults.dflash].map(r => r.tps).filter((t): t is number => t != null);
            const maxTps = allTps.length > 0 ? Math.ceil(Math.max(...allTps) * 1.1) : 60;
            const normalData = liveResults.normal.map((r, i) => ({ prompt: `P${i + 1}`, tps: r.tps }));
            const dflashData = liveResults.dflash.map((r, i) => ({ prompt: `P${i + 1}`, tps: r.tps }));
            return (
              <div className="pt-2 border-t border-white/[0.04] space-y-2">
                <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Live tok/s</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-zinc-500/20 bg-zinc-900/30 p-2">
                    <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-medium mb-1 flex items-center gap-1.5">
                      <Bolt className="w-3 h-3 opacity-30" /> DFlash OFF {liveResults.normal.length > 0 && <span className="text-zinc-500 font-mono normal-case">· avg {(liveResults.normal.reduce((s, r) => s + (r.tps ?? 0), 0) / Math.max(liveResults.normal.length, 1)).toFixed(1)} tok/s</span>}
                    </div>
                    <ResponsiveContainer width="100%" height={130}>
                      <LineChart data={normalData} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                        <XAxis dataKey="prompt" tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis domain={[0, maxTps]} tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", fontSize: 12 }} />
                        <Line type="monotone" dataKey="tps" stroke="#6366f1" strokeWidth={2} dot={{ r: 3, fill: "#6366f1" }} isAnimationActive={false} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="rounded-lg border border-amber-500/20 bg-amber-900/10 p-2">
                    <div className="text-[11px] uppercase tracking-wider text-amber-400 font-medium mb-1 flex items-center gap-1.5">
                      <Bolt className="w-3 h-3" /> DFlash ON {liveResults.dflash.length > 0 && <span className="text-zinc-500 font-mono normal-case">· avg {(liveResults.dflash.reduce((s, r) => s + (r.tps ?? 0), 0) / Math.max(liveResults.dflash.length, 1)).toFixed(1)} tok/s</span>}
                    </div>
                    <ResponsiveContainer width="100%" height={130}>
                      <LineChart data={dflashData} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                        <XAxis dataKey="prompt" tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis domain={[0, maxTps]} tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", fontSize: 12 }} />
                        <Line type="monotone" dataKey="tps" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: "#f59e0b" }} isAnimationActive={false} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                  <div>
                    {liveResults.normal.length === 0 ? <span className="text-zinc-600">pending…</span> : liveResults.normal.map((r, i) => (
                      <div key={i} className="flex justify-between"><span className="text-zinc-500">prompt {i + 1}</span><span className="text-indigo-300">{r.tps ?? "—"} tok/s</span></div>
                    ))}
                  </div>
                  <div>
                    {liveResults.dflash.length === 0 ? <span className="text-zinc-600">pending…</span> : liveResults.dflash.map((r, i) => (
                      <div key={i} className="flex justify-between"><span className="text-zinc-500">prompt {i + 1}</span><span className="text-amber-300">{r.tps ?? "—"} tok/s</span></div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}

          {currentPromptIdx !== null && (
            <div className="text-[11px] text-zinc-500 italic">
              Generating prompt {currentPromptIdx + 1}… (can take 30–60s for 512 tokens)
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-900/30 border border-red-500/40 text-red-200 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium text-red-300 mb-0.5">Benchmark failed</div>
            <div className="text-red-200/90">{error}</div>
          </div>
        </div>
      )}

      {/* Results */}
      {summary && (
        <div className="space-y-6">
          {/* Speedup hero */}
          <div className="text-center py-6 rounded-xl border border-amber-500/20 bg-amber-900/10">
            <div className="text-5xl font-bold text-amber-400 font-mono">{summary.speedup}x</div>
            <div className="text-sm text-zinc-400 mt-1">DFlash speedup on {summary.model}</div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4">
              <h3 className="text-sm font-medium text-zinc-400 mb-3">Throughput (tok/s)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData}>
                  <XAxis dataKey="name" tick={{ fill: "#a1a1aa", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#a1a1aa", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }} />
                  <Bar dataKey="tps" radius={[6, 6, 0, 0]}>
                    {chartData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4">
              <h3 className="text-sm font-medium text-zinc-400 mb-3">Time to First Token (ms)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={ttftData}>
                  <XAxis dataKey="name" tick={{ fill: "#a1a1aa", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#a1a1aa", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }} />
                  <Bar dataKey="ttft" radius={[6, 6, 0, 0]}>
                    {ttftData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Per-prompt table */}
          <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.04] text-zinc-500 text-xs uppercase tracking-wider">
                  <th className="px-4 py-3 text-left">Prompt</th>
                  <th className="px-4 py-3 text-right">Normal tok/s</th>
                  <th className="px-4 py-3 text-right">DFlash tok/s</th>
                  <th className="px-4 py-3 text-right">Speedup</th>
                </tr>
              </thead>
              <tbody>
                {summary.normal.results.map((nr, i) => {
                  const dr = summary.dflash.results[i];
                  const sp = nr.tps && dr?.tps ? (dr.tps / nr.tps).toFixed(2) : "—";
                  return (
                    <tr key={i} className="border-b border-white/[0.04]">
                      <td className="px-4 py-2.5 text-zinc-400">Prompt {i + 1}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-indigo-300">{nr.tps ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-amber-300">{dr?.tps ?? "—"}</td>
                      <td className={cn("px-4 py-2.5 text-right font-mono font-semibold", sp !== "—" && parseFloat(sp) > 1 ? "text-green-400" : "text-zinc-400")}>
                        {sp}x
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!summary && !running && models.length === 0 && (
        <div className="text-center py-16 text-zinc-500">
          No DFlash-eligible models found. DFlash requires a matching *-DFlash draft model directory.
        </div>
      )}
    </div>
  );
}
