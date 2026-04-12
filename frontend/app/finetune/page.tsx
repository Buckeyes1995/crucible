"use client";

import { useEffect, useRef, useState } from "react";
import { api, readSSE, type FinetuneJob, type ModelEntry } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import { Play, Square, Trash2, ChevronDown, ChevronRight } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  queued: "text-zinc-400",
  running: "text-indigo-400",
  done: "text-green-400",
  error: "text-red-400",
  cancelled: "text-zinc-500",
};

export default function FinetunePage() {
  const [jobs, setJobs] = useState<FinetuneJob[]>([]);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [lossData, setLossData] = useState<{ iter: number; loss: number; val_loss?: number }[]>([]);
  const [streaming, setStreaming] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  // Form state
  const [modelId, setModelId] = useState("");
  const [dataPath, setDataPath] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [numIters, setNumIters] = useState(1000);
  const [lr, setLr] = useState(0.0001);
  const [loraRank, setLoraRank] = useState(8);
  const [batchSize, setBatchSize] = useState(4);
  const [gradCkpt, setGradCkpt] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.finetune.list().then(setJobs).catch(() => {});
    api.models.list().then((ms) => {
      setModels(ms.filter((m) => m.kind === "mlx"));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [logs]);

  async function handleCreate() {
    if (!modelId || !dataPath || !outputDir) return;
    setCreating(true);
    try {
      const job = await api.finetune.create({
        model_id: modelId, data_path: dataPath, output_dir: outputDir,
        num_iters: numIters, learning_rate: lr, lora_rank: loraRank,
        batch_size: batchSize, grad_checkpoint: gradCkpt,
      });
      setJobs((prev) => [job, ...prev]);
    } finally { setCreating(false); }
  }

  async function handleRun(jobId: string) {
    if (streaming) return;
    setActiveJobId(jobId);
    setLogs([]);
    setLossData([]);
    setStreaming(true);
    setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, status: "running" } : j));

    try {
      const resp = await api.finetune.run(jobId);
      await readSSE(resp, (evt) => {
        const event = evt.event as string;
        if (event === "progress") {
          setLossData((prev) => [
            ...prev,
            { iter: evt.iter as number, loss: evt.loss as number, val_loss: (evt.val_loss as number | null) ?? undefined },
          ]);
          if (evt.log) setLogs((prev) => [...prev, evt.log as string]);
        } else if (event === "log") {
          setLogs((prev) => [...prev, evt.log as string]);
        } else if (event === "done") {
          setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, status: "done" } : j));
          setStreaming(false);
        } else if (event === "error") {
          setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, status: "error", error: String(evt.message) } : j));
          setStreaming(false);
        } else if (event === "cancelled") {
          setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, status: "cancelled" } : j));
          setStreaming(false);
        }
      });
    } catch {
      setStreaming(false);
    }
  }

  async function handleCancel(jobId: string) {
    await api.finetune.cancel(jobId).catch(() => {});
    setStreaming(false);
    setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, status: "cancelled" } : j));
  }

  async function handleDelete(jobId: string) {
    await api.finetune.delete(jobId).catch(() => {});
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
    if (activeJobId === jobId) { setActiveJobId(null); setLogs([]); setLossData([]); }
  }

  const activeJob = jobs.find((j) => j.id === activeJobId);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-6 py-4 border-b border-white/10">
        <h1 className="text-xl font-bold text-zinc-100">Fine-tune</h1>
        <p className="text-xs text-zinc-500 mt-0.5">Launch MLX LoRA fine-tuning jobs and monitor training loss</p>
      </div>

      <div className="flex flex-1 min-h-0 gap-0">
        {/* Left panel: config + job list */}
        <div className="w-80 shrink-0 flex flex-col border-r border-white/10 overflow-y-auto">
          {/* New job form */}
          <div className="p-4 space-y-3 border-b border-white/10">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">New Job</p>

            <div className="space-y-1">
              <label className="text-xs text-zinc-500">Base Model (MLX)</label>
              <select value={modelId} onChange={(e) => setModelId(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500">
                <option value="">— select —</option>
                {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-zinc-500">Dataset path (local dir with train.jsonl)</label>
              <input value={dataPath} onChange={(e) => setDataPath(e.target.value)}
                placeholder="/path/to/data"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500" />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-zinc-500">Output / adapter path</label>
              <input value={outputDir} onChange={(e) => setOutputDir(e.target.value)}
                placeholder="/path/to/adapters"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-zinc-500">Iterations</label>
                <input type="number" value={numIters} onChange={(e) => setNumIters(+e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-500">Learning rate</label>
                <input type="number" step="0.00001" value={lr} onChange={(e) => setLr(+e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-500">LoRA rank</label>
                <input type="number" value={loraRank} onChange={(e) => setLoraRank(+e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-500">Batch size</label>
                <input type="number" value={batchSize} onChange={(e) => setBatchSize(+e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500" />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
              <input type="checkbox" checked={gradCkpt} onChange={(e) => setGradCkpt(e.target.checked)}
                className="accent-indigo-500" />
              Gradient checkpointing
            </label>

            <Button variant="primary" className="w-full" onClick={handleCreate}
              disabled={creating || !modelId || !dataPath || !outputDir}>
              {creating ? "Creating…" : "Create Job"}
            </Button>
          </div>

          {/* Job list */}
          <div className="flex-1 overflow-y-auto">
            {jobs.length === 0 && (
              <div className="p-4 text-xs text-zinc-600 text-center">No fine-tune jobs yet</div>
            )}
            {jobs.map((job) => (
              <div
                key={job.id}
                onClick={() => { setActiveJobId(job.id); setLossData(job.loss_log.map((l) => ({ iter: l.iter, loss: l.loss, val_loss: l.val_loss ?? undefined }))); setLogs([]); }}
                className={cn(
                  "px-4 py-3 border-b border-white/5 cursor-pointer hover:bg-zinc-800/40 transition-colors",
                  activeJobId === job.id ? "bg-zinc-800/60" : ""
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-mono text-zinc-300 truncate">{job.model_id.split("/").pop()}</div>
                    <div className={cn("text-xs mt-0.5 capitalize", STATUS_COLORS[job.status])}>{job.status}</div>
                  </div>
                  <div className="flex gap-1">
                    {job.status === "queued" && (
                      <button onClick={(e) => { e.stopPropagation(); handleRun(job.id); }}
                        className="p-1.5 rounded hover:bg-zinc-700 text-indigo-400">
                        <Play className="w-3 h-3" />
                      </button>
                    )}
                    {job.status === "running" && (
                      <button onClick={(e) => { e.stopPropagation(); handleCancel(job.id); }}
                        className="p-1.5 rounded hover:bg-zinc-700 text-amber-400">
                        <Square className="w-3 h-3" />
                      </button>
                    )}
                    {job.status !== "running" && (
                      <button onClick={(e) => { e.stopPropagation(); handleDelete(job.id); }}
                        className="p-1.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-red-400">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right panel: loss chart + logs */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {!activeJob ? (
            <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
              Create a job and click Run to start training
            </div>
          ) : (
            <>
              {/* Job info */}
              <div className="px-6 py-3 border-b border-white/5 flex items-center gap-4">
                <div>
                  <span className="text-xs font-semibold text-zinc-300">{activeJob.model_id.split("/").pop()}</span>
                  <span className={cn("text-xs ml-2 capitalize", STATUS_COLORS[activeJob.status])}>{activeJob.status}</span>
                </div>
                <div className="flex gap-3 text-xs text-zinc-500 font-mono">
                  <span>{activeJob.num_iters} iters</span>
                  <span>lr={activeJob.learning_rate}</span>
                  <span>rank={activeJob.lora_rank}</span>
                </div>
                {activeJob.status === "error" && (
                  <span className="text-xs text-red-400 ml-2">{activeJob.error}</span>
                )}
              </div>

              {/* Loss chart */}
              <div className="px-6 py-4 border-b border-white/5" style={{ height: 240 }}>
                {lossData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-zinc-600 text-xs">
                    {activeJob.status === "running" ? "Waiting for first loss value…" : "No loss data"}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={lossData} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                      <XAxis dataKey="iter" tick={{ fill: "#71717a", fontSize: 10 }} />
                      <YAxis tick={{ fill: "#71717a", fontSize: 10 }} width={40} />
                      <Tooltip
                        contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6 }}
                        labelStyle={{ color: "#a1a1aa" }}
                        itemStyle={{ color: "#e4e4e7" }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11, color: "#71717a" }} />
                      <Line type="monotone" dataKey="loss" stroke="#6366f1" strokeWidth={1.5} dot={false} name="Train loss" />
                      <Line type="monotone" dataKey="val_loss" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Val loss" />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Log output */}
              <div ref={logRef} className="flex-1 overflow-y-auto px-6 py-3 font-mono text-xs text-zinc-400 space-y-0.5 bg-zinc-950/50">
                {logs.length === 0 && activeJob.status !== "running" && (
                  <div className="text-zinc-600">No log output</div>
                )}
                {logs.map((line, i) => (
                  <div key={i} className="leading-relaxed">{line}</div>
                ))}
                {streaming && activeJobId === activeJob.id && (
                  <div className="text-indigo-400 animate-pulse">▌</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
