"""Training data curator — pull high-signal conversations from chat history
and export as JSONL (ShareGPT-style) for the Finetune pipeline.

High-signal heuristics (no ML needed):
  * total message count >= min_turns (longer conversations engaged better)
  * average assistant message length within reasonable bounds
  * contains at least one code block (for coding-focused tuning) — optional
  * recency cap — prefer newer sessions so tone matches current usage
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from db.database import DB_PATH

router = APIRouter()

EXPORT_ROOT = Path.home() / ".config" / "crucible" / "curator_exports"


class CurateRequest(BaseModel):
    min_turns: int = 4            # at least this many total messages
    max_age_days: int = 90
    min_avg_assistant_chars: int = 80
    max_avg_assistant_chars: int = 8000
    require_code: bool = False    # only keep sessions with at least one ``` block
    limit: int = 200


@router.post("/curator/preview")
async def preview(body: CurateRequest) -> dict:
    """Preview which sessions pass the filters, without exporting. Returns
    summaries only — no full message bodies — so the UI stays responsive."""
    sessions = await _filter_sessions(body)
    return {
        "total_matching": len(sessions),
        "sessions": [
            {
                "id": s["id"],
                "title": s["title"],
                "model_id": s["model_id"],
                "updated_at": s["updated_at"],
                "message_count": s["message_count"],
                "avg_assistant_chars": s["avg_assistant_chars"],
                "has_code": s["has_code"],
            }
            for s in sessions[: body.limit]
        ],
    }


@router.post("/curator/export")
async def export(body: CurateRequest) -> dict:
    """Materialize filtered sessions as a JSONL file on disk. Returns path +
    count so the frontend can offer a download link."""
    sessions = await _filter_sessions(body)
    if not sessions:
        raise HTTPException(400, "no sessions pass the filters")

    EXPORT_ROOT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = EXPORT_ROOT / f"curated-{stamp}.jsonl"

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        with out.open("w") as f:
            for s in sessions:
                async with db.execute(
                    "SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY id",
                    (s["id"],),
                ) as cur:
                    msgs = [dict(row) async for row in cur]
                # ShareGPT format: {"conversations": [{"from": "human"|"gpt", "value": "..."}]}
                conv = []
                for m in msgs:
                    if m["role"] not in ("user", "assistant"):
                        continue
                    conv.append({
                        "from": "human" if m["role"] == "user" else "gpt",
                        "value": m["content"],
                    })
                if len(conv) < body.min_turns:
                    continue
                f.write(json.dumps({"conversations": conv, "source_session": s["id"]}) + "\n")

    return {
        "path": str(out),
        "count": len(sessions),
        "bytes": out.stat().st_size,
    }


@router.get("/curator/download/{filename}")
async def download(filename: str) -> StreamingResponse:
    if "/" in filename or ".." in filename or not filename.endswith(".jsonl"):
        raise HTTPException(400, "invalid filename")
    path = EXPORT_ROOT / filename
    if not path.exists():
        raise HTTPException(404, "export not found")

    def _stream():
        with path.open("rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    break
                yield chunk

    return StreamingResponse(
        _stream(),
        media_type="application/jsonl",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/curator/exports")
async def list_exports() -> list[dict]:
    if not EXPORT_ROOT.exists():
        return []
    out = []
    for p in sorted(EXPORT_ROOT.glob("*.jsonl"), reverse=True):
        out.append({
            "filename": p.name,
            "bytes": p.stat().st_size,
            "created_at": p.stat().st_mtime,
        })
    return out


async def _filter_sessions(req: CurateRequest) -> list[dict]:
    """Scan chat_sessions, return enriched metadata for those passing filters."""
    cutoff = datetime.now(timezone.utc).timestamp() - req.max_age_days * 86400
    passed = []
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM chat_sessions ORDER BY updated_at DESC") as cur:
            rows = [dict(r) async for r in cur]
    for r in rows:
        # Filter by age
        try:
            ts = datetime.fromisoformat(r["updated_at"]).timestamp()
        except Exception:
            continue
        if ts < cutoff:
            continue
        # Pull messages to compute stats
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY id",
                (r["id"],),
            ) as cur:
                msgs = [dict(m) async for m in cur]
        if len(msgs) < req.min_turns:
            continue
        assistants = [m["content"] for m in msgs if m["role"] == "assistant"]
        if not assistants:
            continue
        avg_chars = sum(len(a) for a in assistants) / len(assistants)
        if avg_chars < req.min_avg_assistant_chars or avg_chars > req.max_avg_assistant_chars:
            continue
        has_code = any("```" in (m["content"] or "") for m in msgs)
        if req.require_code and not has_code:
            continue
        passed.append({
            **r,
            "message_count": len(msgs),
            "avg_assistant_chars": round(avg_chars, 1),
            "has_code": has_code,
        })
    return passed
