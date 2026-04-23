"""Automation / triggers (Roadmap v4 #8 MVP).

Evaluator loop that wakes every N seconds, reads enabled triggers, and
fires the attached action when the condition matches. Designed to be
single-process — the lifespan startup in main.py kicks off exactly one
task that runs for the life of the server.

Condition types shipped in V1:
  cron                — min-granularity, parsed via a simple wildcard matcher
                        (minute hour day month dow). No croniter dep.
  memory_pressure     — {"threshold": 0.85, "direction": "above"|"below"}
  model_loaded        — {"model_id": "<id>"}   (fires on state transition)
  hf_update_available — {} or {"model_id": "<id>"}

Action types:
  notify              — push to notifications + audit log
  load_model          — {"model_id": "<id>"}
  unload_model        — {}
  run_benchmark       — {"preset": "<name>"} (fires /api/auto-bench/run)
  webhook             — {"url": "...", "method": "POST", "body": {...}}

All fires are written to automation_fires for audit.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import aiosqlite
import httpx

from db.database import DB_PATH

log = logging.getLogger(__name__)

TICK_SECONDS = 15
DEDUP_WINDOW = 45   # don't re-fire the same trigger within N seconds


# ── State that evaluators need to see transitions ─────────────────────────

_prev_model_id: Optional[str] = None
_prev_hf_flagged_count: int = 0


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _now_ts() -> float:
    return time.time()


# ── Condition evaluators ──────────────────────────────────────────────────

def _cron_match(expr: str, now: datetime) -> bool:
    """Naive cron matcher: '*/5 * * * *' etc. Fields: min hour day mon dow.
    Supports *, N, */N, comma lists. No ranges."""
    try:
        fields = expr.strip().split()
        if len(fields) != 5:
            return False
        values = [now.minute, now.hour, now.day, now.month, (now.weekday() + 1) % 7]  # sun=0
        for field, v in zip(fields, values):
            if field == "*":
                continue
            if field.startswith("*/"):
                try:
                    step = int(field[2:])
                    if step <= 0 or v % step != 0:
                        return False
                    continue
                except Exception:
                    return False
            parts = field.split(",")
            if str(v) not in parts:
                return False
        return True
    except Exception:
        return False


async def _eval_condition(t: dict, app_state) -> bool:
    global _prev_model_id, _prev_hf_flagged_count
    cond_type = t["condition_type"]
    args = t.get("_cond_args") or {}

    if cond_type == "cron":
        expr = args.get("expr") or "* * * * *"
        return _cron_match(expr, datetime.now(timezone.utc))

    if cond_type == "memory_pressure":
        try:
            import psutil
            pct = 1.0 - (psutil.virtual_memory().available / psutil.virtual_memory().total)
        except Exception:
            return False
        threshold = float(args.get("threshold") or 0.85)
        direction = args.get("direction") or "above"
        return (direction == "above" and pct > threshold) or (direction == "below" and pct < threshold)

    if cond_type == "model_loaded":
        target = args.get("model_id") or ""
        adapter = getattr(app_state, "active_adapter", None)
        cur = adapter.model_id if adapter and adapter.is_loaded() else None
        # Fire on transition only — avoid firing every tick while loaded.
        fired = (cur == target and _prev_model_id != target)
        _prev_model_id = cur
        return fired

    if cond_type == "hf_update_available":
        try:
            import hf_updates
            state = hf_updates.all_state() or {}
            flagged = sum(1 for e in state.values() if e.get("update_available"))
        except Exception:
            return False
        fired = flagged > _prev_hf_flagged_count
        _prev_hf_flagged_count = flagged
        return fired

    return False


# ── Action dispatch ────────────────────────────────────────────────────────

async def _do_action(t: dict, app_state) -> str:
    """Execute the action. Returns a short message for the fire log."""
    action = t["action_type"]
    args = t.get("_action_args") or {}

    if action == "notify":
        text = args.get("text") or f"Trigger {t['name']} fired"
        try:
            import notifications
            notifications.add("automation", text)
        except Exception:
            pass
        try:
            import audit
            audit.record(actor="automation", action="trigger.fire", meta={"trigger": t["name"], "text": text})
        except Exception:
            pass
        return f"notified: {text[:80]}"

    if action == "unload_model":
        adapter = getattr(app_state, "active_adapter", None)
        if adapter and adapter.is_loaded():
            try:
                await adapter.stop()
            except Exception:
                pass
            try:
                app_state.active_adapter = None
            except Exception:
                pass
            return "unloaded active model"
        return "no model loaded"

    if action == "load_model":
        target = args.get("model_id") or ""
        if not target:
            return "missing model_id"
        # Cheat — call our own /api/models/.../load via the proxy port.
        async with httpx.AsyncClient(timeout=300.0) as c:
            try:
                await c.post(f"http://127.0.0.1:7777/api/models/{target}/load")
                return f"requested load of {target}"
            except Exception as e:
                return f"load failed: {e}"

    if action == "run_benchmark":
        preset = args.get("preset") or "quick"
        async with httpx.AsyncClient(timeout=900.0) as c:
            try:
                await c.post("http://127.0.0.1:7777/api/auto-bench/run", json={"preset": preset})
                return f"benchmark started ({preset})"
            except Exception as e:
                return f"benchmark failed: {e}"

    if action == "webhook":
        url = args.get("url")
        method = (args.get("method") or "POST").upper()
        body = args.get("body")
        if not url:
            return "missing url"
        async with httpx.AsyncClient(timeout=30.0) as c:
            try:
                r = await c.request(method, url, json=body)
                return f"webhook {method} {url} → {r.status_code}"
            except Exception as e:
                return f"webhook failed: {e}"

    return f"unknown action: {action}"


# ── Fire loop ─────────────────────────────────────────────────────────────

_last_fire_at: dict[str, float] = {}


async def _tick(app_state) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM automation_triggers WHERE enabled = 1"
        ) as cur:
            triggers = [dict(r) async for r in cur]

    for t in triggers:
        try:
            t["_cond_args"] = json.loads(t.get("condition_args_json") or "{}")
            t["_action_args"] = json.loads(t.get("action_args_json") or "{}")
        except Exception:
            continue
        last = _last_fire_at.get(t["id"], 0.0)
        if _now_ts() - last < DEDUP_WINDOW:
            continue
        try:
            hit = await _eval_condition(t, app_state)
        except Exception as e:
            log.warning("automation: eval error for %s (%s)", t["id"], e)
            continue
        if not hit:
            continue
        _last_fire_at[t["id"]] = _now_ts()
        try:
            msg = await _do_action(t, app_state)
            status, error = "ok", None
        except Exception as e:
            msg = str(e)
            status, error = "error", str(e)

        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "INSERT INTO automation_fires (trigger_id, fired_at, status, message) VALUES (?, ?, ?, ?)",
                (t["id"], _now(), status, msg),
            )
            await db.execute(
                "UPDATE automation_triggers SET last_fired_at = ?, last_error = ?, fire_count = fire_count + 1, updated_at = ? WHERE id = ?",
                (_now(), error, _now(), t["id"]),
            )
            await db.commit()


_loop_task: Optional[asyncio.Task] = None


async def start_loop(app_state) -> None:
    """Spawn the evaluator in the running event loop. Idempotent."""
    global _loop_task
    if _loop_task and not _loop_task.done():
        return

    async def _run():
        while True:
            try:
                await _tick(app_state)
            except Exception as e:
                log.warning("automation loop error: %s", e)
            await asyncio.sleep(TICK_SECONDS)

    _loop_task = asyncio.create_task(_run())


async def stop_loop() -> None:
    global _loop_task
    if _loop_task:
        _loop_task.cancel()
        try:
            await _loop_task
        except asyncio.CancelledError:
            pass
        except Exception:
            pass
        _loop_task = None
