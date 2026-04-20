"""Notification routes — send certain events (model_update, auto_bench_done,
arena_complete) to external channels like Slack/Discord/email via configured
webhooks. Piggy-backs on the existing webhooks.py dispatcher; this module
just tracks which route is enabled for which event.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

ROUTES_FILE = Path.home() / ".config" / "crucible" / "notification_routes.json"


DEFAULTS: list[dict] = [
    {
        "id": "route_default",
        "name": "Default",
        "event": "*",                 # catch-all
        "target": {"kind": "none"},   # "slack" | "discord" | "webhook" | "none"
        "enabled": False,
    },
]


def _load() -> list[dict]:
    if not ROUTES_FILE.exists():
        return list(DEFAULTS)
    try:
        return json.loads(ROUTES_FILE.read_text())
    except Exception:
        return list(DEFAULTS)


def _save(items: list[dict]) -> None:
    ROUTES_FILE.parent.mkdir(parents=True, exist_ok=True)
    ROUTES_FILE.write_text(json.dumps(items, indent=2))


def list_routes() -> list[dict]:
    return _load()


def add_route(name: str, event: str, target: dict[str, Any]) -> dict:
    items = _load()
    entry = {
        "id": f"route_{int(time.time())}",
        "name": name,
        "event": event,
        "target": target,
        "enabled": True,
    }
    items.append(entry)
    _save(items)
    return entry


def update_route(route_id: str, **fields: Any) -> dict | None:
    items = _load()
    for r in items:
        if r["id"] == route_id:
            for k in ("name", "event", "target", "enabled"):
                if k in fields and fields[k] is not None:
                    r[k] = fields[k]
            _save(items)
            return r
    return None


def delete_route(route_id: str) -> bool:
    items = _load()
    new = [r for r in items if r["id"] != route_id]
    if len(new) == len(items):
        return False
    _save(new)
    return True


async def fire(event: str, payload: dict) -> None:
    """Route an event to any matching enabled targets. Non-blocking as far as
    callers should be concerned — failures are logged, never raised."""
    import logging
    import httpx
    log = logging.getLogger(__name__)
    for r in _load():
        if not r.get("enabled"):
            continue
        if r["event"] != "*" and r["event"] != event:
            continue
        target = r.get("target") or {}
        kind = target.get("kind")
        url = target.get("url") or ""
        if not url:
            continue
        body: dict[str, Any]
        if kind in ("slack", "discord"):
            body = {"text": f"[{event}] {json.dumps(payload)[:400]}"}
        else:
            body = {"event": event, "payload": payload}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post(url, json=body)
        except Exception as e:
            log.warning("notification_routes: fire failed for %s: %s", r.get("id"), e)
