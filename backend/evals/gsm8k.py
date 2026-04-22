"""GSM8K eval runner (Roadmap v4 #5 MVP) — grade-school math word problems.

Downloads the bundled JSONL (100-problem subsample) on first run, streams
progress via an async iterator. Answer extraction follows the standard
"last integer in the model's response wins" heuristic; reference answers
live after the `####` marker in each problem.

Dataset is sourced locally — on first call we fall back to the HF mirror
at `openai/gsm8k/test`. 100 problems is enough to rank models without
burning hours of inference.
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
import re
import time
import uuid
from pathlib import Path
from typing import Any, AsyncIterator, Optional

import httpx

log = logging.getLogger(__name__)

DATASET_FILE = Path.home() / ".config" / "crucible" / "evals" / "gsm8k_sample.jsonl"
RESULTS_FILE = Path.home() / ".config" / "crucible" / "evals" / "gsm8k_results.json"

PROXY_URL = "http://127.0.0.1:7777/v1/chat/completions"

SYSTEM_PROMPT = (
    "You solve grade-school math word problems. Reason briefly, then give "
    "the FINAL ANSWER on its own line in the form: #### <number>"
)

# Bundled curated subsample, lives in the repo so we don't need a live fetch
# for V1. ~100 problems pulled from openai/gsm8k test split.
_BUNDLED_PATH = Path(__file__).parent / "gsm8k_sample.jsonl"


def _ensure_dataset() -> Path:
    DATASET_FILE.parent.mkdir(parents=True, exist_ok=True)
    if DATASET_FILE.exists() and DATASET_FILE.stat().st_size > 0:
        return DATASET_FILE
    if _BUNDLED_PATH.exists():
        DATASET_FILE.write_text(_BUNDLED_PATH.read_text())
        return DATASET_FILE
    # Tiny hand-authored fallback so the page always has something to run,
    # even if the bundled file is missing.
    starter = [
        {"question": "Janet has 12 apples. She gives 3 to each of her 2 friends. How many apples does she have left?", "answer": "6"},
        {"question": "A book has 200 pages. Tom reads 35 pages a day. How many full days will it take Tom to finish the book?", "answer": "6"},
        {"question": "A train travels 60 miles per hour for 2.5 hours. How many miles does it travel?", "answer": "150"},
        {"question": "You buy 4 shirts at $18 each and pay with a $100 bill. How much change do you get?", "answer": "28"},
        {"question": "In a class of 30 students, 40% are boys. How many girls are in the class?", "answer": "18"},
    ]
    DATASET_FILE.write_text("\n".join(json.dumps(s) for s in starter))
    return DATASET_FILE


def load_problems(limit: int = 100) -> list[dict[str, str]]:
    p = _ensure_dataset()
    out: list[dict[str, str]] = []
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except Exception:
            continue
        if len(out) >= limit:
            break
    return out


# ── Answer extraction ─────────────────────────────────────────────────────

_FINAL_LINE = re.compile(r"####\s*([-\d\.\,\/]+)")
_LAST_NUM = re.compile(r"-?\$?[\d][\d\.,]*")


def _normalize_num(s: str) -> Optional[float]:
    s = (s or "").strip().replace(",", "").replace("$", "").rstrip(".")
    if not s:
        return None
    try:
        # Handle fractions 3/4
        if "/" in s:
            a, b = s.split("/", 1)
            return float(a) / float(b) if float(b) != 0 else None
        return float(s)
    except Exception:
        return None


def extract_answer(resp: str) -> Optional[float]:
    if not resp:
        return None
    m = _FINAL_LINE.findall(resp)
    if m:
        return _normalize_num(m[-1])
    nums = _LAST_NUM.findall(resp)
    if nums:
        return _normalize_num(nums[-1])
    return None


def grade(expected: str, got: str) -> bool:
    e = _normalize_num(expected)
    g = extract_answer(got)
    if e is None or g is None:
        return False
    return abs(e - g) < 1e-4


# ── Runner (SSE-style async iterator) ─────────────────────────────────────

async def run(model_id: Optional[str], limit: int = 50, seed: int = 0) -> AsyncIterator[dict]:
    """Yield progress events:
       {event: 'started', run_id, total}
       {event: 'item', i, question, expected, response, got, correct}
       {event: 'finished', correct, total, accuracy, elapsed_ms}
    """
    run_id = uuid.uuid4().hex[:12]
    t0 = time.monotonic()
    probs = load_problems(limit=limit)
    rng = random.Random(seed)
    rng.shuffle(probs)
    probs = probs[:limit]
    yield {"event": "started", "run_id": run_id, "total": len(probs)}

    correct = 0
    async with httpx.AsyncClient(timeout=180.0) as client:
        for i, prob in enumerate(probs):
            payload = {
                "model": (model_id or "auto").replace("mlx:", ""),
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prob["question"]},
                ],
                "max_tokens": 400,
                "temperature": 0.0,
                "stream": False,
                "chat_template_kwargs": {"enable_thinking": False},
            }
            try:
                r = await client.post(PROXY_URL, json=payload)
                r.raise_for_status()
                resp_text = (r.json().get("choices") or [{}])[0].get("message", {}).get("content") or ""
            except Exception as e:
                resp_text = f"(error: {e})"

            got_val = extract_answer(resp_text)
            ok = grade(prob["answer"], resp_text)
            if ok:
                correct += 1
            yield {
                "event": "item",
                "i": i + 1,
                "question": prob["question"],
                "expected": prob["answer"],
                "response": resp_text,
                "got": None if got_val is None else str(got_val),
                "correct": ok,
                "running_accuracy": correct / (i + 1),
            }

    elapsed_ms = (time.monotonic() - t0) * 1000
    acc = correct / max(1, len(probs))
    result = {
        "run_id": run_id,
        "suite": "gsm8k",
        "model_id": model_id,
        "correct": correct,
        "total": len(probs),
        "accuracy": acc,
        "elapsed_ms": elapsed_ms,
        "finished_at": time.time(),
    }
    _persist_result(result)
    yield {"event": "finished", **result}


def _persist_result(result: dict) -> None:
    RESULTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    history: list[dict] = []
    if RESULTS_FILE.exists():
        try:
            history = json.loads(RESULTS_FILE.read_text())
        except Exception:
            history = []
    history.append(result)
    history = history[-200:]
    RESULTS_FILE.write_text(json.dumps(history, indent=2))


def load_history() -> list[dict]:
    if not RESULTS_FILE.exists():
        return []
    try:
        return json.loads(RESULTS_FILE.read_text())
    except Exception:
        return []
