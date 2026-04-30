"use client";

import { useEffect, useState, useMemo } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { ScrollText, RefreshCw, Search } from "lucide-react";

type AuditEntry = {
  ts: number;
  actor: string;
  action: string;
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
};

export default function AuditTab() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/audit?limit=500");
      if (resp.ok) setRows(await resp.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        r.action.toLowerCase().includes(q) ||
        r.actor.toLowerCase().includes(q) ||
        JSON.stringify(r).toLowerCase().includes(q),
    );
  }, [rows, search]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-white/[0.04]">
        <PageHeader
          icon={<ScrollText className="w-5 h-5" />}
          title="Audit Log"
          description="Who changed what, and when. Last 500 admin actions."
        />
        <div className="mt-3 flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-zinc-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search actions, actors…"
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded bg-zinc-900 border border-white/10 text-zinc-200 placeholder:text-zinc-600"
            />
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-1.5 text-sm rounded border border-white/10 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 inline-block ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        {loading && rows.length === 0 ? (
          <p className="text-zinc-500 text-sm">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-zinc-500 text-sm">No audit entries{search ? " match" : ""} yet.</p>
        ) : (
          <ul className="space-y-1.5 font-mono text-xs">
            {filtered.map((r, i) => {
              const ts = new Date(r.ts * 1000);
              const open = expanded === i;
              return (
                <li
                  key={i}
                  className="rounded border border-white/[0.06] bg-zinc-950 hover:bg-zinc-900/60 transition-colors"
                >
                  <button
                    className="w-full text-left px-3 py-2 flex items-center gap-3"
                    onClick={() => setExpanded(open ? null : i)}
                  >
                    <span className="text-zinc-500 w-40 shrink-0">{ts.toLocaleString()}</span>
                    <span className="text-indigo-300 w-28 shrink-0 truncate">{r.actor}</span>
                    <span className="text-zinc-200 flex-1 truncate">{r.action}</span>
                  </button>
                  {open && (
                    <pre className="px-3 pb-3 text-[11px] text-zinc-400 overflow-x-auto whitespace-pre-wrap">
{JSON.stringify({ before: r.before, after: r.after, meta: r.meta }, null, 2)}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
