"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Swords, Trophy, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

type Battle = {
  id: string; model_a: string; model_b: string; prompt: string;
  response_a: string; response_b: string;
  winner: string;
  elo_before_a: number; elo_before_b: number;
  elo_after_a: number; elo_after_b: number;
  created_at: string;
  norm_mode: string;
  extra_slots_json: string | null;
};

export default function ArenaSharePage() {
  const params = useParams();
  const id = (Array.isArray(params.id) ? params.id[0] : params.id) as string;
  const [battle, setBattle] = useState<Battle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/arena/battle/${encodeURIComponent(id)}/public`)
      .then(async r => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then(setBattle)
      .catch(e => setError(String(e)));
  }, [id]);

  if (error) {
    return <div className="p-6 text-red-400 text-sm">{error}</div>;
  }
  if (!battle) {
    return <div className="p-6 text-zinc-500 text-sm">Loading battle…</div>;
  }

  const extras: Array<{ slot_id: string; display: string; response: string; elo_before: number; elo_after: number }>
    = battle.extra_slots_json ? JSON.parse(battle.extra_slots_json) : [];

  const slots: Array<{ key: string; display: string; response: string; elo_before: number; elo_after: number }> = [
    { key: "model_a", display: battle.model_a, response: battle.response_a, elo_before: battle.elo_before_a, elo_after: battle.elo_after_a },
    { key: "model_b", display: battle.model_b, response: battle.response_b, elo_before: battle.elo_before_b, elo_after: battle.elo_after_b },
    ...extras.map(e => ({ key: e.slot_id, display: e.display, response: e.response, elo_before: e.elo_before, elo_after: e.elo_after })),
  ];

  return (
    <div className="flex flex-col h-full min-h-screen">
      <div className="px-6 py-4 border-b border-white/[0.04]">
        <PageHeader
          icon={<Swords className="w-5 h-5" />}
          title="Arena share"
          description={`${battle.id} · ${new Date(battle.created_at).toLocaleString()} · ${battle.norm_mode ?? "per_model"}`}
        />
      </div>
      <div className="px-6 py-4">
        <div className="rounded-xl border border-indigo-500/15 bg-indigo-950/10 p-4">
          <div className="text-[10px] uppercase tracking-wide text-indigo-300 mb-1">Prompt</div>
          <pre className="text-sm text-zinc-200 whitespace-pre-wrap">{battle.prompt}</pre>
        </div>
      </div>
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-0 min-h-0">
        {slots.map((s, i) => {
          const isWinner = battle.winner === s.key;
          const isTie = battle.winner === "tie";
          const delta = s.elo_after - s.elo_before;
          return (
            <section key={s.key} className={cn(
              "flex flex-col border-white/[0.04] min-h-0",
              i < slots.length - 1 && "md:border-r",
              isWinner && "bg-indigo-950/10",
              isTie && "bg-amber-950/5",
            )}>
              <div className="px-5 py-3 border-b border-white/[0.04] flex items-center gap-3">
                <span className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold",
                  isWinner ? "bg-indigo-500/25 text-indigo-200" :
                  isTie ? "bg-amber-500/15 text-amber-200" : "bg-zinc-800/50 text-zinc-400",
                )}>{String.fromCharCode(65 + i)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-zinc-100 truncate">{s.display}</div>
                  <div className="text-[11px] text-zinc-500 font-mono">
                    ELO {Math.round(s.elo_before)} → {Math.round(s.elo_after)}
                    <span className={cn("ml-1", delta > 0 ? "text-emerald-400" : delta < 0 ? "text-red-400" : "")}>
                      ({delta >= 0 ? "+" : ""}{delta.toFixed(1)})
                    </span>
                  </div>
                </div>
                {isWinner && <Trophy className="w-4 h-4 text-indigo-300" />}
                {isTie && <Minus className="w-4 h-4 text-amber-300" />}
              </div>
              <pre className="flex-1 overflow-y-auto px-5 py-4 text-sm text-zinc-300 whitespace-pre-wrap">{s.response}</pre>
            </section>
          );
        })}
      </div>
    </div>
  );
}
