"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { extractCodeBlocks, type CodeBlock } from "@/lib/code-blocks";
import { toast } from "@/components/Toast";
import { Save, Loader2, FolderOpen, Play } from "lucide-react";
import { cn } from "@/lib/utils";

// Extensions the backend knows how to execute. Mirrors _RUNNERS in
// backend/routers/outputs.py — keep in sync.
const RUNNABLE_EXTS = new Set([".py", ".js", ".sh", ".rb"]);

type RunResult = {
  exit_code: number | null;
  timed_out: boolean;
  elapsed_s: number;
  stdout: string;
  stderr: string;
  runner: string;
};

// Tiny button that parses code fences out of a model's response and saves each
// to disk under ~/.config/crucible/outputs/{source}/{runId}/. Designed to drop
// into arena / diff / chat panels without extra plumbing.
// Sanitize a free-form label (e.g. model name) into a filesystem-safe folder
// segment. Backend enforces the same rules; this just makes the request
// succeed on the first try.
function sanitizeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9._\- ]/g, "_").slice(0, 128).replace(/^\.+/, "");
}

export function SaveCodeButton({
  text,
  source,
  runId,
  subdir,
  filenamePrefix,
  className,
}: {
  text: string;
  source: "arena" | "diff" | "chat";
  runId: string;
  /** Optional per-model folder label. Sanitized to a safe segment here. */
  subdir?: string;
  filenamePrefix: string;
  className?: string;
}) {
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [runningFile, setRunningFile] = useState<string | null>(null);
  const [runResults, setRunResults] = useState<Record<string, RunResult>>({});

  const blocks: CodeBlock[] = extractCodeBlocks(text, filenamePrefix);
  if (blocks.length === 0) return null;

  const cleanSubdir = subdir ? sanitizeSegment(subdir) : undefined;

  const onSave = async () => {
    setSaving(true);
    try {
      const results = await Promise.all(
        blocks.map((b) =>
          api.output.save({
            source,
            run_id: runId,
            subdir: cleanSubdir,
            filename: b.filename,
            content: b.content,
          }),
        ),
      );
      const dir = results[0]?.path.split("/").slice(0, -1).join("/") ?? "";
      setSavedPath(dir);
      toast(
        `Saved ${blocks.length} file${blocks.length === 1 ? "" : "s"} to ${dir}`,
        "success",
      );
    } catch (e) {
      toast(`Save failed: ${(e as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const onReveal = async () => {
    try {
      // Reveal the RUN dir, not the per-model subdir — lets the user compare
      // multiple models' output side-by-side in Finder.
      await api.output.reveal({ source, run_id: runId });
    } catch (e) {
      toast(`Reveal failed: ${(e as Error).message}`, "error");
    }
  };

  const onRun = async (filename: string) => {
    setRunningFile(filename);
    try {
      const res = await api.output.run({
        source, run_id: runId, subdir: cleanSubdir, filename,
      });
      setRunResults(prev => ({ ...prev, [filename]: res }));
    } catch (e) {
      toast(`Run failed: ${(e as Error).message}`, "error");
    } finally {
      setRunningFile(null);
    }
  };

  const runnableBlocks = blocks.filter(b => {
    const dot = b.filename.lastIndexOf(".");
    return dot >= 0 && RUNNABLE_EXTS.has(b.filename.slice(dot).toLowerCase());
  });

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center gap-1">
        <button
          onClick={onSave}
          disabled={saving}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border border-white/[0.08] transition-colors"
          title={blocks.map((b) => b.filename).join(", ")}
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          Save {blocks.length} file{blocks.length === 1 ? "" : "s"}
        </button>
        {savedPath && (
          <button
            onClick={onReveal}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 border border-white/[0.08] transition-colors"
            title={`Reveal ${savedPath}`}
          >
            <FolderOpen className="w-3 h-3" />
            Reveal
          </button>
        )}
      </div>
      {savedPath && runnableBlocks.length > 0 && (
        <div className="mt-1 space-y-1">
          {runnableBlocks.map(b => {
            const busy = runningFile === b.filename;
            const res = runResults[b.filename];
            return (
              <div key={b.filename} className="rounded border border-white/[0.06] bg-zinc-950/60 text-[11px]">
                <div className="flex items-center gap-2 px-2 py-1">
                  <span className="font-mono text-zinc-400 truncate" title={b.filename}>
                    {b.filename}
                  </span>
                  <button
                    onClick={() => onRun(b.filename)}
                    disabled={busy}
                    className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-200 border border-indigo-500/30 transition-colors disabled:opacity-50"
                    title="Execute this file in a sandboxed subprocess (30s timeout)"
                  >
                    {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                    Run
                  </button>
                </div>
                {res && (
                  <div className="px-2 pb-1.5 space-y-1 font-mono">
                    <div className={cn(
                      "text-[10px]",
                      res.timed_out ? "text-amber-400" :
                      res.exit_code === 0 ? "text-emerald-400" : "text-red-400",
                    )}>
                      {res.timed_out
                        ? `timed out after ${res.elapsed_s}s`
                        : `exit ${res.exit_code} in ${res.elapsed_s}s`}
                      <span className="text-zinc-600 ml-2">({res.runner})</span>
                    </div>
                    {res.stdout && (
                      <pre className="whitespace-pre-wrap text-[10px] text-zinc-300 max-h-40 overflow-y-auto bg-black/40 rounded px-2 py-1">{res.stdout}</pre>
                    )}
                    {res.stderr && (
                      <pre className="whitespace-pre-wrap text-[10px] text-red-300/80 max-h-40 overflow-y-auto bg-black/40 rounded px-2 py-1">{res.stderr}</pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
