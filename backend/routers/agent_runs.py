"""Agent runs router (Roadmap v4 #1) — SSE-driven ReAct loop.

Paired with backend/agent_runner.py. List + detail + delete are plain
JSON; the start endpoint streams events so the frontend can draw a
live trace."""
from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import agent_runner

router = APIRouter()


class StartRunRequest(BaseModel):
    goal: str
    tool_allowlist: Optional[list[str]] = None  # mcp ids; null = all installed
    max_steps: int = 12
    max_tokens: int = 2048
    project_id: Optional[str] = None


@router.post("/agents/runs")
async def start_run(body: StartRunRequest, request: Request) -> StreamingResponse:
    """Start an agent run and stream events. The active adapter's model id is
    used as the decision-making LLM — whatever is loaded right now."""
    adapter = request.app.state.active_adapter
    model_id = adapter.model_id if adapter and adapter.is_loaded() else None

    async def _stream():
        try:
            async for evt in agent_runner.run(
                goal=body.goal,
                model_id=model_id,
                tool_allowlist=body.tool_allowlist,
                max_steps=max(1, min(body.max_steps, 40)),
                max_tokens=max(128, min(body.max_tokens, 16384)),
                project_id=body.project_id,
            ):
                yield f"data: {json.dumps(evt, default=str)}\n\n".encode()
        except Exception as e:
            yield f"data: {json.dumps({'event': 'run_finished', 'status': 'error', 'error': str(e)})}\n\n".encode()

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/agents/runs")
async def list_runs(limit: int = 50, project: Optional[str] = None) -> list[dict[str, Any]]:
    return await agent_runner.list_runs(limit=limit, project_id=project)


@router.get("/agents/runs/{run_id}")
async def get_run(run_id: str) -> dict[str, Any]:
    run = await agent_runner.get_run(run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return run


@router.delete("/agents/runs/{run_id}")
async def delete_run(run_id: str) -> dict[str, Any]:
    ok = await agent_runner.delete_run(run_id)
    if not ok:
        raise HTTPException(404, "Run not found")
    return {"status": "deleted"}
