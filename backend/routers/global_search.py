"""Global Search — search across models, benchmarks, chat history."""
from fastapi import APIRouter, Request
import aiosqlite
from db.database import DB_PATH

router = APIRouter()

@router.get("/search")
async def global_search(q: str, request: Request) -> dict:
    results = {"models": [], "benchmarks": [], "chats": [], "arena": []}
    if not q.strip():
        return results
    query = f"%{q}%"
    registry = request.app.state.registry

    # Models
    for m in registry.all():
        if q.lower() in m.name.lower() or q.lower() in m.id.lower():
            results["models"].append({"id": m.id, "name": m.name, "kind": m.kind})
            if len(results["models"]) >= 10:
                break

    try:
        async with aiosqlite.connect(DB_PATH) as db:
            # Benchmarks
            async with db.execute(
                "SELECT id, name, created_at FROM benchmark_runs WHERE name LIKE ? ORDER BY created_at DESC LIMIT 10", (query,)
            ) as cur:
                async for row in cur:
                    results["benchmarks"].append({"id": row[0], "name": row[1], "created_at": row[2]})

            # Chat sessions
            async with db.execute(
                "SELECT id, title, updated_at FROM chat_sessions WHERE title LIKE ? ORDER BY updated_at DESC LIMIT 10", (query,)
            ) as cur:
                async for row in cur:
                    results["chats"].append({"id": row[0], "title": row[1], "updated_at": row[2]})

            # Arena battles
            async with db.execute(
                "SELECT id, model_a, model_b, prompt FROM arena_battles WHERE model_a LIKE ? OR model_b LIKE ? OR prompt LIKE ? LIMIT 10",
                (query, query, query)
            ) as cur:
                async for row in cur:
                    results["arena"].append({"id": row[0], "model_a": row[1], "model_b": row[2], "prompt": row[3][:100]})
    except Exception:
        pass

    return results
