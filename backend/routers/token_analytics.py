"""Token Analytics — tokens generated per day/week/month."""
from fastapi import APIRouter
import aiosqlite
from db.database import DB_PATH

router = APIRouter()

@router.get("/analytics/tokens")
async def token_analytics() -> dict:
    daily = []; weekly = []; by_model = []
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("""
                SELECT date(created_at) as d, SUM(output_tokens) as tokens, COUNT(*) as requests
                FROM inference_profiles GROUP BY d ORDER BY d DESC LIMIT 90
            """) as cur:
                async for row in cur:
                    daily.append({"date": row[0], "tokens": row[1] or 0, "requests": row[2]})

            async with db.execute("""
                SELECT strftime('%Y-W%W', created_at) as w, SUM(output_tokens), COUNT(*)
                FROM inference_profiles GROUP BY w ORDER BY w DESC LIMIT 12
            """) as cur:
                async for row in cur:
                    weekly.append({"week": row[0], "tokens": row[1] or 0, "requests": row[2]})

            async with db.execute("""
                SELECT model_name, SUM(output_tokens) as tokens, COUNT(*) as requests, AVG(tps) as avg_tps
                FROM inference_profiles GROUP BY model_name ORDER BY tokens DESC LIMIT 20
            """) as cur:
                async for row in cur:
                    by_model.append({"model": row[0], "tokens": row[1] or 0, "requests": row[2], "avg_tps": round(row[3], 2) if row[3] else None})
    except Exception:
        pass
    return {"daily": daily[::-1], "weekly": weekly[::-1], "by_model": by_model}
