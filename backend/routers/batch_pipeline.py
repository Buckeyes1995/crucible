"""Batch inference pipeline — run N prompts overnight against a picked model,
emit a CSV of results. Distinct from benchmarks because prompts are user-
supplied one-offs, not standardized.
"""
from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import aiosqlite
import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from db.database import DB_PATH

log = logging.getLogger(__name__)
router = APIRouter()


@dataclass
class BatchRow:
    idx: int
    prompt: str
    response: str = ""
    tps: Optional[float] = None
    ttft_ms: Optional[float] = None
    tokens: Optional[int] = None
    error: str = ""
    elapsed_s: float = 0.0


@dataclass
class BatchJob:
    id: str
    model_id: str
    rows: list[BatchRow]
    temperature: float
    max_tokens: int
    started_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    status: str = "queued"      # queued | running | done | cancelled | error
    cursor: int = 0             # next row index to process
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)


_jobs: dict[str, BatchJob] = {}
RESULTS_DIR = Path.home() / ".config" / "crucible" / "batch_results"


def _persist(job: BatchJob) -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    try:
        (RESULTS_DIR / f"{job.id}.json").write_text(json.dumps({
            "id": job.id,
            "model_id": job.model_id,
            "temperature": job.temperature,
            "max_tokens": job.max_tokens,
            "started_at": job.started_at,
            "finished_at": job.finished_at,
            "status": job.status,
            "cursor": job.cursor,
            "rows": [r.__dict__ for r in job.rows],
        }, indent=2, default=str))
    except Exception as e:
        log.warning("batch persist failed: %s", e)


def _resolve_omlx_name(model_id: str, registry) -> str:
    """Strip the backend prefix and return the directory/name that oMLX's
    /v1/chat/completions expects. Mirrors what arena does via Path(m.path).name."""
    m = registry.get(model_id) if registry else None
    if m and getattr(m, "path", None):
        return Path(m.path).name
    # Fallback: drop the first `prefix:` segment
    return model_id.split(":", 1)[-1] if ":" in model_id else model_id


async def _run_prompt(
    client: httpx.AsyncClient, base_url: str, api_key: str,
    model: str, prompt: str, temperature: float, max_tokens: int,
) -> BatchRow:
    """Fire one /v1/chat/completions request and collect stats."""
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    t0 = time.monotonic()
    first_token = None
    tokens = 0
    parts: list[str] = []
    try:
        async with client.stream("POST", f"{base_url}/v1/chat/completions",
                                 json=payload, headers=headers, timeout=600.0) as resp:
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                chunk = line[6:]
                if chunk.strip() == "[DONE]":
                    break
                try:
                    data = json.loads(chunk)
                    delta = data["choices"][0]["delta"]
                    content = (delta.get("content") or delta.get("reasoning_content")
                               or delta.get("reasoning") or "")
                    if content:
                        if first_token is None:
                            first_token = time.monotonic()
                        tokens += 1
                        parts.append(content)
                except Exception:
                    continue
        t1 = time.monotonic()
        ttft_ms = round((first_token - t0) * 1000, 2) if first_token else None
        gen_time = (t1 - first_token) if first_token else (t1 - t0)
        tps = round(tokens / gen_time, 2) if gen_time > 0 and tokens > 0 else None
        return BatchRow(idx=-1, prompt=prompt, response="".join(parts),
                        tps=tps, ttft_ms=ttft_ms, tokens=tokens, elapsed_s=round(t1 - t0, 2))
    except Exception as e:
        return BatchRow(idx=-1, prompt=prompt, error=str(e),
                        elapsed_s=round(time.monotonic() - t0, 2))


async def _run_job(job: BatchJob, base_url: str, api_key: str, omlx_name: str) -> None:
    job.status = "running"
    _persist(job)
    async with httpx.AsyncClient() as client:
        while job.cursor < len(job.rows):
            if job.cancel_event.is_set():
                job.status = "cancelled"
                job.finished_at = time.time()
                _persist(job)
                return
            row_in = job.rows[job.cursor]
            result = await _run_prompt(
                client, base_url, api_key, omlx_name,
                row_in.prompt, job.temperature, job.max_tokens,
            )
            result.idx = row_in.idx
            job.rows[job.cursor] = result
            job.cursor += 1
            _persist(job)
    job.status = "done"
    job.finished_at = time.time()
    _persist(job)


class StartRequest(BaseModel):
    model_id: str
    prompts: list[str]
    temperature: float = 0.7
    max_tokens: int = 1024


@router.post("/batch-pipeline/start")
async def start(body: StartRequest, request: Request) -> dict:
    if not body.prompts:
        raise HTTPException(400, "prompts list is empty")
    cfg = request.app.state.config
    base_url = cfg.mlx_external_url or "http://127.0.0.1:8000"
    api_key = cfg.omlx_api_key
    registry = request.app.state.registry
    omlx_name = _resolve_omlx_name(body.model_id, registry)
    job = BatchJob(
        id=uuid.uuid4().hex[:12],
        model_id=body.model_id,
        rows=[BatchRow(idx=i, prompt=p) for i, p in enumerate(body.prompts)],
        temperature=body.temperature,
        max_tokens=body.max_tokens,
    )
    _jobs[job.id] = job
    asyncio.create_task(_run_job(job, base_url, api_key, omlx_name))
    return {"job_id": job.id, "total": len(body.prompts)}


@router.get("/batch-pipeline")
async def list_jobs() -> list[dict]:
    out = []
    for j in sorted(_jobs.values(), key=lambda j: -j.started_at):
        out.append({
            "id": j.id, "model_id": j.model_id,
            "status": j.status, "total": len(j.rows), "done": j.cursor,
            "started_at": j.started_at, "finished_at": j.finished_at,
        })
    return out


@router.get("/batch-pipeline/{job_id}")
async def status(job_id: str) -> dict:
    j = _jobs.get(job_id)
    if not j:
        raise HTTPException(404, "Job not found")
    return {
        "id": j.id, "model_id": j.model_id,
        "status": j.status, "total": len(j.rows), "done": j.cursor,
        "temperature": j.temperature, "max_tokens": j.max_tokens,
        "started_at": j.started_at, "finished_at": j.finished_at,
        "rows": [r.__dict__ for r in j.rows[: j.cursor + 1]],  # +1 to preview in-flight
    }


@router.delete("/batch-pipeline/{job_id}")
async def cancel(job_id: str) -> dict:
    j = _jobs.get(job_id)
    if not j:
        raise HTTPException(404, "Job not found")
    j.cancel_event.set()
    return {"status": "cancelling"}


@router.get("/batch-pipeline/{job_id}/csv")
async def download_csv(job_id: str) -> StreamingResponse:
    j = _jobs.get(job_id)
    if not j:
        raise HTTPException(404, "Job not found")
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["idx", "prompt", "response", "tokens", "tps", "ttft_ms", "elapsed_s", "error"])
    for r in j.rows:
        w.writerow([r.idx, r.prompt, r.response, r.tokens, r.tps, r.ttft_ms, r.elapsed_s, r.error])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=batch-{job_id}.csv"},
    )
