"use client";

// Render a chat message body with inline structured rendering for
// fenced json/csv/jsonl/tsv blocks. Plain text segments get a minimal
// markdown pass (headings, lists, bold/italic/inline-code/links) so that
// models writing normal prose don't render as raw `**asterisks**`.

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

// Escape HTML special chars so inline markdown can't inject elements.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Apply inline markdown: `code`, **bold**, *italic*, [text](url).
// Order matters — code first so its contents aren't reparsed for bold/italic.
function inlineMd(raw: string): string {
  let s = esc(raw);
  // inline code
  s = s.replace(/`([^`\n]+)`/g, '<code class="font-mono text-[0.85em] bg-white/[0.06] px-1 py-px rounded text-indigo-200">$1</code>');
  // bold
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong class="text-zinc-100">$1</strong>');
  // italic — single asterisk, avoid matching the ones we already handled
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em class="italic text-zinc-200">$2</em>');
  // links
  s = s.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-indigo-400 hover:text-indigo-300 underline">$1</a>',
  );
  return s;
}

type Block =
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "p"; text: string }
  | { kind: "blank" };

function parseBlocks(src: string): Block[] {
  const lines = src.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { blocks.push({ kind: "blank" }); i++; continue; }
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) {
      blocks.push({ kind: "h", level: h[1].length as 1 | 2 | 3, text: h[2] });
      i++; continue;
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "quote", text: buf.join("\n") });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }
    // Paragraph — accumulate consecutive non-blank lines
    const buf: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|>\s?|[-*]\s|\d+\.\s)/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ kind: "p", text: buf.join("\n") });
  }
  return blocks;
}

function renderBlocks(blocks: Block[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.kind === "blank") continue;
    if (b.kind === "h") {
      const cls = b.level === 1
        ? "text-base font-semibold text-zinc-100 mt-3 mb-1"
        : b.level === 2
          ? "text-sm font-semibold text-zinc-100 mt-3 mb-1"
          : "text-xs font-semibold text-zinc-200 mt-2 mb-0.5 uppercase tracking-wide";
      parts.push(`<div class="${cls}">${inlineMd(b.text)}</div>`);
    } else if (b.kind === "ul") {
      parts.push(
        `<ul class="list-disc pl-5 my-1 space-y-0.5">${b.items.map((it) => `<li>${inlineMd(it)}</li>`).join("")}</ul>`,
      );
    } else if (b.kind === "ol") {
      parts.push(
        `<ol class="list-decimal pl-5 my-1 space-y-0.5">${b.items.map((it) => `<li>${inlineMd(it)}</li>`).join("")}</ol>`,
      );
    } else if (b.kind === "quote") {
      parts.push(
        `<blockquote class="border-l-2 border-indigo-500/40 pl-3 text-zinc-400 my-1">${inlineMd(b.text).replace(/\n/g, "<br/>")}</blockquote>`,
      );
    } else {
      parts.push(`<p class="my-1">${inlineMd(b.text).replace(/\n/g, "<br/>")}</p>`);
    }
  }
  return parts.join("");
}

export function ChatMessageBody({ content }: { content: string }) {
  const segments = useMemo(() => splitFences(content), [content]);
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === "text" ? (
          <span
            key={i}
            className="block"
            dangerouslySetInnerHTML={{ __html: renderBlocks(parseBlocks(seg.text)) }}
          />
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
