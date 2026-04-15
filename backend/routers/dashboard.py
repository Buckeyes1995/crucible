"""Dashboard API — aggregated overview data."""

from fastapi import APIRouter, Request
import aiosqlite
from db.database import DB_PATH
from benchmark.metrics import get_memory_pressure, get_thermal_state

router = APIRouter()


@router.get("/dashboard")
async def get_dashboard(request: Request) -> dict:
    adapter = request.app.state.active_adapter
    active_model = adapter.model_id if adapter and adapter.is_loaded() else None

    # System stats
    try:
        mem = get_memory_pressure()
        thermal = get_thermal_state()
    except Exception:
        mem, thermal = None, "unknown"

    # Today's inference count + total tokens
    today_inferences = 0
    today_tokens = 0
    total_inferences = 0
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                "SELECT COUNT(*), COALESCE(SUM(output_tokens),0) FROM inference_profiles WHERE date(created_at) = date('now')"
            ) as cur:
                row = await cur.fetchone()
                if row:
                    today_inferences, today_tokens = row[0], row[1]
            async with db.execute("SELECT COUNT(*) FROM inference_profiles") as cur:
                row = await cur.fetchone()
                if row:
                    total_inferences = row[0]
    except Exception:
        pass

    # Arena top 3
    arena_top = []
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                "SELECT model_id, elo, wins, battles FROM arena_elo ORDER BY elo DESC LIMIT 3"
            ) as cur:
                async for row in cur:
                    arena_top.append({"model_id": row[0], "elo": round(row[1], 1), "wins": row[2], "battles": row[3]})
    except Exception:
        pass

    # Recent benchmark runs
    recent_benchmarks = []
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                "SELECT id, name, created_at FROM benchmark_runs ORDER BY created_at DESC LIMIT 3"
            ) as cur:
                async for row in cur:
                    recent_benchmarks.append({"id": row[0], "name": row[1], "created_at": row[2]})
    except Exception:
        pass

    # Model count
    registry = request.app.state.registry
    model_count = len(registry.all())

    return {
        "active_model": active_model,
        "memory_pressure": mem,
        "thermal_state": thermal,
        "model_count": model_count,
        "today_inferences": today_inferences,
        "today_tokens": today_tokens,
        "total_inferences": total_inferences,
        "arena_top": arena_top,
        "recent_benchmarks": recent_benchmarks,
    }
