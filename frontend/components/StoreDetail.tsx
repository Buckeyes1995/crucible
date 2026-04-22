"use client";

import { useEffect, useState } from "react";
import { X as XIcon, Download, Check, ExternalLink, Loader2, Sparkles, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StoreArt } from "@/components/StoreArt";
import type { StoreRailItem } from "@/lib/api";

const KIND_LABEL: Record<StoreRailItem["kind"], string> = {
  models: "Model",
  prompts: "Prompt",
  workflows: "Workflow",
  system_prompts: "System prompt",
  mcps: "MCP server",
};

type Sample = {
  kind?: string;
  id?: string;
  prompt?: string;
  output?: string;
  model_id?: string | null;
  ts?: number;
};

export function StoreDetail({
  item,
  related,
  installed,
  busy,
  progress,
  ctaLabel,
  onClose,
  onAction,
  onOpenRelated,
  activeModelId,
}: {
  item: StoreRailItem;
  related: StoreRailItem[];
  installed: boolean;
  busy: boolean;
  progress?: number;
  ctaLabel: string;
  onClose: () => void;
  onAction: () => void;
  onOpenRelated: (it: StoreRailItem) => void;
  activeModelId: string | null;
}) {
  const [sample, setSample] = useState<Sample | null>(null);
  const [sampleRunning, setSampleRunning] = useState(false);
  const [sampleErr, setSampleErr] = useState<string | null>(null);

  // Load any cached sample for this item on mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const resp = await fetch(`/api/store/samples/${item.kind}/${encodeURIComponent(item.id)}`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (alive && data && data.output) setSample(data);
      } catch {}
    })();
    return () => { alive = false; };
  }, [item.kind, item.id]);

  // Esc to close, like other modals in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const runSample = async () => {
    if (!activeModelId) {
      setSampleErr("Load a model first to generate a sample.");
      return;
    }
    setSampleErr(null);
    setSampleRunning(true);
    const prompt =
      item.kind === "models" ? "In three short sentences, describe what you do best."
      : item.kind === "prompts" ? (item.content ?? "").slice(0, 2000)
      : item.kind === "system_prompts" ? "Introduce yourself and your role in one paragraph."
      : item.kind === "workflows" ? `Describe how the ${item.agent ?? "agent"} pipeline would tackle a real task.`
      : `Describe what tools you expose and how an agent would call them.`;
    const systemPrompt =
      item.kind === "system_prompts" ? (item.content ?? undefined)
      : undefined;
    try {
      const messages = [
        ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
        { role: "user", content: prompt },
      ];
      const r = await fetch("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: activeModelId.replace(/^mlx:/, ""),
          messages,
          max_tokens: 220,
          stream: false,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const output = data?.choices?.[0]?.message?.content ?? "";
      if (!output) throw new Error("Empty response");
      await fetch("/api/store/samples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: item.kind, id: item.id, prompt, output, model_id: activeModelId }),
      });
      setSample({ kind: item.kind, id: item.id, prompt, output, model_id: activeModelId, ts: Date.now() / 1000 });
    } catch (e) {
      setSampleErr((e as Error).message || "Sample run failed");
    } finally {
      setSampleRunning(false);
    }
  };

  const showSampleButton = item.kind === "models" || item.kind === "prompts" || item.kind === "system_prompts";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative bg-zinc-950 border border-white/10 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
        {/* Hero band */}
        <div className="relative h-48 shrink-0">
          <StoreArt id={item.id} kind={item.kind} sizeGb={item.size_gb} height={192} />
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/70 to-transparent" />
          <button
            onClick={onClose}
            className="absolute top-3 right-3 h-8 w-8 rounded-full bg-zinc-950/80 border border-white/10 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
            aria-label="Close"
          >
            <XIcon className="w-4 h-4 mx-auto" />
          </button>
          <div className="absolute bottom-4 left-6 right-6">
            <div className="text-[10px] uppercase tracking-[0.2em] text-indigo-300 font-semibold mb-1">
              {KIND_LABEL[item.kind]}
            </div>
            <h2 className="text-2xl font-semibold text-zinc-50 tracking-tight truncate" title={item.name}>
              {item.name}
            </h2>
          </div>
        </div>

        {/* Scroll body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Metric chips */}
          <div className="flex flex-wrap gap-2 text-[11px] font-mono">
            {item.size_gb ? <Chip>{item.size_gb} GB</Chip> : null}
            {item.repo_id ? <Chip title={item.repo_id}>{item.repo_id}</Chip> : null}
            {item.agent ? <Chip>agent: {item.agent}</Chip> : null}
            {item.runtime ? <Chip>via {item.runtime}</Chip> : null}
            {(item.tags ?? []).filter(t => t !== "featured").slice(0, 6).map(t => (
              <Chip key={t} accent>{t}</Chip>
            ))}
          </div>

          {/* Install / progress */}
          <div className="flex items-center gap-3">
            {installed ? (
              <button
                onClick={onAction}
                className="flex items-center gap-1.5 text-xs bg-emerald-900/20 text-emerald-300 border border-emerald-500/30 rounded px-4 py-2"
                title="Re-install to refresh from catalog"
              >
                <Check className="w-3.5 h-3.5" /> Installed — click to re-install
              </button>
            ) : progress !== undefined && progress >= 0 ? (
              <div className="relative rounded overflow-hidden border border-indigo-500/40 bg-indigo-950/30 text-indigo-100 text-xs font-medium min-w-[200px]">
                <div
                  className="absolute inset-y-0 left-0 bg-indigo-500/60 transition-[width] duration-300 ease-out"
                  style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                />
                <div className="relative flex items-center justify-center gap-1.5 px-4 py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {progress > 0 ? `${Math.round(progress)}%` : "Queued…"}
                </div>
              </div>
            ) : (
              <Button onClick={onAction} disabled={busy} variant="primary" size="sm" className="gap-1.5">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {ctaLabel}
              </Button>
            )}
            {item.repo && (
              <a
                href={item.repo}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-100"
              >
                View source <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {/* Description */}
          {item.description && (
            <p className="text-sm text-zinc-300 leading-relaxed">{item.description}</p>
          )}

          {/* Preview of content/template if the kind has one */}
          {(item.content || item.template) && (
            <div>
              <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-1.5">
                {item.kind === "workflows" ? "Template" : "Content"}
              </h3>
              <pre className="text-[11px] text-zinc-300 bg-black/40 border border-white/[0.06] rounded p-3 whitespace-pre-wrap max-h-48 overflow-y-auto font-mono">
                {item.content ?? item.template}
              </pre>
            </div>
          )}

          {/* Sample output */}
          {showSampleButton && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-semibold flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3" /> Sample output
                </h3>
                <button
                  onClick={runSample}
                  disabled={sampleRunning || !activeModelId}
                  className="text-[10px] text-indigo-300 hover:text-indigo-200 flex items-center gap-1 disabled:opacity-40"
                  title={!activeModelId ? "Load a model to run a sample" : "Regenerate sample"}
                >
                  {sampleRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  {sample ? "Regenerate" : "Run against loaded model"}
                </button>
              </div>
              {sampleErr ? (
                <div className="text-[11px] text-red-300 bg-red-950/20 border border-red-500/20 rounded p-2">
                  {sampleErr}
                </div>
              ) : sample?.output ? (
                <div className="space-y-1.5">
                  <pre className="text-[11px] text-zinc-300 bg-black/30 border border-white/[0.06] rounded p-3 whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {sample.output}
                  </pre>
                  <p className="text-[10px] text-zinc-600 font-mono">
                    {sample.model_id ? sample.model_id.replace(/^mlx:/, "") : "unknown"}
                    {sample.ts ? ` · ${new Date(sample.ts * 1000).toLocaleString()}` : ""}
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-zinc-500">
                  No sample cached. Click "Run against loaded model" to generate one.
                </p>
              )}
            </div>
          )}

          {/* Related */}
          {related.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-2">You might also like</h3>
              <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
                {related.slice(0, 6).map(r => (
                  <button
                    key={`${r.kind}:${r.id}`}
                    onClick={() => onOpenRelated(r)}
                    className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-zinc-900/40 hover:bg-zinc-900/70 px-3 py-2 text-left transition-colors overflow-hidden"
                  >
                    <div className="w-16 h-10 rounded overflow-hidden shrink-0">
                      <StoreArt id={r.id} kind={r.kind} sizeGb={r.size_gb} height={40} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-zinc-100 truncate">{r.name}</div>
                      <div className="text-[10px] text-zinc-500 truncate">
                        {KIND_LABEL[r.kind]}
                        {r.size_gb ? ` · ${r.size_gb} GB` : ""}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({ children, accent, title }: { children: React.ReactNode; accent?: boolean; title?: string }) {
  return (
    <span
      title={title}
      className={
        accent
          ? "bg-indigo-900/25 text-indigo-300 border border-indigo-500/20 px-1.5 py-0.5 rounded truncate max-w-[180px]"
          : "bg-zinc-800 text-zinc-300 border border-white/[0.06] px-1.5 py-0.5 rounded truncate max-w-[260px]"
      }
    >
      {children}
    </span>
  );
}
