"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Eye, EyeOff } from "lucide-react";

// Parse common tabular / structured payloads found in chat responses and
// render them inline alongside the raw text. Scope is deliberately small:
// JSON, CSV, markdown tables. Anything else falls back to the raw content
// the caller provides.

type Parsed =
  | { kind: "json"; pretty: string; value: unknown }
  | { kind: "csv"; rows: string[][] }
  | { kind: "table"; rows: string[][] }
  | null;

export function detectStructured(lang: string, content: string): Parsed {
  const l = lang.toLowerCase();
  if (l === "json" || l === "jsonl") {
    if (l === "jsonl") {
      // JSON lines: parse each non-empty line as JSON; if they all parse,
      // render as a pretty array.
      const lines = content.split("\n").map(s => s.trim()).filter(Boolean);
      const parsed: unknown[] = [];
      for (const line of lines) {
        try { parsed.push(JSON.parse(line)); } catch { return null; }
      }
      return { kind: "json", pretty: JSON.stringify(parsed, null, 2), value: parsed };
    }
    try {
      const v = JSON.parse(content);
      return { kind: "json", pretty: JSON.stringify(v, null, 2), value: v };
    } catch {
      return null;
    }
  }
  if (l === "csv" || l === "tsv") {
    const rows = parseCsv(content, l === "tsv" ? "\t" : ",");
    return rows.length >= 2 ? { kind: "csv", rows } : null;
  }
  return null;
}

// Minimal CSV parser — handles quoted fields with embedded commas and
// escaped double-quotes. Good enough for the "model emitted a CSV block"
// case; not a full RFC 4180 implementation.
function parseCsv(src: string, delim: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === delim) { cur.push(field); field = ""; i++; continue; }
    if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
  return rows.filter(r => r.some(x => x.trim() !== ""));
}

// Parse a markdown table in raw chat text. Returns rows or null if the
// block doesn't look like one.
export function parseMarkdownTable(block: string): string[][] | null {
  const lines = block.split("\n").filter(l => l.trim().startsWith("|"));
  if (lines.length < 2) return null;
  const sep = lines[1];
  if (!/^\s*\|[-:|\s]+\|\s*$/.test(sep)) return null;
  const header = splitRow(lines[0]);
  const body = lines.slice(2).map(splitRow);
  return [header, ...body];
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map(c => c.trim());
}

export function StructuredBlock({ lang, content }: { lang: string; content: string }) {
  const parsed = useMemo(() => detectStructured(lang, content), [lang, content]);
  const [open, setOpen] = useState(true);
  if (!parsed) return null;
  return (
    <div className="mt-2 rounded-lg border border-indigo-500/20 bg-indigo-950/10 overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1 text-[10px] uppercase tracking-wide text-indigo-300 hover:bg-indigo-900/20"
      >
        {open ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
        <span>Rendered {parsed.kind}</span>
      </button>
      {open && (
        <div className="p-2">
          {parsed.kind === "json" ? (
            <pre className="text-[11px] text-zinc-300 whitespace-pre-wrap max-h-80 overflow-y-auto font-mono">{parsed.pretty}</pre>
          ) : (
            <TableView rows={parsed.rows} />
          )}
        </div>
      )}
    </div>
  );
}

export function TableView({ rows }: { rows: string[][] }) {
  if (rows.length === 0) return null;
  const [header, ...body] = rows;
  return (
    <div className="overflow-x-auto max-h-80">
      <table className="text-[11px] w-full border-collapse">
        <thead>
          <tr>
            {header.map((h, i) => (
              <th key={i} className="text-left px-2 py-1 border-b border-white/[0.08] font-medium text-zinc-300 sticky top-0 bg-indigo-950/40">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri} className={cn(ri % 2 === 0 ? "bg-black/10" : "")}>
              {row.map((cell, ci) => (
                <td key={ci} className="px-2 py-0.5 text-zinc-400 align-top font-mono border-b border-white/[0.03]">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
