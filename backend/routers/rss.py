"""RSS Feed — feed of benchmark results and arena battles."""
import time
from fastapi import APIRouter
from fastapi.responses import Response
import aiosqlite
from db.database import DB_PATH

router = APIRouter()

@router.get("/rss/feed.xml")
async def rss_feed():
    items = []
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            # Recent benchmarks
            async with db.execute("SELECT id, name, created_at FROM benchmark_runs ORDER BY created_at DESC LIMIT 10") as cur:
                async for row in cur:
                    items.append({"title": f"Benchmark: {row[1] or 'Untitled'}", "link": f"/benchmark/run/{row[0]}", "date": row[2], "desc": f"Benchmark run completed"})
            # Recent arena battles
            async with db.execute("SELECT id, model_a, model_b, winner, created_at FROM arena_battles ORDER BY created_at DESC LIMIT 10") as cur:
                async for row in cur:
                    winner = row[2] if row[3] == "model_b" else row[1] if row[3] == "model_a" else "Tie"
                    items.append({"title": f"Arena: {row[1]} vs {row[2]}", "link": f"/arena", "date": row[4], "desc": f"Winner: {winner}"})
    except: pass

    items.sort(key=lambda x: x.get("date", ""), reverse=True)

    rss = '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n<channel>\n'
    rss += '<title>Crucible Feed</title>\n<link>http://localhost:3000</link>\n'
    rss += '<description>Crucible LLM management updates</description>\n'
    for item in items[:20]:
        rss += f'<item><title>{item["title"]}</title><link>http://localhost:3000{item["link"]}</link>'
        rss += f'<description>{item["desc"]}</description><pubDate>{item["date"]}</pubDate></item>\n'
    rss += '</channel>\n</rss>'
    return Response(content=rss, media_type="application/rss+xml")
