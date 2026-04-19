"""Autobattle — queue N arena battles overnight, review in the morning.

Each queued battle picks two eligible MLX models (weighted toward low-prior-
battle-count pairs), runs both responses sequentially against oMLX with an
unload in between, and persists the result to arena_battles with winner=NULL
so the user can vote on it later via /arena/review.
"""
from __future__ import annotations

import asyncio
import logging
import random
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import aiosqlite
import httpx

from db.database import DB_PATH
import arena

log = logging.getLogger(__name__)


JUDGE_INSTRUCTIONS = (
    "You are evaluating two answers to the same question. Pick the better one "
    "based on correctness, clarity, and completeness. Do NOT prefer longer "
    "answers — prefer clearer ones. When both are roughly equal, prefer TIE "
    "only if there is no meaningful difference; slight differences should "
    "still produce a winner."
)


def _parse_verdict(out: str, swap: bool) -> tuple[Optional[str], str]:
    """Extract the judge's verdict from free-form output. Handles thinking-mode
    models that emit preamble before the actual answer: we scan for a
    'VERDICT: A' (or 'Winner: B', 'Answer: TIE') line anywhere in the output,
    falling back to the LAST standalone A/B/TIE line if needed.

    Returns (verdict, reasoning) where verdict is 'model_a' | 'model_b' | 'tie'
    or None when unparseable. Reasoning is a short human-readable string.
    """
    import re

    # 1) Look for labelled verdicts first — most reliable across thinking vs
    #    non-thinking models.
    labelled = re.search(
        r"(?:verdict|winner|answer|final|choice)\s*[:\-]\s*(A|B|TIE)\b",
        out, flags=re.IGNORECASE,
    )
    if labelled:
        token = labelled.group(1).upper()
    else:
        # 2) Fallback: scan the LAST non-empty line for a standalone letter,
        #    since a thinking model typically concludes with the answer.
        lines = [ln.strip() for ln in out.strip().splitlines() if ln.strip()]
        token = ""
        for ln in reversed(lines):
            m = re.match(r"^(A|B|TIE)\b", ln, flags=re.IGNORECASE)
            if m:
                token = m.group(1).upper()
                break
    if not token:
        return None, ""
    if token == "TIE":
        return "tie", ""
    # Un-swap: if we presented slots flipped, invert the verdict.
    if token == "A":
        return ("model_a" if not swap else "model_b"), ""
    if token == "B":
        return ("model_b" if not swap else "model_a"), ""
    return None, ""


async def judge_pair(base_url: str, api_key: str, judge_model: str,
                     prompt: str, response_a: str, response_b: str) -> tuple[str, str]:
    """Ask a judge model to pick a winner. Returns (winner, reasoning) where
    winner is 'model_a' | 'model_b' | 'tie'. Randomizes slot presentation to
    mitigate first-position bias.

    Handles thinking-mode judges: (a) requests the answer via a labelled
    "VERDICT:" line so reasoning preamble doesn't confuse parsing,
    (b) budgets 2048 tokens so reasoning + verdict both fit, (c) disables
    thinking entirely where the chat_template supports it.
    """
    import random as _random
    swap = _random.random() < 0.5
    left_resp, right_resp = (response_b, response_a) if swap else (response_a, response_b)
    judge_prompt = (
        f"{JUDGE_INSTRUCTIONS}\n\n"
        f"QUESTION:\n{prompt}\n\n"
        f"--- ANSWER A ---\n{left_resp[:4000]}\n\n"
        f"--- ANSWER B ---\n{right_resp[:4000]}\n\n"
        f"Respond with exactly this format (reasoning optional):\n"
        f"VERDICT: A   (or B, or TIE)\n"
        f"REASON: <one short sentence>"
    )
    out = ""
    try:
        async for chunk in arena.stream_to_omlx(
            judge_model, [{"role": "user", "content": judge_prompt}],
            base_url, api_key, temperature=0.0, max_tokens=2048, warmup=False,
            extra_params={"chat_template_kwargs": {"enable_thinking": False}},
        ):
            if chunk.get("done"):
                break
            tok = chunk.get("token", "")
            if tok:
                out += tok
    except Exception as e:
        return "tie", f"judge error: {e}"

    verdict, _ = _parse_verdict(out, swap)
    if verdict is None:
        # One retry without the chat_template kwarg (some oMLX configs reject
        # unknown kwargs); if still nothing parseable, fall back to tie.
        out2 = ""
        try:
            async for chunk in arena.stream_to_omlx(
                judge_model, [{"role": "user", "content": judge_prompt}],
                base_url, api_key, temperature=0.0, max_tokens=2048, warmup=False,
            ):
                if chunk.get("done"):
                    break
                tok = chunk.get("token", "")
                if tok:
                    out2 += tok
        except Exception:
            pass
        verdict, _ = _parse_verdict(out2, swap)
        if verdict is None:
            tail = (out or out2)[-200:].replace("\n", " ")
            return "tie", f"judge unparseable: …{tail}"
        out = out2

    # Pull the REASON: line if present, else first non-empty line after verdict
    import re
    m = re.search(r"reason\s*[:\-]\s*(.+?)(?:\n|$)", out, flags=re.IGNORECASE)
    reasoning = (m.group(1).strip() if m else out.strip().splitlines()[-1] if out.strip() else "")
    return verdict, reasoning[:500]


