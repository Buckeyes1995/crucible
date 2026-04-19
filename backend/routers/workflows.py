"""Agentic workflow recorder — save a hermes chat as a reusable macro.

A 'workflow' is a template prompt with {placeholders} + an agent name +
a set of skills. Replay it later by supplying concrete values for the
placeholders. Persists to disk so workflows survive restarts.
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter()
STORE = Path.home() / ".config" / "crucible" / "workflows.json"
_PLACEHOLDER = re.compile(r"\{([A-Za-z_][A-Za-z_0-9]*)\}")


def _load() -> list[dict]:
    if STORE.exists():
        try:
            return json.loads(STORE.read_text())
        except Exception:
            return []
    return []


def _save(items: list[dict]) -> None:
    STORE.parent.mkdir(parents=True, exist_ok=True)
    STORE.write_text(json.dumps(items, indent=2))


def _extract_placeholders(template: str) -> list[str]:
    return sorted(set(_PLACEHOLDER.findall(template)))


class WorkflowCreate(BaseModel):
    name: str
    agent: str           # registered agent name, e.g. "hermes"
    template: str        # prompt template with {placeholders}
    description: str = ""
    skills: list[str] = []
    max_turns: int = 30


@router.post("/workflows")
async def create(body: WorkflowCreate) -> dict:
    items = _load()
    wf = {
        "id": uuid.uuid4().hex[:12],
        "name": body.name,
        "agent": body.agent,
        "template": body.template,
        "description": body.description,
        "skills": body.skills,
        "max_turns": body.max_turns,
        "placeholders": _extract_placeholders(body.template),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "run_count": 0,
    }
    items.append(wf)
    _save(items)
    return wf


@router.get("/workflows")
async def list_workflows() -> list[dict]:
    return _load()


@router.get("/workflows/{wf_id}")
async def get(wf_id: str) -> dict:
    items = _load()
    for wf in items:
        if wf["id"] == wf_id:
            return wf
    raise HTTPException(404, f"workflow not found: {wf_id}")


class WorkflowUpdate(BaseModel):
    name: Optional[str] = None
    template: Optional[str] = None
    description: Optional[str] = None
    skills: Optional[list[str]] = None
    max_turns: Optional[int] = None


@router.put("/workflows/{wf_id}")
async def update(wf_id: str, body: WorkflowUpdate) -> dict:
    items = _load()
    for wf in items:
        if wf["id"] == wf_id:
            for k, v in body.model_dump(exclude_none=True).items():
                wf[k] = v
            if "template" in wf:
                wf["placeholders"] = _extract_placeholders(wf["template"])
            _save(items)
            return wf
    raise HTTPException(404, f"workflow not found: {wf_id}")


@router.delete("/workflows/{wf_id}")
async def delete(wf_id: str) -> dict:
    items = _load()
    new_items = [w for w in items if w["id"] != wf_id]
    if len(new_items) == len(items):
        raise HTTPException(404, f"workflow not found: {wf_id}")
    _save(new_items)
    return {"status": "deleted"}


class WorkflowRun(BaseModel):
    values: dict[str, str] = {}


@router.post("/workflows/{wf_id}/run")
async def run_workflow(wf_id: str, body: WorkflowRun, request: Request) -> StreamingResponse:
    """Substitute placeholders + stream the agent's chat response back. Uses
    the existing agents router's chat proxy under the hood so we reuse all
    the SSE/abort machinery."""
    items = _load()
    wf = next((w for w in items if w["id"] == wf_id), None)
    if not wf:
        raise HTTPException(404, f"workflow not found: {wf_id}")

    # Bump run_count
    wf["run_count"] = (wf.get("run_count") or 0) + 1
    wf["last_run_at"] = datetime.now(timezone.utc).isoformat()
    _save(items)

    # Substitute placeholders; leave unknowns untouched (the agent will see
    # literal {name}s, which is clearer than silent deletion).
    def _sub(m: re.Match) -> str:
        key = m.group(1)
        return body.values.get(key, m.group(0))
    rendered = _PLACEHOLDER.sub(_sub, wf["template"])

    # Look up the agent config to get URL + token
    cfg = request.app.state.config
    agent = next((a for a in cfg.agents if a.name == wf["agent"]), None)
    if not agent:
        raise HTTPException(404, f"agent '{wf['agent']}' not registered")
    url = agent.url.rstrip("/") + "/chat"
    headers = {"Authorization": f"Bearer {agent.api_key}"} if agent.api_key else {}
    headers["Content-Type"] = "application/json"

    payload = {
        "prompt": rendered,
        "max_turns": wf.get("max_turns", 30),
        "skills": wf.get("skills", []),
    }

    async def _stream():
        try:
            timeout = httpx.Timeout(connect=10.0, read=None, write=30.0, pool=30.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", url, headers=headers, json=payload) as resp:
                    if not resp.is_success:
                        err_bytes = await resp.aread()
                        err_text = err_bytes.decode("utf-8", errors="replace")[:300]
                        yield f"data: {json.dumps({'event': 'error', 'message': f'agent returned {resp.status_code}: {err_text}'})}\n\n"
                        return
                    async for chunk in resp.aiter_bytes():
                        yield chunk.decode("utf-8", errors="replace")
        except httpx.HTTPError as e:
            yield f"data: {json.dumps({'event': 'error', 'message': f'agent unreachable: {e}'})}\n\n"

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
