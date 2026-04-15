"""Inference profiler — captures per-request performance breakdowns."""

import logging
from datetime import datetime, timezone

import aiosqlite

from db.database import DB_PATH
from benchmark.metrics import get_memory_pressure, get_thermal_state

log = logging.getLogger(__name__)


async def record_profile(
    model_id: str,
    model_name: str,
    prompt_tokens: int | None = None,
    output_tokens: int | None = None,
    total_ms: float | None = None,
    ttft_ms: float | None = None,
    tps: float | None = None,
    prompt_tps: float | None = None,
    memory_start: float | None = None,
    memory_end: float | None = None,
    thermal: str | None = None,
    dflash_enabled: bool = False,
    source: str = "chat",
) -> None:
    """Record an inference profile to SQLite."""
    prefill_ms = ttft_ms  # TTFT ≈ prefill time for single requests
    decode_ms = (total_ms - ttft_ms) if total_ms and ttft_ms else None
    now = datetime.now(timezone.utc).isoformat()

    try:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                """INSERT INTO inference_profiles
                   (model_id, model_name, created_at, prompt_tokens, output_tokens,
                    total_ms, ttft_ms, prefill_ms, decode_ms, tps, prompt_tps,
                    memory_pressure_start, memory_pressure_end, thermal_state,
                    dflash_enabled, source)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (model_id, model_name, now, prompt_tokens, output_tokens,
                 total_ms, ttft_ms, prefill_ms, decode_ms, tps, prompt_tps,
                 memory_start, memory_end, thermal, int(dflash_enabled), source),
            )
            await db.commit()
    except Exception as e:
        log.warning("Failed to record profile: %s", e)


async def get_profiles(model_id: str | None = None, limit: int = 100) -> list[dict]:
    """Get recent inference profiles, optionally filtered by model."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        if model_id:
            sql = "SELECT * FROM inference_profiles WHERE model_id = ? ORDER BY created_at DESC LIMIT ?"
            params = (model_id, limit)
        else:
            sql = "SELECT * FROM inference_profiles ORDER BY created_at DESC LIMIT ?"
            params = (limit,)
        async with db.execute(sql, params) as cur:
            return [dict(row) async for row in cur]


async def get_model_stats() -> list[dict]:
    """Aggregate stats per model from profiler data."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        sql = """
        SELECT model_id, model_name,
               COUNT(*) as request_count,
               AVG(tps) as avg_tps,
               MAX(tps) as max_tps,
               MIN(tps) as min_tps,
               AVG(ttft_ms) as avg_ttft_ms,
               AVG(total_ms) as avg_total_ms,
               AVG(prefill_ms) as avg_prefill_ms,
               AVG(decode_ms) as avg_decode_ms,
               SUM(output_tokens) as total_tokens,
               AVG(memory_pressure_start) as avg_memory
        FROM inference_profiles
        GROUP BY model_id
        ORDER BY request_count DESC
        """
        async with db.execute(sql) as cur:
            return [
                {k: (round(v, 2) if isinstance(v, float) else v) for k, v in dict(row).items()}
                async for row in cur
            ]
