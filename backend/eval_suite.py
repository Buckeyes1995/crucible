"""Structured eval suite — multi-category scoring across code / reasoning /
factual / instruction-following.

Each category has a handful of prompts with an automated scorer. Produces
per-category pass rates + an overall weighted score per model. Complements
HumanEval (code-only) by measuring broader capabilities.
"""
from __future__ import annotations

import asyncio
import json
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

import httpx


@dataclass
class EvalItem:
    id: str
    category: str
    prompt: str
    # Grading: for the MVP we expose a small set of built-in scorers, each a
    # regex/keyword check. Returns True if the response passes.
    scorer_kind: str    # "contains_all" | "contains_any" | "regex" | "integer_match"
    scorer_args: dict


# Baseline tiny eval set — intentionally small so a full run completes in
# reasonable time across several models. Expand as needed.
EVAL_ITEMS: list[EvalItem] = [
    # ─── Code ────────────────────────────────────────────────────────────────
    EvalItem(
        id="code.reverse_string",
        category="code",
        prompt="Write a Python function `reverse(s)` that returns the string reversed. Reply with only the function definition in a ```python code block.",
        scorer_kind="regex",
        scorer_args={"pattern": r"def reverse\s*\(\s*s\s*\).*\n.*\[::-1\]", "flags": "sm"},
    ),
    EvalItem(
        id="code.fizzbuzz",
        category="code",
        prompt="Write a Python function `fizzbuzz(n)` printing FizzBuzz from 1 to n. Reply with only the function in a ```python code block.",
        scorer_kind="contains_all",
        scorer_args={"items": ["def fizzbuzz", "% 15", "% 3", "% 5"], "case_sensitive": False},
    ),

    # ─── Reasoning ───────────────────────────────────────────────────────────
    EvalItem(
        id="reasoning.odd_one_out",
        category="reasoning",
        prompt="Which word is the odd one out: apple, banana, carrot, cherry? Answer with just the word.",
        scorer_kind="contains_any",
        scorer_args={"items": ["carrot"], "case_sensitive": False},
    ),
    EvalItem(
        id="reasoning.arithmetic",
        category="reasoning",
        prompt="A train leaves at 3:15 pm going 60 mph and another at 4:00 pm going 80 mph from the same station, same direction. When does the second catch up? Answer in clock time only (e.g. '7:30 pm').",
        scorer_kind="contains_any",
        scorer_args={"items": ["7:00 pm", "7 pm", "7:00 PM"], "case_sensitive": False},
    ),

    # ─── Factual ─────────────────────────────────────────────────────────────
    EvalItem(
        id="factual.capital_france",
        category="factual",
        prompt="What is the capital of France? One word only.",
        scorer_kind="contains_any",
        scorer_args={"items": ["paris"], "case_sensitive": False},
    ),
    EvalItem(
        id="factual.year_moon",
        category="factual",
        prompt="In what year did Apollo 11 land on the moon? Answer with only the year.",
        scorer_kind="integer_match",
        scorer_args={"expected": 1969},
    ),

    # ─── Instruction-following ───────────────────────────────────────────────
    EvalItem(
        id="instr.uppercase",
        category="instruction",
        prompt="Reply with the text 'acknowledged' in ALL CAPS, no quotes, nothing else.",
        scorer_kind="regex",
        scorer_args={"pattern": r"^\s*ACKNOWLEDGED\s*$", "flags": "m"},
    ),
    EvalItem(
        id="instr.bullets",
        category="instruction",
        prompt="List three primary colors as a numbered list like '1. X'. No explanations.",
        scorer_kind="contains_all",
        scorer_args={"items": ["1.", "2.", "3.", "red", "blue", "yellow"], "case_sensitive": False},
    ),
]


def _score(resp: str, item: EvalItem) -> bool:
    if item.scorer_kind == "contains_all":
        items = item.scorer_args.get("items", [])
        cs = item.scorer_args.get("case_sensitive", True)
        body = resp if cs else resp.lower()
        return all((s if cs else s.lower()) in body for s in items)
    if item.scorer_kind == "contains_any":
        items = item.scorer_args.get("items", [])
        cs = item.scorer_args.get("case_sensitive", True)
        body = resp if cs else resp.lower()
        return any((s if cs else s.lower()) in body for s in items)
    if item.scorer_kind == "regex":
        pattern = item.scorer_args.get("pattern", "")
        flags = 0
        fstr = item.scorer_args.get("flags", "")
        if "s" in fstr:
            flags |= re.DOTALL
        if "m" in fstr:
            flags |= re.MULTILINE
        if "i" in fstr:
            flags |= re.IGNORECASE
        return re.search(pattern, resp, flags) is not None
    if item.scorer_kind == "integer_match":
        expected = item.scorer_args.get("expected")
        nums = re.findall(r"\b\d+\b", resp)
        return any(int(n) == expected for n in nums)
    return False


