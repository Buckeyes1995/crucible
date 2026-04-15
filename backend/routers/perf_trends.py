"""Performance Trends — tok/s trends over time per model."""
from fastapi import APIRouter
import aiosqlite
from db.database import DB_PATH

router = APIRouter()

@router.get("/analytics/performance")
async def perf_trends(model_id: str | None = None) -> dict:
    trends = []
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            if model_id:
                sql = """SELECT date(created_at) as d, model_name, AVG(tps), AVG(ttft_ms), COUNT(*)
                         FROM inference_profiles WHERE model_id = ? GROUP BY d ORDER BY d DESC LIMIT 90"""
                params = (model_id,)
            else:
                sql = """SELECT date(created_at) as d, model_name, AVG(tps), AVG(ttft_ms), COUNT(*)
                         FROM inference_profiles GROUP BY d, model_name ORDER BY d DESC LIMIT 200"""
                params = ()
            async with db.execute(sql, params) as cur:
                async for row in cur:
                    trends.append({"date": row[0], "model": row[1], "avg_tps": round(row[2], 2) if row[2] else None,
                                   "avg_ttft_ms": round(row[3], 1) if row[3] else None, "requests": row[4]})
    except Exception:
        pass
    return {"trends": trends[::-1]}

@router.get("/analytics/thermal-history")
async def thermal_history() -> dict:
    data = []
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("""
                SELECT date(created_at) as d, thermal_state, COUNT(*)
                FROM inference_profiles WHERE thermal_state IS NOT NULL
                GROUP BY d, thermal_state ORDER BY d
            """) as cur:
                async for row in cur:
                    data.append({"date": row[0], "state": row[1], "count": row[2]})
    except Exception:
        pass
    return {"data": data}

@router.get("/analytics/memory-timeline")
async def memory_timeline() -> dict:
    data = []
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("""
                SELECT created_at, model_name, memory_pressure_start
                FROM inference_profiles WHERE memory_pressure_start IS NOT NULL
                ORDER BY created_at DESC LIMIT 500
            """) as cur:
                async for row in cur:
                    data.append({"ts": row[0], "model": row[1], "memory": round(row[2], 3) if row[2] else None})
    except Exception:
        pass
    return {"data": data[::-1]}