DEFAULT_PROMPTS = [
    "Write a haiku about a local LLM running on a laptop.",
    "Explain recursion using a real-world example. Keep it under 150 words.",
    "Write a Python function that detects palindromes. Include docstring + tests.",
    "What's the difference between a futures contract and an option? Short answer.",
    "Give me three non-obvious use cases for small language models.",
    "Write one clever, dry pun about artificial intelligence.",
    "Summarize the key idea of transformer attention in three sentences.",
    "A CSV file is malformed — write a robust Python parser that handles ragged rows.",
    "Compose a short villain monologue for a debugger-themed supervillain.",
    "List five things engineers routinely overestimate about their own code.",
]


@dataclass
class AutobattleJob:
    id: str
    target: int
    completed: int = 0
    skipped: int = 0
    errors: int = 0
    started_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    status: str = "running"   # running | done | cancelled | error
    last_message: str = ""


_jobs: dict[str, AutobattleJob] = {}
_cancel_flags: dict[str, asyncio.Event] = {}


def get_job(job_id: str) -> Optional[AutobattleJob]:
    return _jobs.get(job_id)


def list_jobs() -> list[dict]:
    return [
        {
            "id": j.id,
            "target": j.target,
            "completed": j.completed,
            "skipped": j.skipped,
            "errors": j.errors,
            "status": j.status,
            "started_at": j.started_at,
            "finished_at": j.finished_at,
            "last_message": j.last_message,
        }
        for j in sorted(_jobs.values(), key=lambda j: -j.started_at)
    ]


def cancel(job_id: str) -> bool:
    ev = _cancel_flags.get(job_id)
    if not ev:
        return False
    ev.set()
    return True


def _pick_eligible(registry) -> list:
    return [
        m for m in registry.all()
        if m.kind == "mlx" and m.node == "local"
        and not m.hidden and not m.name.endswith("-DFlash")
    ]


async def _pair_counts() -> dict[tuple[str, str], int]:
    """Prior-battle counts per unordered (model_a, model_b) pair — so we can
    weight new battles toward under-sampled pairs."""
    counts: dict[tuple[str, str], int] = {}
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT model_a, model_b FROM arena_battles WHERE winner IS NOT NULL"
        ) as cur:
            async for row in cur:
                a, b = sorted([row[0], row[1]])
                counts[(a, b)] = counts.get((a, b), 0) + 1
    return counts


async def _pick_pair(eligible: list) -> tuple[str, str, str, str] | None:
    if len(eligible) < 2:
        return None
    counts = await _pair_counts()
    pairs: list[tuple[int, tuple]] = []
    for i in range(len(eligible)):
        for j in range(i + 1, len(eligible)):
            a, b = eligible[i], eligible[j]
            name_a = Path(a.path).name if a.path else a.name
            name_b = Path(b.path).name if b.path else b.name
            key = tuple(sorted([name_a, name_b]))
            n = counts.get(key, 0)
            # Weight: lower-count pairs more likely. Add 1 so a zero-count pair
            # still has a finite (not-infinite) weight vs the others.
            weight = 1.0 / (n + 1)
            pairs.append((weight, (name_a, name_b, a.name, b.name)))
    total = sum(w for w, _ in pairs)
    if total <= 0:
        return None
    # Weighted sample via cumulative distribution
    r = random.random() * total
    acc = 0.0
    for w, pair in pairs:
        acc += w
        if acc >= r:
            # Randomize A/B slot so first-response bias doesn't systematically
            # favor model_a across many battles.
            if random.random() < 0.5:
                return pair
            return pair[1], pair[0], pair[3], pair[2]
    return pairs[-1][1]


async def _run_one(
    base_url: str, api_key: str, name_a: str, name_b: str,
    disp_a: str, disp_b: str, prompt: str, max_tokens: int,
    max_wall_s: int,
) -> tuple[str, str, bool]:
    """Generate responses for both models sequentially. Returns
    (response_a, response_b, ok). ok=False on timeout or exception."""

    async def _unload(name: str) -> None:
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post(f"{base_url}/v1/models/{name}/unload", headers=headers)
        except Exception:
            pass

    async def _gen(model_name: str) -> str:
        parts: list[str] = []
        msgs = [{"role": "user", "content": prompt}]
        async for chunk in arena.stream_to_omlx(
            model_name, msgs, base_url, api_key,
            temperature=0.7, max_tokens=max_tokens,
            warmup=False,  # we unload+reload between — warmup would double it
        ):
            if chunk.get("done"):
                break
            token = chunk.get("token", "")
            if token:
                parts.append(token)
        return "".join(parts)

    try:
        # A
        resp_a = await asyncio.wait_for(_gen(name_a), timeout=max_wall_s)
        await _unload(name_a)
        # B
        resp_b = await asyncio.wait_for(_gen(name_b), timeout=max_wall_s)
        await _unload(name_b)
        return resp_a, resp_b, True
    except asyncio.TimeoutError:
        log.warning("autobattle: timeout on pair %s vs %s", disp_a, disp_b)
        return "", "", False
    except Exception as e:
        log.warning("autobattle: error on pair %s vs %s: %s", disp_a, disp_b, e)
        return "", "", False


