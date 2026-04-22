"""Chat history — persist and search conversations."""

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

import aiosqlite
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db.database import DB_PATH

router = APIRouter()


class CreateSession(BaseModel):
    title: Optional[str] = None
    model_id: Optional[str] = None
    project_id: Optional[str] = None


class AddMessage(BaseModel):
    role: str
    content: str


@router.post("/chat/sessions")
async def create_session(body: CreateSession) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    session_id = str(uuid.uuid4())
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO chat_sessions (id, title, model_id, project_id, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (session_id, body.title or "New Chat", body.model_id, body.project_id, now, now),
        )
        await db.commit()
    return {
        "id": session_id, "title": body.title or "New Chat",
        "project_id": body.project_id, "created_at": now,
    }


@router.get("/chat/sessions")
async def list_sessions(q: Optional[str] = None, limit: int = 50,
                         tag: Optional[str] = None,
                         project: Optional[str] = None) -> list[dict]:
    # Pinned sessions float to the top regardless of updated_at so favorites
    # stay visible. Tag filter matches exact tag membership (case-insensitive).
    # `project` = "__none__" → only sessions with NULL project_id (the
    # uncategorized bucket). `project` = "<id>" → only that project.
    # Omitted / empty → all sessions.
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        project_clause = ""
        project_args: tuple = ()
        if project == "__none__":
            project_clause = " AND s.project_id IS NULL "
        elif project:
            project_clause = " AND s.project_id = ? "
            project_args = (project,)
        if q:
            base = (
                "SELECT DISTINCT s.* FROM chat_sessions s "
                "JOIN chat_messages m ON m.session_id = s.id "
                "WHERE (m.content LIKE ? OR s.title LIKE ?)"
                + project_clause +
                "ORDER BY COALESCE(s.pinned, 0) DESC, s.updated_at DESC LIMIT ?"
            )
            args = (f"%{q}%", f"%{q}%", *project_args, limit)
            rows = []
            async with db.execute(base, args) as cur:
                async for row in cur:
                    rows.append(dict(row))
        else:
            # Keep the aliased "s." column reference so the project_clause
            # prefix works without a second codepath.
            base = (
                "SELECT s.* FROM chat_sessions s "
                "WHERE 1=1"
                + project_clause +
                "ORDER BY COALESCE(s.pinned, 0) DESC, s.updated_at DESC LIMIT ?"
            )
            args = (*project_args, limit)
            async with db.execute(base, args) as cur:
                rows = [dict(row) async for row in cur]
    def _decorate(r: dict) -> dict:
        try:
            r["tags"] = json.loads(r.get("tags_json") or "[]")
        except Exception:
            r["tags"] = []
        r["pinned"] = bool(r.get("pinned") or 0)
        return r

    decorated = [_decorate(r) for r in rows]
    if tag:
        needle = tag.lower()
        return [r for r in decorated if any(t.lower() == needle for t in r["tags"])]
    return decorated


class TagUpdate(BaseModel):
    tags: list[str]


@router.put("/chat/sessions/{session_id}/tags")
async def set_session_tags(session_id: str, body: TagUpdate) -> dict:
    tags = [t.strip() for t in body.tags if t.strip()]
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE chat_sessions SET tags_json = ? WHERE id = ?",
            (json.dumps(tags), session_id),
        )
        await db.commit()
    return {"id": session_id, "tags": tags}


class PinUpdate(BaseModel):
    pinned: bool


class ProjectUpdate(BaseModel):
    project_id: str | None = None


@router.put("/chat/sessions/{session_id}/project")
async def set_session_project(session_id: str, body: ProjectUpdate) -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE chat_sessions SET project_id = ? WHERE id = ?",
            (body.project_id, session_id),
        )
        await db.commit()
    return {"id": session_id, "project_id": body.project_id}


@router.put("/chat/sessions/{session_id}/pinned")
async def set_session_pinned(session_id: str, body: PinUpdate) -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE chat_sessions SET pinned = ? WHERE id = ?",
            (1 if body.pinned else 0, session_id),
        )
        await db.commit()
    return {"id": session_id, "pinned": body.pinned}


@router.get("/chat/session-tags")
async def all_session_tags() -> list[str]:
    """Unique tag list across all sessions — for tag filter dropdowns."""
    tags: set[str] = set()
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT tags_json FROM chat_sessions WHERE tags_json IS NOT NULL") as cur:
            async for row in cur:
                try:
                    for t in json.loads(row[0] or "[]"):
                        if t:
                            tags.add(t)
                except Exception:
                    pass
    return sorted(tags)


@router.get("/chat/search")
async def search_chat(q: str, limit: int = 50) -> list[dict]:
    """Full-text search over chat_messages joined with sessions. Matches on
    raw LIKE for simplicity; upgrade to FTS5 later if perf becomes an issue."""
    needle = f"%{q.lower()}%"
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT m.session_id, m.role, m.content, m.created_at,
                   s.title, s.model_id, s.updated_at as session_updated
            FROM chat_messages m
            JOIN chat_sessions s ON s.id = m.session_id
            WHERE LOWER(m.content) LIKE ?
            ORDER BY m.id DESC LIMIT ?
            """,
            (needle, max(1, min(limit, 500))),
        ) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]


@router.get("/chat/sessions/{session_id}")
async def get_session(session_id: str) -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM chat_sessions WHERE id = ?", (session_id,)) as cur:
            session = await cur.fetchone()
        if not session:
            raise HTTPException(404, "Session not found")
        async with db.execute(
            "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id", (session_id,)
        ) as cur:
            messages = [dict(row) async for row in cur]
    return {**dict(session), "messages": messages}


@router.post("/chat/sessions/{session_id}/messages")
async def add_message(session_id: str, body: AddMessage) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        # Verify session exists
        async with db.execute("SELECT id FROM chat_sessions WHERE id = ?", (session_id,)) as cur:
            if not await cur.fetchone():
                raise HTTPException(404, "Session not found")
        await db.execute(
            "INSERT INTO chat_messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            (session_id, body.role, body.content, now),
        )
        # Auto-title from first user message if still "New Chat"
        if body.role == "user":
            async with db.execute("SELECT title FROM chat_sessions WHERE id = ?", (session_id,)) as cur:
                row = await cur.fetchone()
                if row and row[0] == "New Chat":
                    title = body.content[:80].strip()
                    await db.execute("UPDATE chat_sessions SET title = ? WHERE id = ?", (title, session_id))
        await db.execute("UPDATE chat_sessions SET updated_at = ? WHERE id = ?", (now, session_id))
        await db.commit()
    return {"status": "ok"}


@router.delete("/chat/sessions/{session_id}")
async def delete_session(session_id: str) -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        await db.execute("DELETE FROM chat_sessions WHERE id = ?", (session_id,))
        await db.commit()
    return {"status": "deleted"}


@router.get("/chat/sessions/{session_id}/export")
async def export_session(session_id: str) -> dict:
    """Export a session as markdown."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM chat_sessions WHERE id = ?", (session_id,)) as cur:
            session = await cur.fetchone()
        if not session:
            raise HTTPException(404, "Session not found")
        async with db.execute(
            "SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY id", (session_id,)
        ) as cur:
            messages = [dict(row) async for row in cur]

    lines = [f"# {session['title']}", f"*Model: {session['model_id'] or 'unknown'} — {session['created_at']}*", ""]
    for m in messages:
        prefix = "**User:**" if m["role"] == "user" else "**Assistant:**"
        lines.append(f"{prefix}\n{m['content']}\n")

    return {"markdown": "\n".join(lines)}
