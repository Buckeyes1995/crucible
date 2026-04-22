"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Info, ExternalLink, Keyboard, Link2 } from "lucide-react";

type About = {
  git_sha?: string;
  git_branch?: string;
  mlx_dir?: string;
  gguf_dir?: string;
  bind_host?: string;
  now?: number;
};

export default function AboutPage() {
  const [info, setInfo] = useState<About | null>(null);

  useEffect(() => {
    fetch("/api/about").then((r) => r.ok ? r.json() : null).then(setInfo).catch(() => {});
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-white/[0.04]">
        <PageHeader
          icon={<Info className="w-5 h-5" />}
          title="About Crucible"
          description="Local LLM management, benchmarking, and workshop — running on your hardware."
        />
      </div>

      <div className="px-6 py-6 overflow-auto space-y-6 max-w-3xl">
        <section className="rounded-xl border border-white/10 bg-zinc-950 p-4 space-y-2">
          <h2 className="text-sm font-semibold text-zinc-200">Build</h2>
          <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-xs font-mono">
            <dt className="text-zinc-500">Commit</dt>
            <dd className="text-zinc-200">{info?.git_sha ?? "…"}</dd>
            <dt className="text-zinc-500">Branch</dt>
            <dd className="text-zinc-200">{info?.git_branch ?? "…"}</dd>
            <dt className="text-zinc-500">MLX models</dt>
            <dd className="text-zinc-300 truncate">{info?.mlx_dir ?? "…"}</dd>
            <dt className="text-zinc-500">GGUF models</dt>
            <dd className="text-zinc-300 truncate">{info?.gguf_dir ?? "…"}</dd>
            <dt className="text-zinc-500">Bound to</dt>
            <dd className="text-zinc-300">{info?.bind_host ?? "…"}</dd>
          </dl>
        </section>

        <section className="rounded-xl border border-white/10 bg-zinc-950 p-4 space-y-2">
          <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
            <Keyboard className="w-4 h-4" /> Shortcuts
          </h2>
          <p className="text-xs text-zinc-400">
            Press <kbd className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 border border-white/10">?</kbd> anywhere to open the keyboard shortcut cheat sheet.
          </p>
        </section>

        <section className="rounded-xl border border-white/10 bg-zinc-950 p-4 space-y-2">
          <h2 className="text-sm font-semibold text-zinc-200">Handy endpoints</h2>
          <ul className="text-xs space-y-1 text-zinc-300">
            <li>
              <code className="font-mono text-indigo-300">/metrics</code> — Prometheus-compatible metrics
            </li>
            <li>
              <code className="font-mono text-indigo-300">/v1/chat/completions</code> — OpenAI-compatible proxy
            </li>
            <li>
              <code className="font-mono text-indigo-300">/api/audit</code> — JSON audit log
            </li>
            <li>
              <code className="font-mono text-indigo-300">/api/model-usage-stats</code> — model usage aggregates
            </li>
          </ul>
        </section>

        <section className="rounded-xl border border-white/10 bg-zinc-950 p-4 space-y-2">
          <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
            <Link2 className="w-4 h-4" /> Links
          </h2>
          <ul className="text-xs space-y-1 text-zinc-300">
            <li>
              <a href="https://github.com/Buckeyes1995/crucible" target="_blank" rel="noopener noreferrer" className="text-indigo-300 hover:underline inline-flex items-center gap-1">
                Crucible on GitHub <ExternalLink className="w-3 h-3" />
              </a>
            </li>
            <li>
              <a href="https://github.com/Buckeyes1995/crucible/issues/new" target="_blank" rel="noopener noreferrer" className="text-indigo-300 hover:underline inline-flex items-center gap-1">
                Report a bug or request a feature <ExternalLink className="w-3 h-3" />
              </a>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
