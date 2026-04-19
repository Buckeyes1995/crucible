"""Multi-model ensemble — fan out one prompt to N models, combine outputs.

Strategies:
  * "longest"    — pick the longest response
  * "best_of_n"  — use a judge model to rerank and pick a winner
  * "concat"     — return all responses side-by-side for manual review

Runs models sequentially (same constraint as arena — oMLX holds one at a
time) but persists each response as it completes, so the UI can render
them as they land.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import arena as arena_mod  # for stream_to_omlx

log = logging.getLogger(__name__)
router = APIRouter()


@dataclass
class EnsembleResult:
    model_id: str
    response: str = ""
    tps: Optional[float] = None
    ttft_ms: Optional[float] = None
    tokens: Optional[int] = None
    error: str = ""


@dataclass
class EnsembleJob:
    id: str
    prompt: str
    model_ids: list[str]
    strategy: str
    judge_model_id: Optional[str]
    results: list[EnsembleResult] = field(default_factory=list)
    final_response: str = ""
    winner_model_id: Optional[str] = None
    status: str = "queued"
    started_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None


_jobs: dict[str, EnsembleJob] = {}
STORE = Path.home() / ".config" / "crucible" / "ensemble_jobs"


def _persist(job: EnsembleJob) -> None:
    try:
        STORE.mkdir(parents=True, exist_ok=True)
        (STORE / f"{job.id}.json").write_text(json.dumps({
            "id": job.id, "prompt": job.prompt, "model_ids": job.model_ids,
            "strategy": job.strategy, "judge_model_id": job.judge_model_id,
            "results": [r.__dict__ for r in job.results],
            "final_response": job.final_response,
            "winner_model_id": job.winner_model_id,
            "status": job.status,
            "started_at": job.started_at, "finished_at": job.finished_at,
        }, indent=2))
    except Exception as e:
        log.warning("ensemble persist failed: %s", e)


def _omlx_name(model_id: str, registry) -> str:
    """Resolve the prefixed id (e.g. "mlx:Foo") to oMLX's expected name
    (the model directory name) via the registry."""
    m = registry.get(model_id) if registry else None
    if m and getattr(m, "path", None):
        return Path(m.path).name
    return model_id.split(":", 1)[-1] if ":" in model_id else model_id


async def _gen_one(base_url: str, api_key: str, model_id: str, prompt: str,
                   max_tokens: int, omlx_name: str) -> EnsembleResult:
    parts: list[str] = []
    tps = ttft_ms = tokens = None
    err = ""
    try:
        async for chunk in arena_mod.stream_to_omlx(
            omlx_name, [{"role": "user", "content": prompt}],
            base_url, api_key, temperature=0.7, max_tokens=max_tokens,
            warmup=False,
        ):
            if chunk.get("done"):
                tps = chunk.get("tps")
                ttft_ms = chunk.get("ttft_ms")
                tokens = chunk.get("output_tokens")
                break
            tok = chunk.get("token", "")
            if tok:
                parts.append(tok)
    except Exception as e:
        err = str(e)
    return EnsembleResult(model_id=model_id, response="".join(parts),
                          tps=tps, ttft_ms=ttft_ms, tokens=tokens, error=err)


async def _unload(base_url: str, api_key: str, omlx_name: str) -> None:
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(f"{base_url}/v1/models/{omlx_name}/unload", headers=headers)
    except Exception:
        pass


async def _judge(base_url: str, api_key: str, judge_omlx_name: str, prompt: str,
                 candidates: list[EnsembleResult]) -> tuple[Optional[str], str]:
    """Ask a judge model to pick the best of N. Returns (winner_model_id, reasoning)."""
    # Construct a compact judge prompt. Use simple letter labels A, B, C... so
    # the judge isn't biased by model names.
    labeled = list(zip("ABCDEFGH", candidates))
    lines = [
        "You are evaluating multiple answers to the same question. Pick the single best "
        "answer based on correctness, clarity, and completeness. Respond with ONLY the "
        "letter of the winner on the first line, then one sentence of reasoning on the "
        "second line. Do not prefer longer answers — prefer clearer ones.",
        "",
        f"QUESTION:\n{prompt}",
        "",
    ]
    for letter, c in labeled:
        lines.append(f"--- ANSWER {letter} ---")
        lines.append(c.response[:3000])  # keep judge prompt finite
        lines.append("")
    lines.append("Which answer is best?")
    judge_prompt = "\n".join(lines)

    out = ""
    try:
        async for chunk in arena_mod.stream_to_omlx(
            judge_omlx_name, [{"role": "user", "content": judge_prompt}],
            base_url, api_key, temperature=0.0, max_tokens=256,
            warmup=False,
        ):
            if chunk.get("done"):
                break
            tok = chunk.get("token", "")
            if tok:
                out += tok
    except Exception as e:
        return None, f"judge error: {e}"

    # Pull the first letter from the output; tolerant of extra whitespace /
    # quotes / sentences.
    first_line = out.strip().splitlines()[0] if out.strip() else ""
    letter = next((c for c in first_line.upper() if c in "ABCDEFGH"), None)
    reasoning = "\n".join(out.strip().splitlines()[1:])[:600]
    if not letter:
        return None, f"judge didn't pick a letter: {first_line[:80]}"
    idx = "ABCDEFGH".index(letter)
    if idx >= len(candidates):
        return None, f"judge picked out-of-range letter {letter}"
    return candidates[idx].model_id, reasoning


async def _run_job(job: EnsembleJob, base_url: str, api_key: str,
                   max_tokens: int, omlx_names: dict[str, str]) -> None:
    job.status = "running"
    _persist(job)
    for mid in job.model_ids:
        name = omlx_names.get(mid, mid)
        result = await _gen_one(base_url, api_key, mid, job.prompt, max_tokens, name)
        job.results.append(result)
        _persist(job)
        await _unload(base_url, api_key, name)

    # Filter successful results only
    candidates = [r for r in job.results if r.response and not r.error]
    if not candidates:
        job.status = "error"
        job.final_response = "no successful responses"
        job.finished_at = time.time()
        _persist(job)
        return

    if job.strategy == "longest":
        winner = max(candidates, key=lambda r: len(r.response))
        job.winner_model_id = winner.model_id
        job.final_response = winner.response
    elif job.strategy == "best_of_n" and job.judge_model_id:
        judge_name = omlx_names.get(job.judge_model_id, job.judge_model_id)
        winner_id, reasoning = await _judge(
            base_url, api_key, judge_name, job.prompt, candidates,
        )
        await _unload(base_url, api_key, judge_name)
        if winner_id:
            job.winner_model_id = winner_id
            winner = next(r for r in candidates if r.model_id == winner_id)
            job.final_response = winner.response + "\n\n---\n[judge]: " + reasoning
        else:
            # Fall back to longest
            winner = max(candidates, key=lambda r: len(r.response))
            job.winner_model_id = winner.model_id
            job.final_response = winner.response + "\n\n---\n[judge failed, fell back to longest]"
    else:
        # concat — all responses side-by-side
        job.final_response = "\n\n---\n\n".join(
            f"[{r.model_id}]\n{r.response}" for r in candidates
        )

    job.status = "done"
    job.finished_at = time.time()
    _persist(job)


class EnsembleRequest(BaseModel):
    prompt: str
    model_ids: list[str]
    strategy: str = "best_of_n"        # "longest" | "best_of_n" | "concat"
    judge_model_id: Optional[str] = None
    max_tokens: int = 1024


@router.post("/ensemble/run")
async def run_ensemble(body: EnsembleRequest, request: Request) -> dict:
    if body.strategy not in ("longest", "best_of_n", "concat"):
        raise HTTPException(400, f"unknown strategy: {body.strategy}")
    if len(body.model_ids) < 2:
        raise HTTPException(400, "ensemble needs at least 2 models")
    if body.strategy == "best_of_n" and not body.judge_model_id:
        raise HTTPException(400, "best_of_n requires judge_model_id")

    cfg = request.app.state.config
    base_url = cfg.mlx_external_url or "http://127.0.0.1:8000"
    api_key = cfg.omlx_api_key
    registry = request.app.state.registry

    omlx_names: dict[str, str] = {mid: _omlx_name(mid, registry) for mid in body.model_ids}
    if body.judge_model_id:
        omlx_names[body.judge_model_id] = _omlx_name(body.judge_model_id, registry)

    job = EnsembleJob(
        id=uuid.uuid4().hex[:12],
        prompt=body.prompt,
        model_ids=list(body.model_ids),
        strategy=body.strategy,
        judge_model_id=body.judge_model_id,
    )
    _jobs[job.id] = job
    asyncio.create_task(_run_job(job, base_url, api_key, body.max_tokens, omlx_names))
    return {"job_id": job.id}


@router.get("/ensemble/{job_id}")
async def job_status(job_id: str) -> dict:
    j = _jobs.get(job_id)
    if not j:
        raise HTTPException(404, "Ensemble job not found")
    return {
        "id": j.id, "prompt": j.prompt, "strategy": j.strategy,
        "model_ids": j.model_ids, "judge_model_id": j.judge_model_id,
        "status": j.status, "results": [r.__dict__ for r in j.results],
        "final_response": j.final_response, "winner_model_id": j.winner_model_id,
        "started_at": j.started_at, "finished_at": j.finished_at,
    }
