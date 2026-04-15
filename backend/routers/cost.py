"""Cost Calculator — energy efficiency analysis."""

from fastapi import APIRouter
import aiosqlite
from db.database import DB_PATH

router = APIRouter()

DEFAULT_WATTS = 30.0  # Estimated M2 Max idle + inference watts
ELECTRICITY_RATE = 0.12  # $/kWh default


@router.get("/cost/stats")
async def cost_stats(watts: float = DEFAULT_WATTS, rate: float = ELECTRICITY_RATE) -> dict:
    """Compute cost-per-token and efficiency stats from profiler data."""
    models = []
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("""
                SELECT model_name,
                       COUNT(*) as requests,
                       SUM(output_tokens) as total_tokens,
                       SUM(total_ms) as total_ms,
                       AVG(tps) as avg_tps
                FROM inference_profiles
                WHERE output_tokens > 0
                GROUP BY model_name
                ORDER BY total_tokens DESC
            """) as cur:
                async for row in cur:
                    name, requests, total_tokens, total_ms_sum, avg_tps = row
                    total_seconds = (total_ms_sum or 0) / 1000
                    total_hours = total_seconds / 3600
                    kwh = (watts * total_hours) / 1000
                    cost = kwh * rate
                    cost_per_million = (cost / total_tokens * 1_000_000) if total_tokens > 0 else 0
                    tps_per_watt = (avg_tps / watts) if avg_tps and watts > 0 else 0

                    models.append({
                        "model_name": name,
                        "requests": requests,
                        "total_tokens": total_tokens or 0,
                        "total_seconds": round(total_seconds, 1),
                        "avg_tps": round(avg_tps, 2) if avg_tps else None,
                        "kwh": round(kwh, 4),
                        "cost_usd": round(cost, 4),
                        "cost_per_million_tokens": round(cost_per_million, 4),
                        "tps_per_watt": round(tps_per_watt, 2),
                    })
    except Exception:
        pass

    total_tokens = sum(m["total_tokens"] for m in models)
    total_cost = sum(m["cost_usd"] for m in models)
    total_kwh = sum(m["kwh"] for m in models)

    return {
        "models": models,
        "totals": {
            "tokens": total_tokens,
            "cost_usd": round(total_cost, 4),
            "kwh": round(total_kwh, 4),
        },
        "config": {"watts": watts, "rate_per_kwh": rate},
    }
