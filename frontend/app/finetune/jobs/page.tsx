"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/Toast";
import { cn } from "@/lib/utils";
import { useModelsStore } from "@/lib/stores/models";
import {
  GraduationCap, Plus, Trash2, X as XIcon, PlayCircle, Copy,
} from "lucide-react";

type Job = {
  id: string;
  name: string;
  base_model_id: string;
  dataset_path: string;
  lora_rank: number;
  lora_alpha: number;
  learning_rate: number;
  max_steps: number;
  status: "draft" | "queued" | "running" | "done" | "error" | "cancelled";
  adapter_path?: string | null;
  log_path?: string | null;
  train_loss?: [number, number][];
  eval_loss?: [number, number][];
  error?: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
};

const STATUS_COLOR: Record<Job["status"], string> = {
  draft: "bg-zinc-800 text-zinc-400 border-white/10",
  queued: "bg-indigo-900/30 text-indigo-300 border-indigo-500/30",
  running: "bg-amber-900/30 text-amber-300 border-amber-500/30 animate-pulse",
  done: "bg-emerald-900/30 text-emerald-300 border-emerald-500/30",
  error: "bg-red-900/30 text-red-300 border-red-500/30",
  cancelled: "bg-zinc-800 text-zinc-500 border-white/10",
};

export default function FinetuneJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<Job | null>(null);
  const [openNew, setOpenNew] = useState(false);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/finetune/jobs");
    if (r.ok) setJobs(await r.json());
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 5000); return () => clearInterval(id); }, [refresh]);

  const del = async (j: Job) => {
    if (!confirm(`Delete job "${j.name}"? (doesn't touch the adapter on disk.)`)) return;
    await fetch(`/api/finetune/jobs/${j.id}`, { method: "DELETE" });
    if (selected?.id === j.id) setSelected(null);
    refresh();
  };

  const openJob = async (j: Job) => {
    const r = await fetch(`/api/finetune/jobs/${j.id}`);
    if (r.ok) setSelected(await r.json());
  };

  return (
    <div className="flex h-full min-h-screen">
      <div className="w-96 border-r border-white/[0.04] flex flex-col">
        <div className="px-4 py-3 border-b border-white/[0.04]">
          <PageHeader
            icon={<GraduationCap className="w-5 h-5" />}
            title="LoRA Jobs"
            description="Draft + track loss curves (CLI runner bridge)"
          >
            <Button variant="primary" size="sm" onClick={() => setOpenNew(true)} className="gap-1.5">
              <Plus className="w-3.5 h-3.5" /> New job
            </Button>
          </PageHeader>
        </div>
        <div className="flex-1 overflow-y-auto">
          {jobs.length === 0 ? (
            <p className="p-6 text-sm text-zinc-500 text-center">
              No jobs yet. Create a job to get a runnable CLI command and start tracking loss.
            </p>
          ) : (
            <ul>
              {jobs.map(j => (
                <li
                  key={j.id}
                  onClick={() => openJob(j)}
                  className={cn(
                    "group px-4 py-2.5 border-b border-white/[0.04] cursor-pointer hover:bg-zinc-900/60",
                    selected?.id === j.id && "bg-indigo-950/20",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-zinc-200 truncate flex-1">{j.name}</span>
                    <button onClick={(e) => { e.stopPropagation(); del(j); }} className="text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100"><Trash2 className="w-3 h-3" /></button>
                  </div>
                  <div className="flex gap-2 text-[10px] mt-0.5">
                    <span className={cn("px-1.5 py-0.5 rounded border font-mono", STATUS_COLOR[j.status])}>{j.status}</span>
                    <span className="text-zinc-500 truncate font-mono">{j.base_model_id.replace(/^mlx:/, "")}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
            Pick a job on the left, or <strong className="mx-1 text-zinc-300">New job</strong>.
          </div>
        ) : (
          <JobDetail key={selected.id} job={selected} refresh={() => openJob(selected)} />
        )}
      </div>

      {openNew && <NewJobDialog onClose={() => setOpenNew(false)} onCreated={() => { setOpenNew(false); refresh(); }} />}
    </div>
  );
}

function JobDetail({ job, refresh }: { job: Job; refresh: () => void }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const cliCmd = [
    "python -m mlx_lm.lora",
    `--model ${job.base_model_id.replace(/^mlx:/, "")}`,
    `--data ${job.dataset_path}`,
    `--rank ${job.lora_rank}`,
    `--alpha ${job.lora_alpha}`,
    `--learning-rate ${job.learning_rate}`,
    `--iters ${job.max_steps}`,
    `--save-every 50`,
    `--adapter-path ./adapters/${job.id}`,
  ].join(" \\\n  ");

  const copy = async (s: string) => { try { await navigator.clipboard.writeText(s); toast("Copied", "success"); } catch {} };

  const updateStatus = async (status: Job["status"]) => {
    await fetch(`/api/finetune/jobs/${job.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    refresh();
  };

  const train = job.train_loss ?? [];
  const evals = job.eval_loss ?? [];

  return (
    <div className="px-6 py-5 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">{job.name}</h2>
          <p className="text-[11px] text-zinc-500 font-mono">{job.base_model_id.replace(/^mlx:/, "")} · {job.dataset_path}</p>
        </div>
        <span className={cn("text-[11px] font-mono px-2 py-0.5 rounded border", STATUS_COLOR[job.status])}>{job.status}</span>
      </div>

      <section>
        <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-1.5">CLI command</h3>
        <div className="relative">
          <pre className="bg-black/40 border border-white/[0.06] rounded p-3 text-[11px] font-mono text-zinc-200 whitespace-pre-wrap">{cliCmd}</pre>
          <button onClick={() => copy(cliCmd)} className="absolute top-2 right-2 text-zinc-500 hover:text-zinc-200" title="Copy"><Copy className="w-3.5 h-3.5" /></button>
        </div>
        <p className="text-[10px] text-zinc-500 mt-1">
          Run in your shell. While it runs, POST loss points to <code className="text-indigo-300">{origin}/api/finetune/jobs/{job.id}/loss</code> so the chart below populates.
        </p>
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-1.5">Status</h3>
        <div className="flex gap-2 flex-wrap">
          {(["queued", "running", "done", "error", "cancelled"] as const).map(s => (
            <Button key={s} variant="ghost" size="sm" onClick={() => updateStatus(s)} disabled={job.status === s}>
              {s}
            </Button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-1.5">Loss curve ({train.length} train / {evals.length} eval points)</h3>
        {train.length < 2 ? (
          <p className="text-[11px] text-zinc-500">No loss points yet.</p>
        ) : (
          <LossChart train={train} evals={evals} maxStep={job.max_steps} />
        )}
      </section>

      {job.error && (
        <section className="rounded-lg border border-red-500/30 bg-red-950/20 p-3 text-xs text-red-300">
          <strong>Error:</strong> {job.error}
        </section>
      )}
    </div>
  );
}

function LossChart({ train, evals, maxStep }: { train: [number, number][]; evals: [number, number][]; maxStep: number }) {
  const allLosses = [...train.map(p => p[1]), ...evals.map(p => p[1])];
  const min = Math.min(...allLosses);
  const max = Math.max(...allLosses);
  const W = 560; const H = 180; const pad = 28;
  const span = Math.max(0.0001, max - min);
  const maxX = Math.max(...train.map(p => p[0]), maxStep, 1);
  const toX = (step: number) => pad + (step / maxX) * (W - pad * 2);
  const toY = (loss: number) => H - pad - ((loss - min) / span) * (H - pad * 2);
  const trainPath = train.map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p[0])} ${toY(p[1])}`).join(" ");
  const evalPath = evals.map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p[0])} ${toY(p[1])}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-2xl rounded border border-white/[0.06] bg-zinc-950">
      <text x={pad} y={14} fill="#71717a" fontSize={10} fontFamily="monospace">{max.toFixed(3)}</text>
      <text x={pad} y={H - 6} fill="#71717a" fontSize={10} fontFamily="monospace">{min.toFixed(3)}</text>
      <path d={trainPath} stroke="#6366f1" strokeWidth={1.5} fill="none" />
      {evals.length > 0 && <path d={evalPath} stroke="#10b981" strokeWidth={1.5} fill="none" />}
    </svg>
  );
}

function NewJobDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [datasetPath, setDatasetPath] = useState("");
  const [rank, setRank] = useState(8);
  const [alpha, setAlpha] = useState(16);
  const [lr, setLr] = useState(0.0001);
  const [steps, setSteps] = useState(200);
  const activeModelId = useModelsStore(s => s.activeModelId);

  const submit = async () => {
    if (!activeModelId) { toast("Load a base model first (it becomes the LoRA target).", "error"); return; }
    const r = await fetch("/api/finetune/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim() || "ft-job",
        base_model_id: activeModelId,
        dataset_path: datasetPath.trim(),
        lora_rank: rank, lora_alpha: alpha, learning_rate: lr, max_steps: steps,
      }),
    });
    if (r.ok) { toast("Job saved", "success"); onCreated(); }
    else toast("Save failed", "error");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl">
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">New fine-tune job</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200"><XIcon className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-1">Name</label>
            <input value={name} onChange={e => setName(e.target.value)} className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2.5 py-1.5 text-sm text-zinc-100" autoFocus />
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-1">Dataset path (JSONL)</label>
            <input value={datasetPath} onChange={e => setDatasetPath(e.target.value)} placeholder="/Users/you/datasets/mine.jsonl" className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2.5 py-1.5 text-sm text-zinc-100 font-mono" />
            <p className="text-[10px] text-zinc-500 mt-1">Tip: POST to <code>/api/finetune/datasets/from-chats</code> with a list of session ids to generate one from your chat history.</p>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-0.5">Rank</label>
              <input type="number" value={rank} onChange={e => setRank(Number(e.target.value) || 8)} className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2 py-1 text-xs text-zinc-100 font-mono" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-0.5">Alpha</label>
              <input type="number" value={alpha} onChange={e => setAlpha(Number(e.target.value) || 16)} className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2 py-1 text-xs text-zinc-100 font-mono" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-0.5">LR</label>
              <input type="number" step="0.00001" value={lr} onChange={e => setLr(Number(e.target.value) || 0.0001)} className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2 py-1 text-xs text-zinc-100 font-mono" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-0.5">Steps</label>
              <input type="number" value={steps} onChange={e => setSteps(Number(e.target.value) || 200)} className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2 py-1 text-xs text-zinc-100 font-mono" />
            </div>
          </div>
          <p className="text-[10px] text-zinc-500">Base model: <code className="text-indigo-300">{activeModelId ?? "no model loaded"}</code></p>
        </div>
        <div className="px-5 py-3 border-t border-white/[0.08] flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={!name.trim() || !datasetPath.trim() || !activeModelId} className="gap-1.5">
            <PlayCircle className="w-3.5 h-3.5" /> Save
          </Button>
        </div>
      </div>
    </div>
  );
}
