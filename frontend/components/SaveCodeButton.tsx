"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { extractCodeBlocks, type CodeBlock } from "@/lib/code-blocks";
import { toast } from "@/components/Toast";
import { Save, Loader2, FolderOpen, Play, ChevronDown, ChevronUp, Check, X as XIcon, FileText } from "lucide-react";
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
  // Tree preview: pick which files to save before committing, and rename any
  // of them. Only applies when there's more than one block — one-block saves
  // stay one-click.
  const [showPreview, setShowPreview] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(blocks.map(b => b.filename)));
  const [renames, setRenames] = useState<Record<string, string>>({});

  const blocks: CodeBlock[] = extractCodeBlocks(text, filenamePrefix);
  if (blocks.length === 0) return null;

  const cleanSubdir = subdir ? sanitizeSegment(subdir) : undefined;

  const filenameFor = (b: CodeBlock) => renames[b.filename] || b.filename;
  const blocksToSave = blocks.filter(b => selected.has(b.filename));

  const onSave = async () => {
    if (blocksToSave.length === 0) {
      toast("Select at least one file to save", "error");
      return;
    }
    setSaving(true);
    try {
      const results = await Promise.all(
        blocksToSave.map((b) =>
          api.output.save({
            source,
            run_id: runId,
            subdir: cleanSubdir,
            filename: filenameFor(b),
            content: b.content,
          }),
        ),
      );
      const dir = results[0]?.path.split("/").slice(0, -1).join("/") ?? "";
      setSavedPath(dir);
      setShowPreview(false);
      toast(
        `Saved ${blocksToSave.length} file${blocksToSave.length === 1 ? "" : "s"} to ${dir}`,
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

  // Primary-action behavior: one-file saves go straight to disk. Multi-file
  // saves open a preview panel so the user can drop / rename before writing.
  const primary = () => {
    if (blocks.length > 1) setShowPreview(v => !v);
    else onSave();
  };

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center gap-1">
        <button
          onClick={primary}
          disabled={saving}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border border-white/[0.08] transition-colors"
          title={blocks.map((b) => b.filename).join(", ")}
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" />
            : showPreview ? <ChevronUp className="w-3 h-3" />
            : <Save className="w-3 h-3" />}
          {blocks.length > 1 && !showPreview ? `Save ${blocks.length} files…` : `Save ${blocks.length} file${blocks.length === 1 ? "" : "s"}`}
          {blocks.length > 1 && !showPreview && <ChevronDown className="w-3 h-3" />}
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

      {showPreview && blocks.length > 1 && (
        <div className="mt-1 rounded-lg border border-white/[0.08] bg-zinc-950/70 p-2 text-[11px]">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500">{blocksToSave.length}/{blocks.length} selected</span>
            <button onClick={() => setSelected(new Set(blocks.map(b => b.filename)))} className="text-[10px] text-zinc-500 hover:text-zinc-300">All</button>
            <button onClick={() => setSelected(new Set())} className="text-[10px] text-zinc-500 hover:text-zinc-300">None</button>
          </div>
          <div className="space-y-1">
            {blocks.map(b => {
              const on = selected.has(b.filename);
              return (
                <div key={b.filename} className="flex items-center gap-1.5 font-mono">
                  <button
                    onClick={() => setSelected(prev => {
                      const s = new Set(prev);
                      if (on) s.delete(b.filename); else s.add(b.filename);
                      return s;
                    })}
                    className={cn(
                      "w-4 h-4 rounded border flex items-center justify-center shrink-0",
                      on ? "bg-indigo-500/30 border-indigo-400/50 text-indigo-200" : "border-white/[0.15] text-transparent hover:text-zinc-500",
                    )}
                  >
                    <Check className="w-2.5 h-2.5" />
                  </button>
                  <FileText className="w-3 h-3 text-zinc-500 shrink-0" />
                  <input
                    type="text"
                    value={renames[b.filename] ?? b.filename}
                    onChange={(e) => setRenames(r => ({ ...r, [b.filename]: e.target.value }))}
                    disabled={!on}
                    className="flex-1 bg-zinc-900 border border-white/[0.06] rounded px-1.5 py-0.5 text-[10px] text-zinc-200 disabled:opacity-40"
                  />
                  <span className="text-[9px] text-zinc-600 shrink-0 w-12 text-right">{b.content.length}B</span>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex gap-1">
            <button
              onClick={onSave}
              disabled={saving || blocksToSave.length === 0}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save {blocksToSave.length}
            </button>
            <button onClick={() => setShowPreview(false)} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-zinc-500 hover:text-zinc-300">
              <XIcon className="w-3 h-3" /> Cancel
            </button>
          </div>
        </div>
      )}
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
