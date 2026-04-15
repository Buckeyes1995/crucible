"""Model Leaderboard — cross-benchmark aggregate rankings."""
import json
from fastapi import APIRouter
import aiosqlite
from db.database import DB_PATH

router = APIRouter()

@router.get("/leaderboard/models")
async def model_leaderboard() -> list[dict]:
    """Aggregate model rankings across all benchmark runs."""
    results = []
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("""
                SELECT model_id, model_name,
                       COUNT(DISTINCT run_id) as runs,
                       COUNT(*) as total_samples,
                       AVG(json_extract(metrics_json, '$.throughput_tps')) as avg_tps,
                       MAX(json_extract(metrics_json, '$.throughput_tps')) as max_tps,
                       AVG(json_extract(metrics_json, '$.ttft_ms')) as avg_ttft,
                       SUM(json_extract(metrics_json, '$.output_tokens')) as total_tokens
                FROM benchmark_results
                WHERE json_extract(metrics_json, '$.throughput_tps') IS NOT NULL
                GROUP BY model_id
                ORDER BY avg_tps DESC
            """) as cur:
                rank = 0
                async for row in cur:
                    rank += 1
                    results.append({
                        "rank": rank,
                        "model_id": row[0],
                        "model_name": row[1],
                        "benchmark_runs": row[2],
                        "total_samples": row[3],
                        "avg_tps": round(row[4], 2) if row[4] else None,
                        "max_tps": round(row[5], 2) if row[5] else None,
                        "avg_ttft_ms": round(row[6], 1) if row[6] else None,
                        "total_tokens": row[7] or 0,
                    })
    except Exception:
        pass
    return results