@dataclass
class EvalResult:
    item_id: str
    category: str
    passed: bool
    response: str
    elapsed_s: float
    error: str = ""


@dataclass
class EvalJob:
    id: str
    model_id: str       # display id (e.g. "mlx:Foo") — what the UI shows
    omlx_name: str      # bare directory name — what oMLX's /v1 expects
    results: list[EvalResult] = field(default_factory=list)
    status: str = "queued"
    started_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)


_jobs: dict[str, EvalJob] = {}
STORE = Path.home() / ".config" / "crucible" / "eval_jobs"


def _persist(job: EvalJob) -> None:
    try:
        STORE.mkdir(parents=True, exist_ok=True)
        (STORE / f"{job.id}.json").write_text(json.dumps({
            "id": job.id, "model_id": job.model_id, "status": job.status,
            "started_at": job.started_at, "finished_at": job.finished_at,
            "results": [r.__dict__ for r in job.results],
        }, indent=2))
    except Exception:
        pass


async def _gen_once(base_url: str, api_key: str, model: str, prompt: str) -> tuple[str, str]:
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.0,
        "max_tokens": 512,
        "stream": False,
    }
    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            r = await client.post(f"{base_url}/v1/chat/completions",
                                  json=payload, headers=headers)
            r.raise_for_status()
            data = r.json()
            return data["choices"][0]["message"]["content"] or "", ""
    except Exception as e:
        return "", str(e)


async def _run_job(job: EvalJob, base_url: str, api_key: str) -> None:
    job.status = "running"
    _persist(job)
    for item in EVAL_ITEMS:
        if job.cancel_event.is_set():
            job.status = "cancelled"
            job.finished_at = time.time()
            _persist(job)
            return
        t0 = time.monotonic()
        resp, err = await _gen_once(base_url, api_key, job.omlx_name, item.prompt)
        elapsed = time.monotonic() - t0
        passed = _score(resp, item) if not err else False
        job.results.append(EvalResult(
            item_id=item.id, category=item.category, passed=passed,
            response=resp[:1000], elapsed_s=round(elapsed, 2), error=err,
        ))
        _persist(job)
    job.status = "done"
    job.finished_at = time.time()
    _persist(job)


def start(model_id: str, omlx_name: str, base_url: str, api_key: str) -> EvalJob:
    job = EvalJob(id=uuid.uuid4().hex[:12], model_id=model_id, omlx_name=omlx_name)
    _jobs[job.id] = job
    asyncio.create_task(_run_job(job, base_url, api_key))
    return job


def get(job_id: str) -> Optional[EvalJob]:
    return _jobs.get(job_id)


def list_jobs() -> list[EvalJob]:
    return sorted(_jobs.values(), key=lambda j: -j.started_at)


def summarize(job: EvalJob) -> dict:
    if not job.results:
        return {"by_category": {}, "total": 0, "passed": 0, "pass_rate": 0.0}
    by_cat: dict[str, dict[str, int]] = {}
    for r in job.results:
        b = by_cat.setdefault(r.category, {"total": 0, "passed": 0})
        b["total"] += 1
        if r.passed:
            b["passed"] += 1
    total = len(job.results)
    passed = sum(1 for r in job.results if r.passed)
    # Weighted: equal weight per category (prevents code-heavy set from dominating)
    cat_rates = [b["passed"] / b["total"] for b in by_cat.values() if b["total"] > 0]
    weighted = sum(cat_rates) / len(cat_rates) if cat_rates else 0.0
    return {
        "by_category": {k: {**v, "rate": round(v["passed"] / v["total"], 3) if v["total"] else 0}
                        for k, v in by_cat.items()},
        "total": total, "passed": passed,
        "overall_rate": round(passed / total, 3) if total else 0.0,
        "weighted_rate": round(weighted, 3),
    }
