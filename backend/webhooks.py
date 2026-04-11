"""Webhook registry and dispatcher."""

import asyncio
import json
import logging
import time
import uuid
from pathlib import Path
from typing import Optional

import aiohttp

log = logging.getLogger(__name__)

WEBHOOKS_FILE = Path.home() / ".config" / "crucible" / "webhooks.json"

VALID_EVENTS = {"model.loaded", "model.unloaded", "benchmark.done", "download.done"}


def _load() -> list[dict]:
    if not WEBHOOKS_FILE.exists():
        return []
    try:
        return json.loads(WEBHOOKS_FILE.read_text())
    except Exception:
        return []


def _save(hooks: list[dict]) -> None:
    WEBHOOKS_FILE.parent.mkdir(parents=True, exist_ok=True)
    WEBHOOKS_FILE.write_text(json.dumps(hooks, indent=2))


def list_webhooks() -> list[dict]:
    return _load()


def add_webhook(url: str, events: list[str], secret: Optional[str] = None) -> dict:
    hooks = _load()
    hook = {
        "id": str(uuid.uuid4()),
        "url": url,
        "events": events,
        "secret": secret,
        "enabled": True,
        "created_at": time.time(),
    }
    hooks.append(hook)
    _save(hooks)
    return hook


def update_webhook(hook_id: str, **kwargs) -> Optional[dict]:
    hooks = _load()
    for h in hooks:
        if h["id"] == hook_id:
            for k, v in kwargs.items():
                if k in ("url", "events", "secret", "enabled"):
                    h[k] = v
            _save(hooks)
            return h
    return None


def delete_webhook(hook_id: str) -> bool:
    hooks = _load()
    new = [h for h in hooks if h["id"] != hook_id]
    if len(new) == len(hooks):
        return False
    _save(new)
    return True


async def fire(event: str, payload: dict) -> None:
    hooks = _load()
    targets = [h for h in hooks if h.get("enabled") and event in h.get("events", [])]
    if not targets:
        return

    body = json.dumps({"event": event, "ts": time.time(), **payload})

    async def _post(hook: dict) -> None:
        headers = {"Content-Type": "application/json"}
        if hook.get("secret"):
            headers["X-Crucible-Secret"] = hook["secret"]
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    hook["url"],
                    data=body,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as resp:
                    if resp.status >= 400:
                        log.warning(
                            "Webhook %s → %s returned %d",
                            event,
                            hook["url"],
                            resp.status,
                        )
        except Exception as e:
            log.warning("Webhook %s → %s failed: %s", event, hook["url"], e)

    await asyncio.gather(*[_post(h) for h in targets])
