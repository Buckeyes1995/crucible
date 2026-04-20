"""Reddit LLM-channel watcher router."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

import reddit_watcher as rw

router = APIRouter()


@router.get("/reddit/config")
async def get_config() -> dict[str, Any]:
    return rw.load_config()


class ConfigUpdate(BaseModel):
    enabled: bool | None = None
    client_id: str | None = None
    client_secret: str | None = None
    user_agent: str | None = None
    subreddits: list[str] | None = None
    max_post_chars: int | None = None
    max_post_age_hours: int | None = None
    min_score: int | None = None
    draft_system_prompt: str | None = None
    auto_draft_on_scan: bool | None = None


@router.put("/reddit/config")
async def set_config(body: ConfigUpdate) -> dict[str, Any]:
    cfg = rw.load_config()
    for k, v in body.model_dump(exclude_none=True).items():
        cfg[k] = v
    rw.save_config(cfg)
    return cfg


@router.get("/reddit/drafts")
async def list_drafts(status: str | None = None) -> list[dict]:
    return rw.list_drafts(status)


class DraftUpdate(BaseModel):
    draft: str | None = None
    status: str | None = None   # pending | approved | rejected | posted


@router.put("/reddit/drafts/{draft_id}")
async def update_draft(draft_id: str, body: DraftUpdate) -> dict:
    d = rw.update_draft(draft_id, **body.model_dump(exclude_none=True))
    if not d:
        raise HTTPException(404, "draft not found")
    return d


@router.delete("/reddit/drafts/{draft_id}")
async def delete_draft(draft_id: str) -> dict:
    if not rw.delete_draft(draft_id):
        raise HTTPException(404, "draft not found")
    return {"status": "deleted"}


@router.post("/reddit/scan")
async def scan(request: Request) -> dict:
    """Kick off a scan-and-draft pass right now. Uses the currently-active
    model to generate drafts."""
    cfg = rw.load_config()
    adapter = getattr(request.app.state, "active_adapter", None)
    if adapter is None or not adapter.is_loaded():
        raise HTTPException(400, "no model loaded; load one in /models first")
    app_cfg = request.app.state.config
    base_url = getattr(adapter, "base_url", None) or app_cfg.mlx_external_url or "http://127.0.0.1:8000"
    api_key = getattr(adapter, "api_key", "") or app_cfg.omlx_api_key
    # oMLX expects the bare directory name; for other adapters model_id is fine.
    model_name = getattr(adapter, "server_model_id", None) or adapter.model_id
    return await rw.scan_and_draft(cfg, base_url, api_key, model_name)
