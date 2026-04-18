"""Remote agent control — thin proxy over hermes-control-style sidecars.

Each registered agent exposes a simple HTTP API (see hermes-control's README).
This router stores the list of agents in Crucible's config and proxies calls
to them with the stored bearer token. Deliberately generic so additional agent
kinds (Frigate, Servarr, etc.) can plug in without code changes.
"""
import asyncio
import json
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config import AgentConfig, save_config

router = APIRouter()


def _find(request: Request, name: str) -> AgentConfig:
    cfg = request.app.state.config
    for a in cfg.agents:
        if a.name == name:
            return a
    raise HTTPException(status_code=404, detail=f"agent '{name}' not registered")


def _headers(agent: AgentConfig) -> dict[str, str]:
    return {"Authorization": f"Bearer {agent.api_key}"} if agent.api_key else {}


async def _proxy_json(agent: AgentConfig, path: str, method: str = "GET",
                      json_body: Any = None, params: dict | None = None) -> Any:
    """Forward a JSON request to the agent, raise 502 on network errors."""
    url = agent.url.rstrip("/") + path
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.request(method, url, headers=_headers(agent),
                                     json=json_body, params=params)
            # Pass through agent's error body as our detail when non-2xx
            if not r.is_success:
                try:
                    detail = r.json().get("detail", r.text[:300])
                except Exception:
                    detail = r.text[:300]
                raise HTTPException(status_code=r.status_code, detail=detail)
            return r.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"agent {agent.name} unreachable: {e}")


# ─── CRUD on the agent list ──────────────────────────────────────────────────

class AgentCreate(BaseModel):
    name: str
    url: str
    api_key: str = ""
    kind: str = "hermes"


@router.get("/agents")
async def list_agents(request: Request) -> list[dict[str, Any]]:
    """List registered agents with a live status summary per agent.

    Each call to /health is best-effort; unreachable agents are still listed
    (just with status=unreachable) rather than making the whole list fail.
    """
    cfg = request.app.state.config
    results = []

    async def _probe(a: AgentConfig) -> dict[str, Any]:
        row: dict[str, Any] = {"name": a.name, "url": a.url, "kind": a.kind}
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(a.url.rstrip("/") + "/health", headers=_headers(a))
                if r.is_success:
                    row["health"] = r.json()
                    row["reachable"] = True
                else:
                    row["reachable"] = False
                    row["error"] = f"health returned {r.status_code}"
        except Exception as e:
            row["reachable"] = False
            row["error"] = str(e)
        return row

    if cfg.agents:
        results = await asyncio.gather(*(_probe(a) for a in cfg.agents))
    return list(results)


@router.post("/agents")
async def register_agent(body: AgentCreate, request: Request) -> dict[str, Any]:
    cfg = request.app.state.config
    if any(a.name == body.name for a in cfg.agents):
        raise HTTPException(status_code=409, detail=f"agent '{body.name}' already registered")
    cfg.agents.append(AgentConfig(**body.model_dump()))
    save_config(cfg)
    return {"status": "added", "name": body.name}


@router.put("/agents/{name}")
async def update_agent(name: str, body: AgentCreate, request: Request) -> dict[str, Any]:
    cfg = request.app.state.config
    for i, a in enumerate(cfg.agents):
        if a.name == name:
            cfg.agents[i] = AgentConfig(**body.model_dump())
            save_config(cfg)
            return {"status": "updated", "name": body.name}
    raise HTTPException(status_code=404, detail=f"agent '{name}' not registered")


@router.delete("/agents/{name}")
async def delete_agent(name: str, request: Request) -> dict[str, Any]:
    cfg = request.app.state.config
    before = len(cfg.agents)
    cfg.agents = [a for a in cfg.agents if a.name != name]
    if len(cfg.agents) == before:
        raise HTTPException(status_code=404, detail=f"agent '{name}' not registered")
    save_config(cfg)
    return {"status": "removed", "name": name}


# ─── Proxy endpoints ─────────────────────────────────────────────────────────

@router.get("/agents/{name}/status")
async def agent_status(name: str, request: Request) -> Any:
    return await _proxy_json(_find(request, name), "/status")


@router.get("/agents/{name}/sessions")
async def agent_sessions(name: str, request: Request,
                          limit: int = 50, offset: int = 0) -> Any:
    return await _proxy_json(_find(request, name), "/sessions",
                             params={"limit": limit, "offset": offset})


@router.get("/agents/{name}/sessions/{session_id}")
async def agent_session(name: str, session_id: str, request: Request) -> Any:
    return await _proxy_json(_find(request, name), f"/sessions/{session_id}")


@router.get("/agents/{name}/cron")
async def agent_cron(name: str, request: Request) -> Any:
    return await _proxy_json(_find(request, name), "/cron")


@router.get("/agents/{name}/logs")
async def agent_logs(name: str, request: Request,
                     tail: int = 500, since: str | None = None) -> Any:
    params: dict[str, Any] = {"tail": tail}
    if since:
        params["since"] = since
    return await _proxy_json(_find(request, name), "/logs", params=params)


@router.post("/agents/{name}/pause")
async def agent_pause(name: str, request: Request) -> Any:
    return await _proxy_json(_find(request, name), "/pause", method="POST")


@router.post("/agents/{name}/resume")
async def agent_resume(name: str, request: Request) -> Any:
    return await _proxy_json(_find(request, name), "/resume", method="POST")


@router.post("/agents/{name}/restart")
async def agent_restart(name: str, request: Request) -> Any:
    return await _proxy_json(_find(request, name), "/restart", method="POST")


@router.get("/agents/{name}/orphans")
async def agent_orphans(name: str, request: Request) -> Any:
    return await _proxy_json(_find(request, name), "/orphans")


@router.post("/agents/{name}/orphans/prune")
async def agent_orphans_prune(name: str, request: Request) -> Any:
    return await _proxy_json(_find(request, name), "/orphans/prune", method="POST")


class ChatBody(BaseModel):
    prompt: str
    session_id: str | None = None
    max_turns: int = 30
    skills: list[str] = []


@router.post("/agents/{name}/chat")
async def agent_chat(name: str, body: ChatBody, request: Request) -> StreamingResponse:
    """Stream a conversational turn with the agent — SSE passthrough.

    Lets the Crucible UI chat with hermes as if it were another chat platform,
    including preserving session_id across turns for multi-turn conversations.
    """
    agent = _find(request, name)
    url = agent.url.rstrip("/") + "/chat"
    headers = _headers(agent)
    headers["Content-Type"] = "application/json"

    async def _stream():
        try:
            # Timeout must be long — a chat turn can run tool calls for minutes
            async with httpx.AsyncClient(timeout=600.0) as client:
                async with client.stream("POST", url, headers=headers,
                                         json=body.model_dump()) as resp:
                    if not resp.is_success:
                        err_bytes = await resp.aread()
                        err_text = err_bytes.decode("utf-8", errors="replace")[:300]
                        msg = f"agent returned {resp.status_code}: {err_text}"
                        yield f"data: {json.dumps({'event': 'error', 'message': msg})}\n\n"
                        return
                    async for chunk in resp.aiter_bytes():
                        yield chunk.decode("utf-8", errors="replace")
        except httpx.HTTPError as e:
            yield f"data: {json.dumps({'event': 'error', 'message': f'agent unreachable: {e}'})}\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
