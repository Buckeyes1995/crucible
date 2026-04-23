"""Prompt IDE (Roadmap v4 #10) — versioned prompts + A/B runs + test sets.

Routes (/api prefix applied in main.py):

  GET    /prompts/docs                              list docs (optional ?project=)
  POST   /prompts/docs                              create doc
  GET    /prompts/docs/{id}                         doc detail + versions
  PUT    /prompts/docs/{id}                         rename / description
  DELETE /prompts/docs/{id}                         delete (cascades)

  POST   /prompts/docs/{id}/versions                new version (content, note)
  GET    /prompts/docs/{id}/versions                list versions

  POST   /prompts/docs/{id}/test-sets               create test set
  GET    /prompts/docs/{id}/test-sets               list
  DELETE /prompts/test-sets/{id}

  POST   /prompts/docs/{id}/ab                      run A/B comparison (SSE)
  GET    /prompts/docs/{id}/ab                      list past A/B runs
  GET    /prompts/ab/{id}                           A/B run detail

All LLM calls go through the local OpenAI-compat proxy so the currently-
loaded model handles the run.
"""
from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import aiosqlite
import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from db.database import DB_PATH

router = APIRouter()

PROXY_URL = "http://127.0.0.1:7777/v1/chat/completions"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Docs ────────────────────────────────────────────────────────────────────

class DocIn(BaseModel):
    name: str
    description: Optional[str] = None
    project_id: Optional[str] = None
    initial_content: Optional[str] = None


class DocPatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    project_id: Optional[str] = None


@router.get("/prompts/docs")
async def list_docs(project: Optional[str] = None) -> list[dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        project_clause = ""
        args: tuple = ()
        if project == "__none__":
            project_clause = " WHERE project_id IS NULL "
        elif project:
            project_clause = " WHERE project_id = ? "
            args = (project,)
        async with db.execute(
            "SELECT p.*, "
            "(SELECT COUNT(*) FROM prompt_versions v WHERE v.doc_id = p.id) AS version_count, "
            "(SELECT id FROM prompt_versions v WHERE v.doc_id = p.id ORDER BY datetime(created_at) DESC LIMIT 1) AS head_version_id "
            f"FROM prompt_docs p{project_clause} ORDER BY datetime(p.updated_at) DESC",
            args,
        ) as cur:
            return [dict(r) async for r in cur]


@router.post("/prompts/docs", status_code=201)
async def create_doc(body: DocIn) -> dict[str, Any]:
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Name is required")
    doc_id = uuid.uuid4().hex[:12]
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO prompt_docs (id, name, project_id, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (doc_id, name, body.project_id, body.description, now, now),
        )
        if body.initial_content:
            version_id = uuid.uuid4().hex[:12]
            await db.execute(
                "INSERT INTO prompt_versions (id, doc_id, parent_version_id, content, note, created_at) "
                "VALUES (?, ?, NULL, ?, 'initial', ?)",
                (version_id, doc_id, body.initial_content, now),
            )
        await db.commit()
    return await get_doc(doc_id)


@router.get("/prompts/docs/{doc_id}")
async def get_doc(doc_id: str) -> dict[str, Any]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM prompt_docs WHERE id = ?", (doc_id,)) as cur:
            doc = await cur.fetchone()
        if not doc:
            raise HTTPException(404, "Doc not found")
        async with db.execute(
            "SELECT * FROM prompt_versions WHERE doc_id = ? ORDER BY datetime(created_at) DESC",
            (doc_id,),
        ) as cur:
            versions = [dict(r) async for r in cur]
    return {**dict(doc), "versions": versions}


@router.put("/prompts/docs/{doc_id}")
async def update_doc(doc_id: str, body: DocPatch) -> dict[str, Any]:
    fields = body.model_dump(exclude_none=True)
    if not fields:
        return await get_doc(doc_id)
    assignments = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [_now(), doc_id]
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            f"UPDATE prompt_docs SET {assignments}, updated_at = ? WHERE id = ?",
            values,
        )
        await db.commit()
    return await get_doc(doc_id)


@router.delete("/prompts/docs/{doc_id}")
async def delete_doc(doc_id: str) -> dict[str, Any]:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        await db.execute("DELETE FROM prompt_docs WHERE id = ?", (doc_id,))
        await db.commit()
    return {"status": "deleted"}


