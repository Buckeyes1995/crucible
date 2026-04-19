"""Data-driven model recommender.

Pulls ELO from arena_elo, avg tok/s from the benchmark history, and chat
usage from chat_sessions to synthesize per-model recommendations grounded in
the user's actual usage. Replaces the static-heuristic recommender on models
that have enough accumulated data.
"""
from __future__ import annotations

import aiosqlite
from collections import Counter
from fastapi import APIRouter, Request

from db.database import DB_PATH

router = APIRouter()


async def _arena_stats() -> dict[str, dict]:
    """model_id -> {elo, wins, losses, ties}"""
    stats: dict[str, dict] = {}
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        try:
            async with db.execute("SELECT * FROM arena_elo") as cur:
                async for row in cur:
                    stats[row["model_id"]] = {
                        "elo": row["elo"],
                        "wins": row["wins"] or 0,
                        "losses": row["losses"] or 0,
                        "ties": row["ties"] or 0,
                    }
        except Exception:
            pass
    return stats


async def _bench_stats() -> dict[str, dict]:
    """model_id -> {avg_tps, runs}"""
    stats: dict[str, dict] = {}
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        try:
            async with db.execute(
                """SELECT model_id, AVG(throughput_tps) AS avg_tps, COUNT(*) AS runs
                   FROM benchmark_results
                   WHERE throughput_tps IS NOT NULL
                   GROUP BY model_id"""
            ) as cur:
                async for row in cur:
                    stats[row["model_id"]] = {
                        "avg_tps": row["avg_tps"],
                        "runs": row["runs"],
                    }
        except Exception:
            pass
    return stats


async def _chat_usage() -> dict[str, int]:
    """model_id -> sessions_count"""
    async with aiosqlite.connect(DB_PATH) as db:
        try:
            async with db.execute(
                "SELECT model_id, COUNT(*) AS n FROM chat_sessions WHERE model_id IS NOT NULL GROUP BY model_id"
            ) as cur:
                rows = await cur.fetchall()
            return {r[0]: r[1] for r in rows}
        except Exception:
            return {}


@router.get("/recommender/v2")
async def v2(request: Request) -> dict:
    """Synthesize recommendations from actual usage + benchmark + arena data."""
    registry = request.app.state.registry
    local_models = [m for m in registry.all() if m.node == "local" and not m.hidden]

    arena = await _arena_stats()
    bench = await _bench_stats()
    chat = await _chat_usage()

    rows = []
    max_tps = max((bench[mid]["avg_tps"] for mid in bench if bench[mid].get("avg_tps")), default=1) or 1
    max_elo = max((s["elo"] for s in arena.values()), default=1500) or 1500
    min_elo = min((s["elo"] for s in arena.values()), default=1500)
    elo_range = (max_elo - min_elo) or 1

    for m in local_models:
        a = arena.get(m.id)
        b = bench.get(m.id)
        c = chat.get(m.id, 0)

        # Normalized 0..1 sub-scores
        speed_score = (b["avg_tps"] / max_tps) if b and b.get("avg_tps") else 0
        quality_score = ((a["elo"] - min_elo) / elo_range) if a else 0.5  # neutral if no arena data
        # Chat-usage-weighted preference — user's observed preference is a signal
        # independent of objective quality.
        preference_score = min(1.0, c / 10.0)

        # Combined — tunable weights
        combined = round(0.4 * quality_score + 0.4 * speed_score + 0.2 * preference_score, 3)

        rows.append({
            "model_id": m.id,
            "name": m.name,
            "kind": m.kind,
            "size_bytes": m.size_bytes,
            "elo": a["elo"] if a else None,
            "battles": (a["wins"] + a["losses"] + a["ties"]) if a else 0,
            "avg_tps": b["avg_tps"] if b else None,
            "bench_runs": b["runs"] if b else 0,
            "chat_sessions": c,
            "scores": {
                "quality": round(quality_score, 3),
                "speed": round(speed_score, 3),
                "preference": round(preference_score, 3),
            },
            "combined": combined,
        })

    rows.sort(key=lambda r: r["combined"], reverse=True)

    # Actionable buckets
    insights: list[str] = []
    if rows and rows[0]["combined"] >= 0.7:
        insights.append(
            f"{rows[0]['name']} is your top overall pick (score {rows[0]['combined']}) — "
            f"high quality + speed on the prompts you've run."
        )
    fast_but_unused = [r for r in rows if r["scores"]["speed"] >= 0.8 and r["chat_sessions"] < 2]
    if fast_but_unused:
        insights.append(
            f"{fast_but_unused[0]['name']} is fast ({fast_but_unused[0]['avg_tps']:.1f} tok/s) "
            f"but you've barely used it ({fast_but_unused[0]['chat_sessions']} chat sessions) — "
            f"worth a trial."
        )
    under_benched = [r for r in rows if r["bench_runs"] < 3 and r["battles"] < 3]
    if under_benched:
        insights.append(
            f"{len(under_benched)} models lack both benchmark and arena data — "
            f"queue an autobattle / benchmark run to improve recommendations."
        )

    return {
        "total_models": len(rows),
        "rows": rows,
        "insights": insights,
    }
