"""Smart Router replay validator.

Takes your actual chat history (or a supplied list of prompts), runs each
through the smart-router classifier, and reports: what the router WOULD have
picked, what you actually used, whether routing would have been different,
and a rough "correctness" signal based on chat-message-level reactions when
available.
"""
from __future__ import annotations

import aiosqlite
from collections import Counter
from fastapi import APIRouter, Request
from pydantic import BaseModel

import smart_router
from db.database import DB_PATH

router = APIRouter()


class ReplayRequest(BaseModel):
    limit: int = 200
    source: str = "chat"     # "chat" | "prompts"
    prompts: list[str] | None = None


@router.post("/router-replay")
async def replay(request: Request, body: ReplayRequest) -> dict:
    """Replay prompts through the smart-router classifier and compare what
    the router would pick versus what was actually used.

    Source 'chat' pulls the most recent `limit` user messages from
    chat_messages joined with chat_sessions for the actual model_id. Source
    'prompts' replays a user-supplied list (no actual-model comparison).
    """
    items: list[dict] = []
    if body.source == "chat":
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                """SELECT m.content AS prompt, s.model_id AS actual_model, s.id AS session_id
                   FROM chat_messages m
                   JOIN chat_sessions s ON s.id = m.session_id
                   WHERE m.role = 'user' AND m.content IS NOT NULL AND length(m.content) > 0
                   ORDER BY m.id DESC
                   LIMIT ?""",
                (body.limit,),
            ) as cur:
                async for row in cur:
                    items.append({
                        "prompt": row["prompt"],
                        "actual_model": row["actual_model"],
                        "session_id": row["session_id"],
                    })
    elif body.source == "prompts":
        for p in (body.prompts or [])[: body.limit]:
            items.append({"prompt": p, "actual_model": None, "session_id": None})
    else:
        return {"error": "source must be 'chat' or 'prompts'"}

    # Run classifier over each. smart_router.classify_prompt returns a scores
    # dict; pick the top-scoring category for a coarse "route" signal.
    results = []
    category_counts: Counter[str] = Counter()
    disagreements = 0
    matches = 0
    for item in items:
        scores = smart_router.classify_prompt(item["prompt"])
        best_category = max(scores, key=scores.get) if scores else None
        # Use the full rule-chain to suggest a model — honors enabled-flag,
        # rule priority, filtering, etc. None means "no rule matched, use
        # default".
        try:
            suggested_model = smart_router.select_model(
                item["prompt"],
                [{"name": m.name, "kind": m.kind, "size_bytes": m.size_bytes or 0,
                  "node": m.node} for m in request.app.state.registry.all()],
            )
        except Exception:
            suggested_model = None
        agreed = (
            suggested_model is not None
            and item["actual_model"] is not None
            and item["actual_model"] == suggested_model
        )
        if item["actual_model"]:
            if agreed:
                matches += 1
            else:
                disagreements += 1
        category_counts[best_category or "unknown"] += 1
        results.append({
            "prompt": item["prompt"][:200],  # truncate preview
            "actual_model": item["actual_model"],
            "suggested_model": suggested_model,
            "category": best_category,
            "score": scores.get(best_category) if best_category else None,
            "agreed": agreed,
        })

    total_with_actual = matches + disagreements
    agreement_rate = matches / total_with_actual if total_with_actual else None

    return {
        "count": len(items),
        "matches": matches,
        "disagreements": disagreements,
        "agreement_rate": agreement_rate,
        "category_distribution": dict(category_counts),
        "results": results,
    }
