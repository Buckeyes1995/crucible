"""Needle-in-a-haystack context-length torture test.

Builds synthetic long-context prompts (filler text + a unique 'needle' at a
random position) and asks the model to recall the needle. Measures:
  * recall success at each tested context length
  * first-token latency (scales with prefill cost)
  * tok/s on the generation phase (shouldn't degrade with context, but does)

Provides diagnostic data that HumanEval / other single-turn benchmarks miss.
"""
from __future__ import annotations

import asyncio
import json
import random
import string
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import aiosqlite
import httpx


# Deterministic filler so a given prompt length is reproducible. One paragraph
# of lorem-ipsum-flavored text; we tile it up to the requested token count.
_FILLER = (
    "The process of learning by doing requires one to encounter situations whose "
    "solutions are not immediately evident, and to then carefully reason about the "
    "available evidence. Consider a busy airport terminal at dawn: travelers arrive "
    "at various gates, each carrying memories that have nothing to do with the "
    "destination listed on their boarding pass. Some will eat breakfast before "
    "boarding; others will make a phone call home. A musician tunes a guitar in the "
    "corner. A child laughs. The terminal hums with activity, none of it "
    "coordinated. And yet, somehow, everyone reaches their flight on time.\n\n"
)


def _approx_tokens_to_chars(tokens: int) -> int:
    """Rough conversion — ~3.5 characters per token on average English."""
    return int(tokens * 3.5)


def build_prompt(target_tokens: int, seed: int = 1) -> tuple[str, str]:
    """Return (prompt, needle). Inserts the needle at a random position
    roughly proportional to target_tokens so recall depth is controllable."""
    rng = random.Random(seed)
    target_chars = _approx_tokens_to_chars(target_tokens)

    # Needle: a unique short sentence the model must recall verbatim.
    secret_word = "".join(rng.choices(string.ascii_uppercase, k=8))
    secret_number = rng.randint(10_000, 99_999)
    needle = f"The secret code is {secret_word}-{secret_number}."

    # Build filler by tiling; insert needle roughly in the middle-ish by default.
    filler_text = (_FILLER * (target_chars // len(_FILLER) + 1))[:target_chars]
    insert_at = rng.randint(target_chars // 4, 3 * target_chars // 4)
    filler_with_needle = filler_text[:insert_at] + "\n\n" + needle + "\n\n" + filler_text[insert_at:]

    prompt = (
        "You are reading a very long document. Somewhere in it is a single sentence "
        "of the form 'The secret code is XXX-NNNNN.' Read the document and then "
        "reply with ONLY that sentence, verbatim. Do not explain.\n\n"
        "=== DOCUMENT ===\n"
        f"{filler_with_needle}\n"
        "=== END DOCUMENT ===\n\n"
        "Now reply with only the secret code sentence."
    )
    return prompt, needle


@dataclass
class NIAHResult:
    target_tokens: int
    success: bool
    ttft_ms: Optional[float]
    tps: Optional[float]
    elapsed_s: float
    response: str
    needle: str
    error: str = ""


@dataclass
class NIAHJob:
    id: str
    model_id: str       # display id (e.g. "mlx:Foo") — what the UI shows
    omlx_name: str      # bare directory name — what oMLX's /v1 expects
    lengths: list[int]
    results: list[NIAHResult] = field(default_factory=list)
    status: str = "queued"
    started_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)


_jobs: dict[str, NIAHJob] = {}
STORE = Path.home() / ".config" / "crucible" / "niah_jobs"


def _persist(job: NIAHJob) -> None:
    try:
        STORE.mkdir(parents=True, exist_ok=True)
        (STORE / f"{job.id}.json").write_text(json.dumps({
            "id": job.id, "model_id": job.model_id, "lengths": job.lengths,
            "status": job.status, "started_at": job.started_at,
            "finished_at": job.finished_at,
            "results": [r.__dict__ for r in job.results],
        }, indent=2))
    except Exception:
        pass


async def _run_one(base_url: str, api_key: str, model: str, target_tokens: int,
                   max_tokens: int, seed: int) -> NIAHResult:
    prompt, needle = build_prompt(target_tokens, seed=seed)
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.0,
        "max_tokens": max_tokens,
        "stream": True,
    }
    t0 = time.monotonic()
    first_token = None
    tokens = 0
    parts: list[str] = []
    err = ""
    try:
        async with httpx.AsyncClient(timeout=900.0) as client:
            async with client.stream("POST", f"{base_url}/v1/chat/completions",
                                     json=payload, headers=headers) as resp:
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
    except Exception as e:
        err = str(e)
    t1 = time.monotonic()
    ttft_ms = round((first_token - t0) * 1000, 2) if first_token else None
    gen_time = (t1 - first_token) if first_token else (t1 - t0)
    tps = round(tokens / gen_time, 2) if gen_time > 0 and tokens > 0 else None
    response = "".join(parts)
    # Success = needle tokens (word + number) both appear in response
    body = response.upper()
    word_part = needle.split("is ")[1].split("-")[0].strip().upper()
    num_part = needle.split("-")[-1].rstrip(".").strip()
    success = word_part in body and num_part in body
    return NIAHResult(
        target_tokens=target_tokens, success=success,
        ttft_ms=ttft_ms, tps=tps, elapsed_s=round(t1 - t0, 2),
        response=response[:500], needle=needle, error=err,
    )


async def _run_job(job: NIAHJob, base_url: str, api_key: str, max_tokens: int,
                   seed: int) -> None:
    job.status = "running"
    _persist(job)
    for target in job.lengths:
        if job.cancel_event.is_set():
            job.status = "cancelled"
            job.finished_at = time.time()
            _persist(job)
            return
        result = await _run_one(base_url, api_key, job.omlx_name, target, max_tokens, seed)
        job.results.append(result)
        _persist(job)
    job.status = "done"
    job.finished_at = time.time()
    _persist(job)


def start(model_id: str, omlx_name: str, lengths: list[int], base_url: str,
          api_key: str, max_tokens: int = 128, seed: int = 1) -> NIAHJob:
    job = NIAHJob(
        id=uuid.uuid4().hex[:12],
        model_id=model_id,
        omlx_name=omlx_name,
        lengths=sorted(set(lengths)),
    )
    _jobs[job.id] = job
    asyncio.create_task(_run_job(job, base_url, api_key, max_tokens, seed))
    return job


def get(job_id: str) -> Optional[NIAHJob]:
    return _jobs.get(job_id)


def list_jobs() -> list[NIAHJob]:
    return sorted(_jobs.values(), key=lambda j: -j.started_at)
