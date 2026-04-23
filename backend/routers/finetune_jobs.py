"""Fine-tuning jobs (Roadmap v4 #7 scaffold) — V1 is metadata + loss-curve
capture only. Actual training is delegated to a user-run CLI (mlx_lm.lora
or similar); this router tracks job config, status, and optional
stdout parsing for loss events.

Why a scaffold: real fine-tuning runs for hours and owning the training
process is its own project. Tracking attempts + their curves is the
lowest-risk step that still builds user habit around the workflow.

Routes:
  GET    /finetune/jobs                     list
  POST   /finetune/jobs                     create (status=draft)
  GET    /finetune/jobs/{id}                detail
  PUT    /finetune/jobs/{id}                patch config + status
  POST   /finetune/jobs/{id}/status         update status + error
  POST   /finetune/jobs/{id}/loss           append a loss-curve point {step, loss, eval_loss?}
  DELETE /finetune/jobs/{id}

  POST   /finetune/datasets/from-chats      draft a JSONL dataset from
                                            selected chat_session ids
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import aiosqlite
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db.database import DB_PATH

router = APIRouter()

DATASETS_DIR = Path.home() / ".config" / "crucible" / "finetune" / "datasets"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class JobIn(BaseModel):
    name: str
    base_model_id: str
    dataset_path: str
    lora_rank: int = 8
    lora_alpha: int = 16
    learning_rate: float = 1e-4
    max_steps: int = 200


class JobPatch(BaseModel):
    name: Optional[str] = None
    dataset_path: Optional[str] = None
    lora_rank: Optional[int] = None
    lora_alpha: Optional[int] = None
    learning_rate: Optional[float] = None
    max_steps: Optional[int] = None
    status: Optional[str] = None
    adapter_path: Optional[str] = None
    log_path: Optional[str] = None
    error: Optional[str] = None


class StatusUpdate(BaseModel):
    status: str
    error: Optional[str] = None


class LossPoint(BaseModel):
    step: int
    loss: float
    eval_loss: Optional[float] = None


class DatasetFromChats(BaseModel):
    name: str
    session_ids: list[str]


@router.get("/finetune/jobs")
async def list_jobs() -> list[dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, name, base_model_id, dataset_path, lora_rank, lora_alpha, learning_rate, "
            "max_steps, status, adapter_path, error, created_at, started_at, finished_at "
            "FROM finetune_jobs ORDER BY datetime(created_at) DESC"
        ) as cur:
            return [dict(r) async for r in cur]


@router.post("/finetune/jobs", status_code=201)
async def create_job(body: JobIn) -> dict[str, Any]:
    jid = uuid.uuid4().hex[:12]
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO finetune_jobs (id, name, base_model_id, dataset_path, lora_rank, "
            "lora_alpha, learning_rate, max_steps, status, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)",
            (jid, body.name.strip() or "ft-job", body.base_model_id, body.dataset_path,
             body.lora_rank, body.lora_alpha, body.learning_rate, body.max_steps, now),
        )
        await db.commit()
    return await get_job(jid)


@router.get("/finetune/jobs/{jid}")
async def get_job(jid: str) -> dict[str, Any]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM finetune_jobs WHERE id = ?", (jid,)) as cur:
            row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "Job not found")
    out = dict(row)
    for key in ("train_loss_json", "eval_loss_json"):
        raw = out.pop(key, None)
        target = key.replace("_json", "")
        try:
            out[target] = json.loads(raw) if raw else []
        except Exception:
            out[target] = []
    return out


@router.put("/finetune/jobs/{jid}")
async def update_job(jid: str, body: JobPatch) -> dict[str, Any]:
    fields = body.model_dump(exclude_none=True)
    if not fields:
        return await get_job(jid)
    cols = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [jid]
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(f"UPDATE finetune_jobs SET {cols} WHERE id = ?", values)
        await db.commit()
    return await get_job(jid)


@router.post("/finetune/jobs/{jid}/status")
async def set_status(jid: str, body: StatusUpdate) -> dict[str, Any]:
    now = _now()
    fields = ["status = ?", "error = ?"]
    values: list[Any] = [body.status, body.error]
    if body.status == "running":
        fields.append("started_at = ?"); values.append(now)
    if body.status in ("done", "error", "cancelled"):
        fields.append("finished_at = ?"); values.append(now)
    values.append(jid)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            f"UPDATE finetune_jobs SET {', '.join(fields)} WHERE id = ?", values,
        )
        await db.commit()
    return await get_job(jid)


@router.post("/finetune/jobs/{jid}/loss")
async def append_loss(jid: str, body: LossPoint) -> dict[str, Any]:
    """Append a loss-curve point. The caller (a separate training script)
    POSTs here while training. Keeps train + eval loss as parallel arrays
    keyed by step, serialized as compact JSON."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT train_loss_json, eval_loss_json FROM finetune_jobs WHERE id = ?", (jid,),
        ) as cur:
            row = await cur.fetchone()
            if not row:
                raise HTTPException(404, "Job not found")
            try:
                train = json.loads(row["train_loss_json"] or "[]")
            except Exception:
                train = []
            try:
                evals = json.loads(row["eval_loss_json"] or "[]")
            except Exception:
                evals = []
        train.append([body.step, body.loss])
        if body.eval_loss is not None:
            evals.append([body.step, body.eval_loss])
        await db.execute(
            "UPDATE finetune_jobs SET train_loss_json = ?, eval_loss_json = ? WHERE id = ?",
            (json.dumps(train), json.dumps(evals), jid),
        )
        await db.commit()
    return {"status": "ok", "train_points": len(train), "eval_points": len(evals)}


@router.delete("/finetune/jobs/{jid}")
async def delete_job(jid: str) -> dict[str, Any]:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM finetune_jobs WHERE id = ?", (jid,))
        await db.commit()
    return {"status": "deleted"}


@router.post("/finetune/datasets/from-chats")
async def dataset_from_chats(body: DatasetFromChats) -> dict[str, Any]:
    """Write a JSONL dataset to ~/.config/crucible/finetune/datasets/<name>.jsonl
    from the selected chat sessions' user+assistant pairs. Intended to feed
    mlx_lm.lora which expects {prompt, completion}-shaped lines."""
    DATASETS_DIR.mkdir(parents=True, exist_ok=True)
    safe = "".join(c for c in body.name if c.isalnum() or c in "-_") or "dataset"
    out_path = DATASETS_DIR / f"{safe}.jsonl"
    pairs_written = 0
    with out_path.open("w") as f:
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            for sid in body.session_ids:
                async with db.execute(
                    "SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY id",
                    (sid,),
                ) as cur:
                    msgs = [dict(r) async for r in cur]
                # Walk user→assistant turn pairs.
                i = 0
                while i < len(msgs) - 1:
                    if msgs[i]["role"] == "user" and msgs[i + 1]["role"] == "assistant":
                        f.write(json.dumps({
                            "prompt": msgs[i]["content"],
                            "completion": msgs[i + 1]["content"],
                        }) + "\n")
                        pairs_written += 1
                        i += 2
                    else:
                        i += 1
    return {"path": str(out_path), "pairs": pairs_written}
