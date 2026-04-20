"""Param sweep — grid-search sampling params (temperature, top_p) against a
user-chosen eval suite, return the grid with per-cell pass rate. Keeps the
sweep sequential so oMLX isn't asked to juggle multiple params at once.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()


@dataclass
class _Job:
    id: str
    model_id: str
    temperatures: list[float]
    top_ps: list[float]
    prompts: list[dict]               # [{id, prompt, expected_substring}]
    max_tokens: int
    status: str = "queued"
    cells: list[dict] = field(default_factory=list)  # {t, p, pass_rate, examples}
    started_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None


_jobs: dict[str, _Job] = {}


def _omlx_name(model_id: str, registry) -> str:
    m = registry.get(model_id) if registry else None
    if m and getattr(m, "path", None):
        return Path(m.path).name
    return model_id.split(":", 1)[-1] if ":" in model_id else model_id


async def _run_cell(client: httpx.AsyncClient, base_url: str, model_name: str,
                     prompt: str, temperature: float, top_p: float,
                     max_tokens: int, expected: str) -> dict[str, Any]:
    payload = {
        "model": model_name,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": temperature, "top_p": top_p,
        "max_tokens": max_tokens, "stream": False,
    }
    try:
        r = await client.post(f"{base_url}/v1/chat/completions", json=payload, timeout=300.0)
        r.raise_for_status()
        resp = r.json()["choices"][0]["message"].get("content") or ""
    except Exception as e:
        return {"passed": False, "response": "", "error": str(e)}
    passed = expected.lower() in resp.lower() if expected else True
    return {"passed": passed, "response": resp[:500], "error": ""}


async def _run(job: _Job, base_url: str, api_key: str, registry) -> None:
    job.status = "running"
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    name = _omlx_name(job.model_id, registry)
    try:
        async with httpx.AsyncClient(headers=headers) as client:
            for t in job.temperatures:
                for p in job.top_ps:
                    passed = 0
                    examples: list[dict] = []
                    for item in job.prompts:
                        res = await _run_cell(
                            client, base_url, name,
                            item["prompt"], t, p, job.max_tokens,
                            item.get("expected_substring", ""),
                        )
                        if res["passed"]:
                            passed += 1
                        if len(examples) < 2:
                            examples.append({
                                "id": item.get("id"),
                                "passed": res["passed"],
                                "response": res["response"][:200],
                                "error": res["error"],
                            })
                    rate = passed / max(1, len(job.prompts))
                    job.cells.append({
                        "temperature": t, "top_p": p,
                        "pass_rate": round(rate, 3), "passed": passed,
                        "total": len(job.prompts), "examples": examples,
                    })
    finally:
        job.status = "done"
        job.finished_at = time.time()


class SweepStart(BaseModel):
    model_id: str
    # Defaults chosen to cover 'explore vs exploit' axes.
    temperatures: list[float] = [0.0, 0.3, 0.7, 1.0]
    top_ps: list[float] = [0.9, 0.95, 1.0]
    # Each prompt has an expected_substring — case-insensitive, any match passes.
    prompts: list[dict]
    max_tokens: int = 256


@router.post("/param-sweep/start")
async def start(body: SweepStart, request: Request) -> dict:
    if not body.prompts:
        raise HTTPException(400, "prompts list is empty")
    cfg = request.app.state.config
    base_url = cfg.mlx_external_url or "http://127.0.0.1:8000"
    api_key = cfg.omlx_api_key
    registry = getattr(request.app.state, "registry", None)
    job = _Job(
        id=uuid.uuid4().hex[:12], model_id=body.model_id,
        temperatures=list(body.temperatures), top_ps=list(body.top_ps),
        prompts=list(body.prompts), max_tokens=body.max_tokens,
    )
    _jobs[job.id] = job
    asyncio.create_task(_run(job, base_url, api_key, registry))
    return {
        "job_id": job.id,
        "grid_size": len(body.temperatures) * len(body.top_ps),
        "total_calls": len(body.temperatures) * len(body.top_ps) * len(body.prompts),
    }


@router.get("/param-sweep/{job_id}")
async def get(job_id: str) -> dict:
    j = _jobs.get(job_id)
    if not j:
        raise HTTPException(404, "job not found")
    return {
        "id": j.id, "model_id": j.model_id, "status": j.status,
        "cells": j.cells,
        "started_at": j.started_at, "finished_at": j.finished_at,
    }


@router.get("/param-sweep")
async def list_jobs() -> list[dict]:
    return [
        {
            "id": j.id, "model_id": j.model_id, "status": j.status,
            "cells": len(j.cells),
            "started_at": j.started_at, "finished_at": j.finished_at,
        }
        for j in sorted(_jobs.values(), key=lambda j: -j.started_at)
    ]
