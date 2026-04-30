"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { api, type HFSearchResult, type DownloadJob } from "@/lib/api";
import { useStatusStore } from "@/lib/stores/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatBytes } from "@/lib/utils";
import { Search, Download, X, CheckCircle2, AlertCircle, Loader2, ExternalLink, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "@/components/Toast";

export default function DownloadsTab() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HFSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [kindFilter, setKindFilter] = useState<"mlx" | "gguf">("mlx");
  const [hideNoFit, setHideNoFit] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { status, fetch: fetchStatus } = useStatusStore();

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 15_000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const loadJobs = useCallback(() => {
    api.hf.listDownloads().then(setJobs).catch(() => {});
  }, []);

  useEffect(() => {
    loadJobs();
    const id = setInterval(loadJobs, 3000);
    return () => clearInterval(id);
  }, [loadJobs]);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const r = await api.hf.search(q + (kindFilter === "mlx" ? " mlx" : " gguf"), 30);
      setResults(r);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [kindFilter]);

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => doSearch(query), 500);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [query, doSearch]);

  const startDownload = async (result: HFSearchResult) => {
    try {
      await api.hf.startDownload(result.repo_id, kindFilter);
      loadJobs();
    } catch (e) {
      alert(`Failed to start download: ${e}`);
    }
  };

  const cancelDownload = async (job_id: string) => {
    try {
      await api.hf.cancelDownload(job_id);
      loadJobs();
    } catch {}
  };

  const [partials, setPartials] = useState<{ local_dir: string; repo_id: string; kind: string; size_bytes: number }[]>([]);

  useEffect(() => {
    api.hf.listPartial().then(setPartials).catch(() => {});
  }, [jobs]);

  const resumeDownload = async (job_id: string) => {
    try {
      await api.hf.resumeDownload(job_id);
      loadJobs();
    } catch (e) {
      alert(`Failed to resume: ${e}`);
    }
  };


  const activeJobs = jobs.filter(j => j.status !== "done" && j.status !== "error" && j.status !== "cancelled");
  const doneJobs = jobs.filter(j => j.status === "done" || j.status === "error" || j.status === "cancelled");

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-100">Downloads</h1>
        <p className="text-sm text-zinc-500 mt-1">Search HuggingFace and download models directly to your model directories</p>
      </div>

      {/* Search bar */}
      <div className="flex gap-3 mb-6">
        <div className="flex gap-1">
          {(["mlx", "gguf"] as const).map(k => (
            <button
              key={k}
              onClick={() => setKindFilter(k)}
              className={cn(
                "px-3 py-2 rounded-md text-xs font-medium uppercase transition-colors",
                kindFilter === k ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-400 hover:text-zinc-100"
              )}
            >{k}</button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <Input
            className="pl-9"
            placeholder={`Search HuggingFace for ${kindFilter.toUpperCase()} models…`}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        {searching && <Loader2 className="w-5 h-5 text-zinc-500 animate-spin self-center" />}
      </div>

      {/* Filters */}
      {results.length > 0 && (
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => setHideNoFit(v => !v)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors border",
              hideNoFit
                ? "bg-indigo-600/20 text-indigo-300 border-indigo-500/30"
                : "bg-zinc-800 text-zinc-400 border-white/5 hover:text-zinc-100"
            )}
          >
            <span className={cn("w-1.5 h-1.5 rounded-full", hideNoFit ? "bg-indigo-400" : "bg-zinc-600")} />
            Hide models that won&apos;t fit
          </button>
        </div>
      )}

      {/* Active downloads */}
      {activeJobs.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-medium text-zinc-400 mb-3">Active Downloads</h2>
          <div className="space-y-3">
            {activeJobs.map(job => (
              <JobCard key={job.job_id} job={job} onCancel={() => cancelDownload(job.job_id)} />
            ))}
          </div>
        </div>
      )}

      {/* Search results */}
      {results.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
              Results ({results.length})
            </h2>
            {status?.available_memory_bytes ? (
              <span className="text-xs text-zinc-600">
                {formatBytes(status.available_memory_bytes)} free · {formatBytes(status.total_memory_bytes)} total
              </span>
            ) : null}
          </div>
          <div className="space-y-0.5">
            {results.filter(r => {
              if (!hideNoFit) return true;
              const total = status?.total_memory_bytes ?? 0;
              if (!r.size_bytes || !total) return true;
              return r.size_bytes <= total;
            }).map(r => (
              <SearchResultRow
                key={r.repo_id}
                result={r}
                kind={kindFilter}
                availableBytes={status?.available_memory_bytes ?? 0}
                totalBytes={status?.total_memory_bytes ?? 0}
                alreadyQueued={jobs.some(j => j.repo_id === r.repo_id && (j.status === "queued" || j.status === "downloading"))}
                onDownload={() => startDownload(r)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Completed / errored jobs */}
      {doneJobs.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-zinc-400">History</h2>
            <button
              onClick={async () => {
                if (!confirm(`Clear ${doneJobs.length} finished download${doneJobs.length === 1 ? "" : "s"} from history? Active jobs are not affected.`)) return;
                try {
                  const r = await api.hf.clearHistory();
                  await loadJobs();
                  toast(`Removed ${r.removed} from history`, "success");
                } catch (e) { toast(`Clear failed: ${(e as Error).message}`, "error"); }
              }}
              className="text-xs text-zinc-500 hover:text-red-400 transition-colors flex items-center gap-1"
              title="Remove completed, errored, and cancelled jobs"
            >
              <Trash2 className="w-3 h-3" /> Clear history
            </button>
          </div>
          <div className="space-y-2">
            {doneJobs.map(job => (
              <JobCard
                key={job.job_id}
                job={job}
                onCancel={() => cancelDownload(job.job_id)}
                onResume={job.status === "error" || job.status === "cancelled" ? () => resumeDownload(job.job_id) : undefined}
              />
            ))}
          </div>
        </div>
      )}

      {/* Orphaned partial downloads — informational only */}
      {partials.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-medium text-zinc-400 mb-1">Incomplete Directories</h2>
          <p className="text-xs text-zinc-600 mb-3">These directories look incomplete. Search for the model above and re-download to resume — already-downloaded files will be skipped.</p>
          <div className="space-y-2">
            {partials.map(p => (
              <div key={p.local_dir} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-900 border border-amber-500/10">
                <AlertCircle className="w-4 h-4 text-amber-500/60 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono text-zinc-400 truncate">{p.local_dir}</p>
                  <p className="text-xs text-zinc-600">{formatBytes(p.size_bytes)} on disk</p>
                </div>
                <Badge variant={p.kind as "mlx" | "gguf" | "ollama"}>{p.kind.toUpperCase()}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {results.length === 0 && activeJobs.length === 0 && doneJobs.length === 0 && partials.length === 0 && !searching && (
        <div className="text-center text-zinc-600 py-20">
          Search for a model above to get started
        </div>
      )}
    </div>
  );
}

function fitInfo(sizeBytes: number | null, availableBytes: number, totalBytes: number) {
  if (!sizeBytes || !totalBytes) return null;
  const tooLarge = sizeBytes > totalBytes;
  const fits = sizeBytes <= availableBytes;
  const tight = !fits && sizeBytes <= totalBytes;
  if (tooLarge) return { color: "text-red-400", dot: "bg-red-500", label: "won't fit" };
  if (!fits && tight) return { color: "text-orange-400", dot: "bg-orange-500", label: "low RAM" };
  if (fits && sizeBytes > availableBytes * 0.85) return { color: "text-yellow-400", dot: "bg-yellow-500", label: "tight" };
  return { color: "text-green-400", dot: "bg-green-500", label: "fits" };
}

function SearchResultRow({ result, kind, availableBytes, totalBytes, alreadyQueued, onDownload }: {
  result: HFSearchResult;
  kind: string;
  availableBytes: number;
  totalBytes: number;
  alreadyQueued: boolean;
  onDownload: () => void;
}) {
  const fit = fitInfo(result.size_bytes, availableBytes, totalBytes);
  const hfUrl = `https://huggingface.co/${result.repo_id}`;

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-900 border border-white/5 hover:border-white/15 hover:bg-zinc-800/60 transition-all group">
      {/* Fit dot */}
      <div className="shrink-0 w-4 flex justify-center">
        {fit ? (
          <span className={cn("w-2 h-2 rounded-full", fit.dot)} title={fit.label} />
        ) : (
          <span className="w-2 h-2 rounded-full bg-zinc-700" />
        )}
      </div>

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <a
            href={hfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-sm font-medium text-zinc-100 hover:text-indigo-300 transition-colors truncate"
            onClick={e => e.stopPropagation()}
          >
            {result.repo_id}
            <ExternalLink className="w-3 h-3 text-zinc-600 group-hover:text-zinc-500 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </a>
          {result.pipeline_tag && (
            <span className="text-xs text-zinc-600 shrink-0 hidden sm:inline">{result.pipeline_tag}</span>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 shrink-0 text-xs text-zinc-500">
        {result.size_bytes && (
          <span className={cn("font-mono", fit?.color ?? "text-zinc-400")}>
            {formatBytes(result.size_bytes)}
          </span>
        )}
        <span className="hidden sm:inline">↓ {result.downloads >= 1000
          ? `${(result.downloads / 1000).toFixed(0)}k`
          : result.downloads}</span>
        <span className="hidden md:inline">♥ {result.likes}</span>
      </div>

      {/* Download button */}
      <button
        onClick={onDownload}
        disabled={alreadyQueued}
        className={cn(
          "shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all",
          alreadyQueued
            ? "bg-zinc-700 text-zinc-500 cursor-default"
            : "bg-indigo-600 hover:bg-indigo-500 text-white"
        )}
      >
        {alreadyQueued ? (
          <><Loader2 className="w-3 h-3 animate-spin" /> Queued</>
        ) : (
          <><Download className="w-3 h-3" /> {kind.toUpperCase()}</>
        )}
      </button>
    </div>
  );
}

function formatEta(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m < 60) return `${m}m ${s.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm.toString().padStart(2, "0")}m`;
}

function JobCard({ job, onCancel, onResume }: { job: DownloadJob; onCancel: () => void; onResume?: () => void }) {
  const pct = Math.round(job.progress * 100);
  const bytesPerSec = job.elapsed_s > 0 ? job.downloaded_bytes / job.elapsed_s : 0;
  const remaining = Math.max(0, (job.total_bytes || 0) - job.downloaded_bytes);
  const etaSec = bytesPerSec > 0 ? remaining / bytesPerSec : null;
  const target = job.local_dir || job.dest_dir;

  return (
    <Card className={cn(
      job.status === "done" && "border-green-500/20",
      job.status === "error" && "border-red-500/20",
      job.status === "cancelled" && "border-zinc-600/40",
    )}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {job.status === "done" && <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />}
              {job.status === "error" && <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />}
              {job.status === "cancelled" && <X className="w-4 h-4 text-zinc-500 shrink-0" />}
              {job.status === "downloading" && <Loader2 className="w-4 h-4 text-indigo-400 shrink-0 animate-spin" />}
              {job.status === "queued" && <Loader2 className="w-4 h-4 text-zinc-500 shrink-0" />}
              <span className="text-sm font-medium text-zinc-100 truncate">{job.repo_id}</span>
              <Badge variant={job.kind as "mlx" | "gguf" | "ollama"}>{job.kind.toUpperCase()}</Badge>
            </div>
            <div className="text-xs text-zinc-500 mt-0.5 truncate">
              {job.status === "error" ? job.error : job.message}
            </div>
            {target && (
              <div className="text-[10px] text-zinc-600 mt-0.5 truncate font-mono" title={target}>
                → {target}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-zinc-500">{job.elapsed_s}s</span>
            {onResume && (
              <button onClick={onResume} className="text-zinc-500 hover:text-amber-400 transition-colors" title="Resume">
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
            {job.status !== "done" && job.status !== "cancelled" && (
              <button onClick={onCancel} className="text-zinc-600 hover:text-red-400 transition-colors">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {job.status === "downloading" && (
          <div className="space-y-1">
            <div className="flex justify-between items-baseline text-xs text-zinc-500 gap-3">
              <span className="font-mono text-zinc-300">{pct}%</span>
              <span className="font-mono">{formatBytes(job.downloaded_bytes)} / {formatBytes(job.total_bytes)}</span>
              {bytesPerSec > 0 && (
                <span className="font-mono text-zinc-400">{formatBytes(bytesPerSec)}/s</span>
              )}
              {etaSec != null && (
                <span className="font-mono text-indigo-300 ml-auto">ETA {formatEta(etaSec)}</span>
              )}
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
