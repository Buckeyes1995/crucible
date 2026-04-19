"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { extractCodeBlocks, type CodeBlock } from "@/lib/code-blocks";
import { toast } from "@/components/Toast";
import { Save, Loader2, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";

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

  return (
    <div className={cn("flex items-center gap-1", className)}>
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
  );
}
