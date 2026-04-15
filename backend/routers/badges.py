"""Benchmark Badges — embeddable SVG badges for model stats."""
from fastapi import APIRouter
from fastapi.responses import Response
import aiosqlite
from db.database import DB_PATH

router = APIRouter()

def _svg_badge(label: str, value: str, color: str = "#6366f1") -> str:
    lw = len(label) * 7 + 12
    vw = len(value) * 7 + 12
    tw = lw + vw
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{tw}" height="20">
  <rect width="{lw}" height="20" fill="#555" rx="3"/>
  <rect x="{lw}" width="{vw}" height="20" fill="{color}" rx="3"/>
  <rect x="{lw}" width="4" height="20" fill="{color}"/>
  <text x="{lw/2}" y="14" fill="#fff" text-anchor="middle" font-family="sans-serif" font-size="11">{label}</text>
  <text x="{lw + vw/2}" y="14" fill="#fff" text-anchor="middle" font-family="sans-serif" font-size="11">{value}</text>
</svg>"""

@router.get("/badges/model/{model_id:path}.svg")
async def model_badge(model_id: str):
    avg_tps = None
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                "SELECT AVG(json_extract(metrics_json, '$.throughput_tps')) FROM benchmark_results WHERE model_id = ?",
                (model_id,)
            ) as cur:
                row = await cur.fetchone()
                if row and row[0]: avg_tps = round(row[0], 1)
    except: pass

    value = f"{avg_tps} tok/s" if avg_tps else "no data"
    name = model_id.split(":")[-1][:20]
    svg = _svg_badge(name, value)
    return Response(content=svg, media_type="image/svg+xml", headers={"Cache-Control": "max-age=300"})

@router.get("/badges/arena/{model_id:path}.svg")
async def arena_badge(model_id: str):
    elo = None
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("SELECT elo FROM arena_elo WHERE model_id = ?", (model_id,)) as cur:
                row = await cur.fetchone()
                if row: elo = round(row[0])
    except: pass

    value = f"ELO {elo}" if elo else "no data"
    svg = _svg_badge(model_id[:20], value, "#f59e0b")
    return Response(content=svg, media_type="image/svg+xml", headers={"Cache-Control": "max-age=300"})
