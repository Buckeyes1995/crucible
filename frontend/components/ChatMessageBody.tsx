"use client";

// Render a chat message body with inline structured rendering for
// fenced json/csv/jsonl/tsv blocks. Everything else comes through as
// plain pre-wrapped text so we don't silently re-style markdown the
// user didn't ask us to interpret.

import { useMemo } from "react";
import { StructuredBlock } from "@/components/StructuredBlock";

type Segment =
  | { kind: "text"; text: string }
  | { kind: "fence"; lang: string; body: string };

function splitFences(src: string): Segment[] {
  const out: Segment[] = [];
  const re = /```([\w+\-./:]*)\r?\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) out.push({ kind: "text", text: src.slice(last, m.index) });
    const header = (m[1] ?? "").trim();
    let lang = header;
    if (header.includes(":")) lang = header.split(":")[0];
    else if (header.includes(".")) {
      const ext = header.split(".").pop();
      lang = (ext ?? "").toLowerCase();
    }
    out.push({ kind: "fence", lang: lang.toLowerCase(), body: (m[2] ?? "").replace(/\s+$/, "") });
    last = re.lastIndex;
  }
  if (last < src.length) out.push({ kind: "text", text: src.slice(last) });
  return out;
}

const STRUCTURED_LANGS = new Set(["json", "jsonl", "csv", "tsv"]);

export function ChatMessageBody({ content }: { content: string }) {
  const segments = useMemo(() => splitFences(content), [content]);
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === "text" ? (
          <span key={i}>{seg.text}</span>
        ) : (
          <span key={i} className="block">
            <pre className="my-2 text-[11px] bg-black/40 border border-white/[0.08] rounded-lg p-2.5 overflow-x-auto font-mono whitespace-pre">
              {seg.lang && <span className="block text-[9px] text-zinc-500 uppercase tracking-wide mb-1.5">{seg.lang}</span>}
              {seg.body}
            </pre>
            {STRUCTURED_LANGS.has(seg.lang) && <StructuredBlock lang={seg.lang} content={seg.body} />}
          </span>
        )
      )}
    </>
  );
}
