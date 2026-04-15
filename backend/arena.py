"""Model Arena — blind A/B testing with ELO ratings."""

import asyncio
import json
import logging
import random
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncGenerator, Optional

import httpx
import aiosqlite

from db.database import DB_PATH
from registry import ModelRegistry

log = logging.getLogger(__name__)

K_FACTOR = 32
START_ELO = 1500.0


@dataclass
class BattleState:
    id: str
    model_a: str  # oMLX model name (dir name)
    model_b: str
    model_a_display: str  # human-readable name
    model_b_display: str
    prompt: str = ""
    response_a: str = ""
    response_b: str = ""
    winner: Optional[str] = None
    created_at: float = field(default_factory=time.time)


# In-memory active battles
_active_battles: dict[str, BattleState] = {}
_BATTLE_TTL = 1800  # 30 minutes


def _sweep_stale():
    cutoff = time.time() - _BATTLE_TTL
    stale = [k for k, v in _active_battles.items() if v.created_at < cutoff]
    for k in stale:
        del _active_battles[k]


def pick_models(registry: ModelRegistry) -> tuple[str, str, str, str]:
    """Pick 2 random MLX models. Returns (name_a, name_b, display_a, display_b)."""
    eligible = [
        m for m in registry.all()
        if m.kind == "mlx"
        and m.node == "local"
        and not m.hidden
        and not m.name.endswith("-DFlash")
    ]
    if len(eligible) < 2:
        raise ValueError(f"Need at least 2 eligible MLX models, found {len(eligible)}")
    a, b = random.sample(eligible, 2)
    return (
        Path(a.path).name if a.path else a.name,
        Path(b.path).name if b.path else b.name,
        a.name,
        b.name,
    )


def create_battle(registry: ModelRegistry) -> BattleState:
    _sweep_stale()
    name_a, name_b, disp_a, disp_b = pick_models(registry)
    battle = BattleState(
        id=str(uuid.uuid4()),
        model_a=name_a,
        model_b=name_b,
        model_a_display=disp_a,
        model_b_display=disp_b,
    )
    _active_battles[battle.id] = battle
    return battle


def get_battle(battle_id: str) -> Optional[BattleState]:
    return _active_battles.get(battle_id)


