"""Webhook CRUD endpoints."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

import webhooks as wh

router = APIRouter()


class WebhookCreate(BaseModel):
    url: str
    events: list[str]
    secret: Optional[str] = None


class WebhookUpdate(BaseModel):
    url: Optional[str] = None
    events: Optional[list[str]] = None
    secret: Optional[str] = None
    enabled: Optional[bool] = None


@router.get("/webhooks")
def list_hooks() -> list[dict]:
    return wh.list_webhooks()


@router.post("/webhooks", status_code=201)
def create_hook(body: WebhookCreate) -> dict:
    bad = [e for e in body.events if e not in wh.VALID_EVENTS]
    if bad:
        raise HTTPException(400, f"Unknown events: {bad}. Valid: {sorted(wh.VALID_EVENTS)}")
    return wh.add_webhook(url=body.url, events=body.events, secret=body.secret)


@router.put("/webhooks/{hook_id}")
def update_hook(hook_id: str, body: WebhookUpdate) -> dict:
    updates = body.model_dump(exclude_none=True)
    if "events" in updates:
        bad = [e for e in updates["events"] if e not in wh.VALID_EVENTS]
        if bad:
            raise HTTPException(400, f"Unknown events: {bad}")
    result = wh.update_webhook(hook_id, **updates)
    if not result:
        raise HTTPException(404, "Webhook not found")
    return result


@router.delete("/webhooks/{hook_id}")
def delete_hook(hook_id: str) -> dict:
    if not wh.delete_webhook(hook_id):
        raise HTTPException(404, "Webhook not found")
    return {"status": "deleted"}


@router.post("/webhooks/{hook_id}/test")
async def test_hook(hook_id: str) -> dict:
    hooks = wh.list_webhooks()
    hook = next((h for h in hooks if h["id"] == hook_id), None)
    if not hook:
        raise HTTPException(404, "Webhook not found")
    await wh.fire("model.loaded", {"model_id": "test", "model_name": "Test Ping", "elapsed_ms": 0})
    return {"status": "sent"}
