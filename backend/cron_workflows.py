"""Cron-triggered workflow runs — simple N-minutes / specific time-of-day
scheduling that fires existing workflows via /api/workflows/{id}/run.

Much simpler than a real cron: we poll every minute and fire anything due.
State is kept in ~/.config/crucible/cron_workflows.json so schedules
survive restarts.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

STATE_FILE = Path.home() / ".config" / "crucible" / "cron_workflows.json"


def _load() -> list[dict]:
    if not STATE_FILE.exists():
        return []
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return []


def _save(items: list[dict]) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(items, indent=2))


def list_schedules() -> list[dict]:
    return _load()


def add_schedule(workflow_id: str, cadence: str, hour: int | None = None,
                 minute: int | None = None, days: list[int] | None = None,
                 values: dict | None = None) -> dict:
    """cadence: 'hourly' | 'daily' | 'weekly'. For daily/weekly, hour/minute
    are required. For weekly, days is a list of weekday ints (0=Mon)."""
    items = _load()
    entry = {
        "id": f"cron_{int(time.time())}",
        "workflow_id": workflow_id,
        "cadence": cadence,
        "hour": hour, "minute": minute, "days": days or [],
        "values": values or {},
        "enabled": True,
        "created_at": time.time(),
        "last_fired_at": None,
    }
    items.append(entry)
    _save(items)
    return entry


def update_schedule(sched_id: str, **fields: Any) -> dict | None:
    items = _load()
    for s in items:
        if s["id"] == sched_id:
            for k in ("cadence", "hour", "minute", "days", "values", "enabled", "workflow_id"):
                if k in fields and fields[k] is not None:
                    s[k] = fields[k]
            _save(items)
            return s
    return None


def delete_schedule(sched_id: str) -> bool:
    items = _load()
    new = [s for s in items if s["id"] != sched_id]
    if len(new) == len(items):
        return False
    _save(new)
    return True


def _matches(s: dict, now: datetime) -> bool:
    if not s.get("enabled"):
        return False
    cadence = s.get("cadence")
    if cadence == "hourly":
        return now.minute == int(s.get("minute", 0))
    if cadence == "daily":
        return now.hour == int(s.get("hour", 0)) and now.minute == int(s.get("minute", 0))
    if cadence == "weekly":
        days = s.get("days") or []
        if now.weekday() not in days:
            return False
        return now.hour == int(s.get("hour", 0)) and now.minute == int(s.get("minute", 0))
    return False


async def run_loop(app) -> None:
    """Poll every ~60 seconds. Fires matching schedules by posting to the
    local /api/workflows/{id}/run endpoint."""
    import httpx
    last_fire_key: dict[str, str] = {}
    while True:
        try:
            await asyncio.sleep(30)
            now = datetime.now()
            key = now.strftime("%Y%m%d%H%M")
            schedules = _load()
            for s in schedules:
                if not _matches(s, now):
                    continue
                if last_fire_key.get(s["id"]) == key:
                    continue  # already fired this minute
                last_fire_key[s["id"]] = key
                try:
                    async with httpx.AsyncClient(timeout=600.0) as client:
                        await client.post(
                            f"http://127.0.0.1:7777/api/workflows/{s['workflow_id']}/run",
                            json={"values": s.get("values", {})},
                        )
                    s["last_fired_at"] = time.time()
                    _save(_load()[:] + [])  # re-read + save (atomic-ish)
                    # Re-load and update the specific entry — avoid racing with CRUD.
                    items = _load()
                    for x in items:
                        if x["id"] == s["id"]:
                            x["last_fired_at"] = time.time()
                    _save(items)
                    log.info("cron_workflows: fired %s (workflow %s)", s["id"], s["workflow_id"])
                except Exception as e:
                    log.warning("cron_workflows: fire failed for %s: %s", s["id"], e)
        except asyncio.CancelledError:
            return
        except Exception as e:
            log.warning("cron_workflows loop error: %s", e)
