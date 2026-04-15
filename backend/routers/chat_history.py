"""Chat history — persist and search conversations."""

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


class AddMessage(BaseModel):
    role: str
    content: str


@router.post("/chat/sessions")
async def create_session(body: CreateSession) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    session_id = str(uuid.uuid4())
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO chat_sessions (id, title, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (session_id, body.title or "New Chat", body.model_id, now, now),
        )
        await db.commit()
    return {"id": session_id, "title": body.title or "New Chat", "created_at": now}


@router.get("/chat/sessions")
async def list_sessions(q: Optional[str] = None, limit: int = 50) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        if q:
            rows = []
            async with db.execute(
                """SELECT DISTINCT s.* FROM chat_sessions s
                   JOIN chat_messages m ON m.session_id = s.id
                   WHERE m.content LIKE ? OR s.title LIKE ?
                   ORDER BY s.updated_at DESC LIMIT ?""",
                (f"%{q}%", f"%{q}%", limit),
            ) as cur:
                async for row in cur:
                    rows.append(dict(row))
            return rows
        else:
            async with db.execute(
                "SELECT * FROM chat_sessions ORDER BY updated_at DESC LIMIT ?", (limit,)
            ) as cur:
                return [dict(row) async for row in cur]


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
