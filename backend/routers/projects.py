"""Project workspaces (Roadmap v4 #4) — named scopes for chat sessions,
snippets, and (later) RAG indexes. A project has a color, an optional
default model + system prompt, and is referenced by nullable project_id
FKs on scoped rows.

The frontend tracks the "active project" in localStorage; this router is
stateless — list endpoints filter by ?project=<id> and create endpoints
accept project_id in the body. A null / missing project_id means
"uncategorized" / the default bucket.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import aiosqlite
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db.database import DB_PATH

router = APIRouter()


class ProjectIn(BaseModel):
    name: str
    color: Optional[str] = None
    default_model_id: Optional[str] = None
    system_prompt: Optional[str] = None


class ProjectPatch(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    default_model_id: Optional[str] = None
    system_prompt: Optional[str] = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("/projects")
async def list_projects() -> list[dict[str, Any]]:
    """All projects with a count of chat sessions in each. Cheap enough
    to compute in a single JOIN since we're small-scale."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT p.*,
                   (SELECT COUNT(*) FROM chat_sessions s WHERE s.project_id = p.id) AS chat_count
            FROM projects p
            ORDER BY datetime(p.updated_at) DESC
            """
        ) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]


@router.get("/projects/{project_id}")
async def get_project(project_id: str) -> dict[str, Any]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM projects WHERE id = ?", (project_id,)) as cur:
            row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "Project not found")
    return dict(row)


@router.post("/projects", status_code=201)
async def create_project(body: ProjectIn) -> dict[str, Any]:
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Name is required")
    pid = uuid.uuid4().hex[:12]
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO projects (id, name, color, default_model_id, system_prompt, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (pid, name, body.color, body.default_model_id, body.system_prompt, now, now),
        )
        await db.commit()
    return {
        "id": pid, "name": name, "color": body.color,
        "default_model_id": body.default_model_id,
        "system_prompt": body.system_prompt,
        "created_at": now, "updated_at": now,
        "chat_count": 0,
    }


@router.put("/projects/{project_id}")
async def update_project(project_id: str, body: ProjectPatch) -> dict[str, Any]:
    fields = body.model_dump(exclude_none=True)
    if not fields:
        return await get_project(project_id)
    assignments = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values())
    values.extend([_now(), project_id])
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            f"UPDATE projects SET {assignments}, updated_at = ? WHERE id = ?",
            values,
        )
        await db.commit()
    return await get_project(project_id)


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str, detach: bool = True) -> dict[str, Any]:
    """Delete a project. By default (`detach=true`) scoped rows survive
    and become uncategorized — only the project row itself goes away.
    Pass detach=false to also delete the project's chat sessions."""
    async with aiosqlite.connect(DB_PATH) as db:
        if detach:
            await db.execute("UPDATE chat_sessions SET project_id = NULL WHERE project_id = ?", (project_id,))
        else:
            await db.execute("PRAGMA foreign_keys = ON")
            await db.execute("DELETE FROM chat_sessions WHERE project_id = ?", (project_id,))
        await db.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        await db.commit()
    # Snippets live in a flat JSON file — clean up project_id refs there.
    try:
        import snippets
        snippets.detach_project(project_id)
    except Exception:
        pass
    return {"status": "deleted", "id": project_id}