async def stream_to_omlx(
    model_name: str,
    messages: list[dict],
    base_url: str,
    api_key: str,
    temperature: float = 0.7,
    max_tokens: int = 1024,
) -> AsyncGenerator[dict, None]:
    """Stream chat completion from oMLX for a specific model."""
    payload = {
        "model": model_name,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    t0 = time.monotonic()
    first_token_time = None
    total_tokens = 0

    async with httpx.AsyncClient(timeout=300.0) as client:
        async with client.stream(
            "POST",
            f"{base_url}/v1/chat/completions",
            json=payload,
            headers=headers,
        ) as resp:
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                chunk = line[6:]
                if chunk.strip() == "[DONE]":
                    break
                try:
                    data = json.loads(chunk)
                    delta = data["choices"][0]["delta"]
                    content = delta.get("content") or delta.get("reasoning") or ""
                    if content:
                        if first_token_time is None:
                            first_token_time = time.monotonic()
                        total_tokens += 1
                        yield {"token": content, "done": False}
                except Exception:
                    continue

    t1 = time.monotonic()
    ttft_ms = round((first_token_time - t0) * 1000, 2) if first_token_time else None
    gen_time = (t1 - first_token_time) if first_token_time else (t1 - t0)
    tps = round(total_tokens / gen_time, 2) if gen_time > 0 and total_tokens > 0 else None

    yield {"token": "", "done": True, "tps": tps, "ttft_ms": ttft_ms, "output_tokens": total_tokens}


def compute_elo(elo_a: float, elo_b: float, outcome: str) -> tuple[float, float]:
    """Standard ELO calculation. Returns (new_elo_a, new_elo_b)."""
    ea = 1.0 / (1.0 + 10 ** ((elo_b - elo_a) / 400))
    eb = 1.0 - ea

    if outcome == "model_a":
        sa, sb = 1.0, 0.0
    elif outcome == "model_b":
        sa, sb = 0.0, 1.0
    else:  # tie
        sa, sb = 0.5, 0.5

    new_a = elo_a + K_FACTOR * (sa - ea)
    new_b = elo_b + K_FACTOR * (sb - eb)
    return round(new_a, 1), round(new_b, 1)


async def persist_vote(battle: BattleState) -> dict:
    """Save battle result and update ELO. Returns elo_before/after."""
    now = datetime.now(timezone.utc).isoformat()

    async with aiosqlite.connect(DB_PATH) as db:
        # Get current ELO for both models
        elo_a, elo_b = START_ELO, START_ELO
        for model_id in (battle.model_a, battle.model_b):
            await db.execute(
                "INSERT OR IGNORE INTO arena_elo (model_id, elo) VALUES (?, ?)",
                (model_id, START_ELO),
            )
        await db.commit()

        async with db.execute("SELECT elo FROM arena_elo WHERE model_id = ?", (battle.model_a,)) as cur:
            row = await cur.fetchone()
            if row:
                elo_a = row[0]
        async with db.execute("SELECT elo FROM arena_elo WHERE model_id = ?", (battle.model_b,)) as cur:
            row = await cur.fetchone()
            if row:
                elo_b = row[0]

        new_a, new_b = compute_elo(elo_a, elo_b, battle.winner)

        # Insert battle record
        await db.execute(
            """INSERT INTO arena_battles
               (id, model_a, model_b, prompt, response_a, response_b, winner,
                elo_before_a, elo_before_b, elo_after_a, elo_after_b, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (battle.id, battle.model_a, battle.model_b, battle.prompt,
             battle.response_a, battle.response_b, battle.winner,
             elo_a, elo_b, new_a, new_b, now),
        )

        # Update ELO for model A
        win_a = 1 if battle.winner == "model_a" else 0
        loss_a = 1 if battle.winner == "model_b" else 0
        tie_a = 1 if battle.winner == "tie" else 0
        await db.execute(
            """UPDATE arena_elo SET elo = ?, wins = wins + ?, losses = losses + ?,
               ties = ties + ?, battles = battles + 1, last_battle_at = ?
               WHERE model_id = ?""",
            (new_a, win_a, loss_a, tie_a, now, battle.model_a),
        )

        # Update ELO for model B
        win_b = 1 if battle.winner == "model_b" else 0
        loss_b = 1 if battle.winner == "model_a" else 0
        await db.execute(
            """UPDATE arena_elo SET elo = ?, wins = wins + ?, losses = losses + ?,
               ties = ties + ?, battles = battles + 1, last_battle_at = ?
               WHERE model_id = ?""",
            (new_b, win_b, loss_b, tie_a, now, battle.model_b),
        )

        await db.commit()

    # Remove from active battles
    _active_battles.pop(battle.id, None)

    return {
        "model_a": battle.model_a_display,
        "model_b": battle.model_b_display,
        "winner": battle.winner,
        "elo_before": {"a": elo_a, "b": elo_b},
        "elo_after": {"a": new_a, "b": new_b},
    }


async def get_leaderboard() -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM arena_elo ORDER BY elo DESC"
        ) as cur:
            rows = []
            async for row in cur:
                battles = row["battles"]
                wins = row["wins"]
                rows.append({
                    "model_id": row["model_id"],
                    "elo": round(row["elo"], 1),
                    "wins": wins,
                    "losses": row["losses"],
                    "ties": row["ties"],
                    "battles": battles,
                    "win_rate": round(wins / battles * 100, 1) if battles > 0 else 0,
                })
            return rows


async def get_history(limit: int = 50) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM arena_battles ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ) as cur:
            return [
                {
                    "id": row["id"],
                    "model_a": row["model_a"],
                    "model_b": row["model_b"],
                    "prompt": row["prompt"][:200],
                    "winner": row["winner"],
                    "elo_before_a": row["elo_before_a"],
                    "elo_before_b": row["elo_before_b"],
                    "elo_after_a": row["elo_after_a"],
                    "elo_after_b": row["elo_after_b"],
                    "created_at": row["created_at"],
                }
                async for row in cur
            ]