# ── Versions ────────────────────────────────────────────────────────────────

class VersionIn(BaseModel):
    content: str
    note: Optional[str] = None
    parent_version_id: Optional[str] = None


@router.post("/prompts/docs/{doc_id}/versions", status_code=201)
async def create_version(doc_id: str, body: VersionIn) -> dict[str, Any]:
    if not body.content.strip():
        raise HTTPException(400, "Content is required")
    vid = uuid.uuid4().hex[:12]
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT 1 FROM prompt_docs WHERE id = ?", (doc_id,)) as cur:
            if not await cur.fetchone():
                raise HTTPException(404, "Doc not found")
        await db.execute(
            "INSERT INTO prompt_versions (id, doc_id, parent_version_id, content, note, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (vid, doc_id, body.parent_version_id, body.content, body.note, now),
        )
        await db.execute(
            "UPDATE prompt_docs SET updated_at = ? WHERE id = ?", (now, doc_id),
        )
        await db.commit()
        async with db.execute("SELECT * FROM prompt_versions WHERE id = ?", (vid,)) as cur:
            return dict(await cur.fetchone())


# ── Test sets ───────────────────────────────────────────────────────────────

class TestSetIn(BaseModel):
    name: str
    inputs: list[dict[str, Any]]   # [{input: str, expected?: str}, ...]


@router.get("/prompts/docs/{doc_id}/test-sets")
async def list_test_sets(doc_id: str) -> list[dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM prompt_test_sets WHERE doc_id = ? ORDER BY datetime(created_at) DESC",
            (doc_id,),
        ) as cur:
            rows = [dict(r) async for r in cur]
    for r in rows:
        try:
            r["inputs"] = json.loads(r.pop("inputs_json") or "[]")
        except Exception:
            r["inputs"] = []
    return rows


@router.post("/prompts/docs/{doc_id}/test-sets", status_code=201)
async def create_test_set(doc_id: str, body: TestSetIn) -> dict[str, Any]:
    tid = uuid.uuid4().hex[:12]
    now = _now()
    inputs = [
        {"input": str(x.get("input") or ""), "expected": x.get("expected")}
        for x in body.inputs if (x.get("input") or "").strip()
    ]
    if not inputs:
        raise HTTPException(400, "inputs must have at least one non-empty entry")
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO prompt_test_sets (id, doc_id, name, inputs_json, created_at) VALUES (?, ?, ?, ?, ?)",
            (tid, doc_id, body.name.strip() or "Untitled", json.dumps(inputs), now),
        )
        await db.commit()
    return {"id": tid, "doc_id": doc_id, "name": body.name, "inputs": inputs, "created_at": now}


@router.delete("/prompts/test-sets/{ts_id}")
async def delete_test_set(ts_id: str) -> dict[str, Any]:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM prompt_test_sets WHERE id = ?", (ts_id,))
        await db.commit()
    return {"status": "deleted"}


# ── A/B runs ───────────────────────────────────────────────────────────────
# For each input, render both prompt versions (templated with {{input}}),
# call the model, record outputs + timing. Stream per-item events.

class ABRunIn(BaseModel):
    version_a_id: str
    version_b_id: str
    test_set_id: Optional[str] = None
    inputs: Optional[list[str]] = None   # ad-hoc if no test_set_id


def _render(template: str, value: str) -> str:
    return template.replace("{{input}}", value)


async def _load_version(doc_id: str, version_id: str) -> str:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT content FROM prompt_versions WHERE id = ? AND doc_id = ?",
            (version_id, doc_id),
        ) as cur:
            row = await cur.fetchone()
            if not row:
                raise HTTPException(400, f"Version not found: {version_id}")
            return row["content"]


