"""Inference Heatmap — activity aggregation by day/hour."""

from fastapi import APIRouter
import aiosqlite
from db.database import DB_PATH

router = APIRouter()


@router.get("/profiler/heatmap")
async def heatmap() -> dict:
    """Returns inference counts grouped by date and by hour."""
    by_date: dict[str, int] = {}
    by_hour: dict[int, int] = {}
    by_model: dict[str, int] = {}
    total = 0

    try:
        async with aiosqlite.connect(DB_PATH) as db:
            # By date
            async with db.execute(
                "SELECT date(created_at) as d, COUNT(*) FROM inference_profiles GROUP BY d ORDER BY d"
            ) as cur:
                async for row in cur:
                    by_date[row[0]] = row[1]
                    total += row[1]

            # By hour
            async with db.execute(
                "SELECT CAST(strftime('%H', created_at) AS INTEGER) as h, COUNT(*) FROM inference_profiles GROUP BY h ORDER BY h"
            ) as cur:
                async for row in cur:
                    by_hour[row[0]] = row[1]

            # By model (top 10)
            async with db.execute(
                "SELECT model_name, COUNT(*) as c FROM inference_profiles GROUP BY model_name ORDER BY c DESC LIMIT 10"
            ) as cur:
                async for row in cur:
                    by_model[row[0]] = row[1]
    except Exception:
        pass

    return {
        "by_date": by_date,
        "by_hour": by_hour,
        "by_model": by_model,
        "total": total,
    }