async def run_batch(
    job: AutobattleJob,
    registry,
    base_url: str,
    api_key: str,
    prompts: list[str],
    max_tokens: int,
    max_wall_s: int,
    judge_model_id: str | None = None,
) -> None:
    cancel_flag = _cancel_flags[job.id]
    eligible = _pick_eligible(registry)
    if len(eligible) < 2:
        job.status = "error"
        job.last_message = "Need at least 2 eligible MLX models"
        job.finished_at = time.time()
        return

    while job.completed + job.skipped < job.target:
        if cancel_flag.is_set():
            job.status = "cancelled"
            job.last_message = f"Cancelled after {job.completed} battles"
            job.finished_at = time.time()
            return
        pair = await _pick_pair(eligible)
        if not pair:
            job.status = "error"
            job.last_message = "Could not pick a pair"
            job.finished_at = time.time()
            return
        name_a, name_b, disp_a, disp_b = pair
        prompt = random.choice(prompts) if prompts else random.choice(DEFAULT_PROMPTS)
        # Anonymized — model names stay hidden until the user votes to preserve
        # the blind A/B property of the review queue.
        job.last_message = f"battle {job.completed + job.skipped + 1} of {job.target}"
        resp_a, resp_b, ok = await _run_one(
            base_url, api_key, name_a, name_b, disp_a, disp_b, prompt,
            max_tokens, max_wall_s,
        )
        if not ok:
            job.skipped += 1
            job.errors += 1
            continue
        # Optional judge verdict before persisting
        verdict = None
        if judge_model_id:
            try:
                verdict, reasoning = await judge_pair(
                    base_url, api_key, judge_model_id, prompt, resp_a, resp_b,
                )
                # Anonymized: include the verdict but not the model names so
                # the review queue stays blind.
                job.last_message = f"battle {job.completed + job.skipped + 1} · judge={verdict}"
            except Exception as e:
                log.warning("autobattle judge failed: %s", e)
                verdict = None

        battle_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        try:
            if verdict:
                # Judge voted — run the normal persist/ELO path so this battle
                # lands on the leaderboard alongside human-voted battles.
                battle = arena.BattleState(
                    id=battle_id, model_a=name_a, model_b=name_b,
                    model_a_display=disp_a, model_b_display=disp_b,
                    prompt=prompt, response_a=resp_a, response_b=resp_b,
                    winner=verdict,
                )
                await arena.persist_vote(battle)
            else:
                async with aiosqlite.connect(DB_PATH) as db:
                    await db.execute(
                        """INSERT INTO arena_battles
                           (id, model_a, model_b, prompt, response_a, response_b,
                            winner, elo_before_a, elo_before_b, elo_after_a,
                            elo_after_b, created_at)
                           VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?)""",
                        (battle_id, name_a, name_b, prompt, resp_a, resp_b, now),
                    )
                    await db.commit()
            job.completed += 1
        except Exception as e:
            log.warning("autobattle: DB persist failed: %s", e)
            job.errors += 1

    job.status = "done"
    job.last_message = f"Completed {job.completed} battles ({job.skipped} skipped)"
    job.finished_at = time.time()


def start_batch(
    target: int, registry, base_url: str, api_key: str,
    prompts: list[str] | None, max_tokens: int = 1536,
    max_wall_s: int = 240,
    judge_model_id: str | None = None,
) -> AutobattleJob:
    job_id = uuid.uuid4().hex[:12]
    job = AutobattleJob(id=job_id, target=max(1, target))
    _jobs[job_id] = job
    _cancel_flags[job_id] = asyncio.Event()
    asyncio.create_task(run_batch(
        job, registry, base_url, api_key, prompts or [], max_tokens, max_wall_s,
        judge_model_id=judge_model_id,
    ))
    return job


async def list_pending() -> list[dict]:
    """Battles with responses but no winner — awaiting human vote."""
    rows: list[dict] = []
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT id, model_a, model_b, prompt, response_a, response_b, created_at
               FROM arena_battles
               WHERE winner IS NULL AND response_a IS NOT NULL AND response_b IS NOT NULL
               ORDER BY created_at ASC"""
        ) as cur:
            async for row in cur:
                rows.append(dict(row))
    return rows
