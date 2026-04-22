"""HTTP surface for the AI news digest — GET cached digest, SSE refresh,
config CRUD. Pairs with backend/news_watcher.py."""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import news_watcher

router = APIRouter()


@router.get("/news")
async def get_news() -> dict[str, Any]:
    """Cached digest grouped by source. Fast — no model calls."""
    return news_watcher.grouped_digest()


@router.get("/news/config")
async def get_config() -> dict[str, Any]:
    return news_watcher.load_config()


class NewsConfig(BaseModel):
    enabled: bool | None = None
    sources: list[dict[str, Any]] | None = None
    keyword_filter: list[str] | None = None
    max_items_per_source: int | None = None
    max_age_hours: int | None = None
    summarize_system_prompt: str | None = None
    summarize_endpoint: str | None = None


@router.put("/news/config")
async def put_config(body: NewsConfig) -> dict[str, Any]:
    cfg = news_watcher.load_config()
    for k, v in body.model_dump(exclude_none=True).items():
        cfg[k] = v
    news_watcher.save_config(cfg)
    return cfg


@router.post("/news/refresh")
async def refresh(request: Request) -> StreamingResponse:
    """Fetch feeds + re-summarize stale items. SSE stream of phase + item
    events so the UI can show progress live."""
    adapter = request.app.state.active_adapter
    model_id = adapter.model_id if adapter and adapter.is_loaded() else None

    async def _stream():
        # Pad each event so tunnels don't buffer them.
        async for evt in news_watcher.refresh(model_id=model_id):
            line = json.dumps(evt)
            yield f"data: {line}\n\n".encode()

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.delete("/news/item/{item_id}")
async def delete_item(item_id: str) -> dict[str, Any]:
    """Manually dismiss an item from the digest — useful for noise from a
    source we can't keyword-filter cleanly."""
    d = news_watcher.load_digest()
    items = d.get("items") or {}
    items.pop(item_id, None)
    d["items"] = items
    news_watcher.save_digest(d)
    return {"status": "deleted"}