@router.post("/prompts/docs/{doc_id}/ab")
async def run_ab(doc_id: str, body: ABRunIn, request: Request) -> StreamingResponse:
    adapter = request.app.state.active_adapter
    model_id = adapter.model_id if adapter and adapter.is_loaded() else None

    # Fetch both versions + inputs up-front so the SSE stream is clean.
    version_a_content = await _load_version(doc_id, body.version_a_id)
    version_b_content = await _load_version(doc_id, body.version_b_id)

    inputs: list[str] = []
    if body.test_set_id:
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT inputs_json FROM prompt_test_sets WHERE id = ? AND doc_id = ?",
                (body.test_set_id, doc_id),
            ) as cur:
                row = await cur.fetchone()
                if not row:
                    raise HTTPException(400, "Test set not found")
                parsed = json.loads(row["inputs_json"] or "[]")
                inputs = [x.get("input", "") for x in parsed if x.get("input")]
    elif body.inputs:
        inputs = [s for s in body.inputs if s and s.strip()]
    if not inputs:
        raise HTTPException(400, "No inputs — provide test_set_id or inputs[]")

    async def _call(prompt: str, user_input: str) -> dict:
        payload = {
            "model": (model_id or "auto").replace("mlx:", ""),
            "messages": [
                {"role": "system", "content": prompt},
                {"role": "user", "content": user_input},
            ],
            "max_tokens": 320,
            "temperature": 0.0,
            "stream": False,
            "chat_template_kwargs": {"enable_thinking": False},
        }
        t0 = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=240.0) as client:
                r = await client.post(PROXY_URL, json=payload)
                r.raise_for_status()
                data = r.json()
        except Exception as e:
            return {"output": f"(error: {e})", "tokens": 0, "elapsed_ms": (time.monotonic() - t0) * 1000, "error": str(e)}
        content = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
        tokens = int((data.get("usage") or {}).get("completion_tokens") or 0)
        return {"output": content, "tokens": tokens, "elapsed_ms": (time.monotonic() - t0) * 1000}

    async def _stream():
        yield f"data: {json.dumps({'event': 'started', 'total': len(inputs)})}\n\n".encode()
        results = []
        a_tokens_total = 0
        b_tokens_total = 0
        a_ms_total = 0.0
        b_ms_total = 0.0
        for i, inp in enumerate(inputs):
            a_rendered = _render(version_a_content, inp)
            b_rendered = _render(version_b_content, inp)
            a = await _call(a_rendered, inp)
            b = await _call(b_rendered, inp)
            a_tokens_total += a.get("tokens", 0)
            b_tokens_total += b.get("tokens", 0)
            a_ms_total += a.get("elapsed_ms", 0)
            b_ms_total += b.get("elapsed_ms", 0)
            item = {
                "i": i + 1, "input": inp,
                "a_output": a["output"], "a_tokens": a["tokens"], "a_elapsed_ms": a["elapsed_ms"],
                "b_output": b["output"], "b_tokens": b["tokens"], "b_elapsed_ms": b["elapsed_ms"],
            }
            results.append(item)
            yield f"data: {json.dumps({'event': 'item', **item})}\n\n".encode()
        n = max(1, len(results))
        summary = {
            "n": len(results),
            "a_avg_tokens": a_tokens_total / n,
            "b_avg_tokens": b_tokens_total / n,
            "a_avg_ms": a_ms_total / n,
            "b_avg_ms": b_ms_total / n,
        }
        run_id = uuid.uuid4().hex[:12]
        now = _now()
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "INSERT INTO prompt_ab_runs (id, doc_id, version_a_id, version_b_id, test_set_id, model_id, results_json, summary_json, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (run_id, doc_id, body.version_a_id, body.version_b_id, body.test_set_id, model_id,
                 json.dumps(results), json.dumps(summary), now),
            )
            await db.commit()
        yield f"data: {json.dumps({'event': 'finished', 'run_id': run_id, 'summary': summary})}\n\n".encode()

    return StreamingResponse(_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/prompts/docs/{doc_id}/ab")
async def list_ab_runs(doc_id: str, limit: int = 20) -> list[dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, doc_id, version_a_id, version_b_id, test_set_id, model_id, summary_json, created_at "
            "FROM prompt_ab_runs WHERE doc_id = ? ORDER BY datetime(created_at) DESC LIMIT ?",
            (doc_id, limit),
        ) as cur:
            rows = [dict(r) async for r in cur]
    for r in rows:
        try: r["summary"] = json.loads(r.pop("summary_json") or "{}")
        except Exception: r["summary"] = {}
    return rows


@router.get("/prompts/ab/{run_id}")
async def get_ab_run(run_id: str) -> dict[str, Any]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM prompt_ab_runs WHERE id = ?", (run_id,)) as cur:
            row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "Run not found")
    out = dict(row)
    for key in ("results_json", "summary_json"):
        try:
            out[key.replace("_json", "")] = json.loads(out.pop(key) or "null")
        except Exception:
            out[key.replace("_json", "")] = None
    return out
