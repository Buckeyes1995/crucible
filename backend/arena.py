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
class BattleSlot:
    """One contender in a battle. For N=2 the first two slots are aliased
    to BattleState.model_a / model_b so existing 2-slot code keeps working;
    slots[2..] are persisted separately via extra_slots_json."""
    name: str            # oMLX model name (dir basename)
    display: str         # human-readable name
    response: str = ""


@dataclass
class BattleState:
    id: str
    model_a: str  # oMLX model name (dir name) — mirror of slots[0].name
    model_b: str                              # mirror of slots[1].name
    model_a_display: str
    model_b_display: str
    prompt: str = ""
    response_a: str = ""                      # mirror of slots[0].response
    response_b: str = ""                      # mirror of slots[1].response
    winner: Optional[str] = None              # "model_a" | "model_b" | "slot_2"... | "tie"
    norm_mode: str = "uniform"                # "uniform" | "per_model"
    # Third+ slots for N>2 battles. Slot ids are "model_a", "model_b",
    # "slot_2", "slot_3", ... so vote payload can reference any slot uniformly.
    extra_slots: list[BattleSlot] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)

    @property
    def all_slots(self) -> list[BattleSlot]:
        """Unified view for streaming / ELO / UI. Mutations to the first two
        slots' responses go through here and are mirrored back to
        response_a/b at the end of the stream."""
        return [
            BattleSlot(self.model_a, self.model_a_display, self.response_a),
            BattleSlot(self.model_b, self.model_b_display, self.response_b),
            *self.extra_slots,
        ]


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
    slots = pick_models_n(registry, 2)
    return slots[0].name, slots[1].name, slots[0].display, slots[1].display


def pick_models_n(registry: ModelRegistry, n: int) -> list[BattleSlot]:
    """Pick N random MLX models for an N-slot battle."""
    if n < 2 or n > 4:
        raise ValueError(f"n must be 2-4, got {n}")
    eligible = [
        m for m in registry.all()
        if m.kind == "mlx"
        and m.node == "local"
        and not m.hidden
        and not m.name.endswith("-DFlash")
    ]
    if len(eligible) < n:
        raise ValueError(f"Need at least {n} eligible MLX models, found {len(eligible)}")
    picked = random.sample(eligible, n)
    return [
        BattleSlot(
            name=Path(m.path).name if m.path else m.name,
            display=m.name,
        )
        for m in picked
    ]


def create_battle(registry: ModelRegistry, n: int = 2) -> BattleState:
    _sweep_stale()
    slots = pick_models_n(registry, n)
    battle = BattleState(
        id=str(uuid.uuid4()),
        model_a=slots[0].name,
        model_b=slots[1].name,
        model_a_display=slots[0].display,
        model_b_display=slots[1].display,
        extra_slots=slots[2:],
    )
    _active_battles[battle.id] = battle
    return battle


def get_battle(battle_id: str) -> Optional[BattleState]:
    return _active_battles.get(battle_id)


async def _warmup(model_name: str, base_url: str, api_key: str,
                  client: httpx.AsyncClient) -> float:
    """Send a throwaway 1-token request to force model-load before we start the
    real TTFT clock. Returns the wall-clock seconds it took (useful for telemetry
    if the caller cares). Best-effort — on failure we just swallow and let the
    real request do the loading, accepting the inflated TTFT rather than crash."""
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    payload = {
        "model": model_name,
        "messages": [{"role": "user", "content": "hi"}],
        "temperature": 0.0,
        "max_tokens": 1,
        "stream": False,
    }
    t0 = time.monotonic()
    try:
        r = await client.post(f"{base_url}/v1/chat/completions",
                              json=payload, headers=headers, timeout=300.0)
        r.raise_for_status()
    except Exception:
        pass
    return time.monotonic() - t0


async def stream_to_omlx(
    model_name: str,
    messages: list[dict],
    base_url: str,
    api_key: str,
    temperature: float = 0.7,
    max_tokens: int = 1024,
    extra_params: dict | None = None,
    warmup: bool = True,
) -> AsyncGenerator[dict, None]:
    """Stream chat completion from oMLX for a specific model.

    `extra_params` is merged into the request body verbatim — used by diff/arena
    to forward per-model Crucible params (top_k, top_p, chat_template_kwargs, etc).

    `warmup` — when true (default), fires a throwaway 1-token request first so
    the reported TTFT reflects actual first-token latency rather than cold model-
    load time. We emit the warmup duration as `load_ms` on the final done chunk
    so callers can still see it if they want.
    """
    payload = {
        "model": model_name,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    if extra_params:
        for k, v in extra_params.items():
            if v is not None:
                payload[k] = v
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}

    load_ms: float | None = None
    async with httpx.AsyncClient(timeout=300.0) as client:
        if warmup:
            load_ms = round((await _warmup(model_name, base_url, api_key, client)) * 1000, 2)

        t0 = time.monotonic()
        first_token_time = None
        total_tokens = 0

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
                    content = delta.get("content") or delta.get("reasoning_content") or delta.get("reasoning") or ""
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

    yield {"token": "", "done": True, "tps": tps, "ttft_ms": ttft_ms,
           "output_tokens": total_tokens, "load_ms": load_ms}


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


