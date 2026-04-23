"""Automation triggers router (Roadmap v4 #8)."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import aiosqlite
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from db.database import DB_PATH

router = APIRouter()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class TriggerIn(BaseModel):
    name: str
    enabled: bool = True
    condition_type: str
    condition_args: dict[str, Any]
    action_type: str
    action_args: dict[str, Any]


class TriggerPatch(BaseModel):
    name: Optional[str] = None
    enabled: Optional[bool] = None
    condition_type: Optional[str] = None
    condition_args: Optional[dict[str, Any]] = None
    action_type: Optional[str] = None
    action_args: Optional[dict[str, Any]] = None


@router.get("/automation/triggers")
async def list_triggers() -> list[dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM automation_triggers ORDER BY datetime(updated_at) DESC"
        ) as cur:
            rows = [dict(r) async for r in cur]
    for r in rows:
        try: r["condition_args"] = json.loads(r.pop("condition_args_json") or "{}")
        except Exception: r["condition_args"] = {}
        try: r["action_args"] = json.loads(r.pop("action_args_json") or "{}")
        except Exception: r["action_args"] = {}
        r["enabled"] = bool(r.get("enabled"))
    return rows


@router.post("/automation/triggers", status_code=201)
async def create_trigger(body: TriggerIn) -> dict[str, Any]:
    tid = uuid.uuid4().hex[:12]
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO automation_triggers (id, name, enabled, condition_type, condition_args_json, "
            "action_type, action_args_json, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (tid, body.name.strip() or "trigger", 1 if body.enabled else 0,
             body.condition_type, json.dumps(body.condition_args or {}),
             body.action_type, json.dumps(body.action_args or {}),
             now, now),
        )
        await db.commit()
    return await get_trigger(tid)


@router.get("/automation/triggers/{tid}")
async def get_trigger(tid: str) -> dict[str, Any]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM automation_triggers WHERE id = ?", (tid,)) as cur:
            row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "Trigger not found")
        async with db.execute(
            "SELECT * FROM automation_fires WHERE trigger_id = ? ORDER BY datetime(fired_at) DESC LIMIT 20",
            (tid,),
        ) as cur:
            fires = [dict(r) async for r in cur]
    d = dict(row)
    try: d["condition_args"] = json.loads(d.pop("condition_args_json") or "{}")
    except Exception: d["condition_args"] = {}
    try: d["action_args"] = json.loads(d.pop("action_args_json") or "{}")
    except Exception: d["action_args"] = {}
    d["enabled"] = bool(d.get("enabled"))
    d["fires"] = fires
    return d


@router.put("/automation/triggers/{tid}")
async def update_trigger(tid: str, body: TriggerPatch) -> dict[str, Any]:
    fields = body.model_dump(exclude_none=True)
    if not fields:
        return await get_trigger(tid)
    cols: list[str] = []
    values: list[Any] = []
    for k, v in fields.items():
        if k == "enabled":
            cols.append("enabled = ?"); values.append(1 if v else 0)
        elif k == "condition_args":
            cols.append("condition_args_json = ?"); values.append(json.dumps(v))
        elif k == "action_args":
            cols.append("action_args_json = ?"); values.append(json.dumps(v))
        else:
            cols.append(f"{k} = ?"); values.append(v)
    values.append(_now()); values.append(tid)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            f"UPDATE automation_triggers SET {', '.join(cols)}, updated_at = ? WHERE id = ?",
            values,
        )
        await db.commit()
    return await get_trigger(tid)


@router.delete("/automation/triggers/{tid}")
async def delete_trigger(tid: str) -> dict[str, Any]:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        await db.execute("DELETE FROM automation_triggers WHERE id = ?", (tid,))
        await db.commit()
    return {"status": "deleted"}


@router.post("/automation/triggers/{tid}/fire-test")
async def test_fire(tid: str, request: Request) -> dict[str, Any]:
    """Force-execute the action without evaluating the condition. Useful for
    'will my webhook actually fire?' debugging."""
    from automation import _do_action
    t = await get_trigger(tid)
    t["_action_args"] = t.get("action_args") or {}
    try:
        msg = await _do_action(t, request.app.state)
        status = "ok"
        error = None
    except Exception as e:
        msg = str(e); status = "error"; error = str(e)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO automation_fires (trigger_id, fired_at, status, message) VALUES (?, ?, ?, ?)",
            (tid, _now(), status, f"(test) {msg}"),
        )
        await db.execute(
            "UPDATE automation_triggers SET last_fired_at = ?, last_error = ?, fire_count = fire_count + 1, updated_at = ? WHERE id = ?",
            (_now(), error, _now(), tid),
        )
        await db.commit()
    return {"status": status, "message": msg}