def slot_id_at(i: int) -> str:
    return {0: "model_a", 1: "model_b"}.get(i, f"slot_{i}")


def slot_index_from_id(slot_id: str) -> Optional[int]:
    if slot_id == "model_a":
        return 0
    if slot_id == "model_b":
        return 1
    if slot_id.startswith("slot_"):
        try:
            return int(slot_id.split("_", 1)[1])
        except ValueError:
            return None
    return None


async def persist_vote(battle: BattleState) -> dict:
    """Save battle result and update ELO. For N-slot battles, ELO updates
    run as pairwise matches: winner beats each other slot. Ties split all
    pairs equally.

    Keeps the 2-slot arena_battles schema intact; slots >=2 are persisted
    as JSON in extra_slots_json and joined in at leaderboard/review read time.
    """
    now = datetime.now(timezone.utc).isoformat()
    slots = battle.all_slots
    n = len(slots)
    slot_ids = [slot_id_at(i) for i in range(n)]
    winner = battle.winner or "tie"
    winner_idx = slot_index_from_id(winner) if winner != "tie" else None

    async with aiosqlite.connect(DB_PATH) as db:
        # Seed ELO rows for any new participants.
        for s in slots:
            await db.execute(
                "INSERT OR IGNORE INTO arena_elo (model_id, elo) VALUES (?, ?)",
                (s.name, START_ELO),
            )
        await db.commit()

        # Snapshot current ELO per slot.
        elos: list[float] = []
        for s in slots:
            async with db.execute(
                "SELECT elo FROM arena_elo WHERE model_id = ?", (s.name,),
            ) as cur:
                row = await cur.fetchone()
                elos.append(row[0] if row else START_ELO)

        # Pairwise ELO: each slot's delta is the sum over all other slots of
        # its (winner|loser|tie) update against that opponent. Using pairwise
        # sums keeps the 2-slot case identical to the old single-match math.
        deltas = [0.0] * n
        wins = [0] * n
        losses = [0] * n
        ties = [0] * n
        for i in range(n):
            for j in range(i + 1, n):
                if winner == "tie" or winner_idx is None:
                    outcome_ij = "tie"
                    ties[i] += 1
                    ties[j] += 1
                elif winner_idx == i:
                    outcome_ij = "model_a"  # i beats j
                    wins[i] += 1
                    losses[j] += 1
                elif winner_idx == j:
                    outcome_ij = "model_b"  # j beats i
                    wins[j] += 1
                    losses[i] += 1
                else:
                    # Neither i nor j is the winner — treat as a tie between
                    # these two (both lost to someone else equally).
                    outcome_ij = "tie"
                    ties[i] += 1
                    ties[j] += 1
                new_i, new_j = compute_elo(elos[i], elos[j], outcome_ij)
                deltas[i] += new_i - elos[i]
                deltas[j] += new_j - elos[j]

        new_elos = [round(elos[i] + deltas[i], 1) for i in range(n)]

        # Insert battle record — keep columns a/b populated from slots[0/1].
        extra_json = None
        if n > 2:
            extra_json = json.dumps([
                {"slot_id": slot_ids[i], "name": slots[i].name,
                 "display": slots[i].display, "response": slots[i].response,
                 "elo_before": elos[i], "elo_after": new_elos[i]}
                for i in range(2, n)
            ])
        await db.execute(
            """INSERT INTO arena_battles
               (id, model_a, model_b, prompt, response_a, response_b, winner,
                elo_before_a, elo_before_b, elo_after_a, elo_after_b, created_at,
                norm_mode, extra_slots_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (battle.id, slots[0].name, slots[1].name, battle.prompt,
             slots[0].response, slots[1].response, battle.winner,
             elos[0], elos[1], new_elos[0], new_elos[1], now,
             battle.norm_mode, extra_json),
        )

        # Apply ELO updates.
        for i in range(n):
            await db.execute(
                """UPDATE arena_elo SET elo = ?, wins = wins + ?, losses = losses + ?,
                   ties = ties + ?, battles = battles + 1, last_battle_at = ?
                   WHERE model_id = ?""",
                (new_elos[i], wins[i], losses[i], ties[i], now, slots[i].name),
            )

        await db.commit()

    _active_battles.pop(battle.id, None)

    return {
        "winner": battle.winner,
        "slots": [
            {"slot_id": slot_ids[i], "display": slots[i].display,
             "elo_before": elos[i], "elo_after": new_elos[i]}
            for i in range(n)
        ],
        # Back-compat keys for 2-slot UIs.
        "model_a": slots[0].display,
        "model_b": slots[1].display,
        "elo_before": {"a": elos[0], "b": elos[1]},
        "elo_after": {"a": new_elos[0], "b": new_elos[1]},
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
