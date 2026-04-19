"""Arena router — blind A/B model battles with ELO rankings."""

import asyncio
import json
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import arena

router = APIRouter()


class StartBattleRequest(BaseModel):
    n: int = 2  # number of slots (2-4)


@router.post("/arena/battle")
async def start_battle(request: Request,
                       body: StartBattleRequest | None = None) -> dict:
    registry = request.app.state.registry
    n = (body.n if body else 2)
    try:
        battle = arena.create_battle(registry, n=n)
    except ValueError as e:
        raise HTTPException(400, str(e))
    slots = battle.all_slots
    return {
        "battle_id": battle.id,
        "status": "ready",
        "n": len(slots),
        "slots": [
            {"slot_id": arena.slot_id_at(i), "display": s.display}
            for i, s in enumerate(slots)
        ],
    }


class ChatRequest(BaseModel):
    prompt: str
    temperature: float = 0.7
    max_tokens: int = 4096
    # "uniform"  — fair comparison: thinking disabled, baseline sampling
    # "per_model" — each model runs with its own saved params
    norm_mode: str = "uniform"


@router.post("/arena/battle/{battle_id}/chat")
async def battle_chat(battle_id: str, body: ChatRequest, request: Request) -> StreamingResponse:
    battle = arena.get_battle(battle_id)
    if not battle:
        raise HTTPException(404, "Battle not found")
    if battle.winner:
        raise HTTPException(400, "Battle already voted on")

    if body.norm_mode not in ("uniform", "per_model"):
        raise HTTPException(400, "norm_mode must be 'uniform' or 'per_model'")

    battle.prompt = body.prompt
    battle.norm_mode = body.norm_mode
    cfg = request.app.state.config
    base_url = cfg.mlx_external_url or "http://127.0.0.1:8000"
    api_key = cfg.omlx_api_key
    messages = [{"role": "user", "content": body.prompt}]

    # Under "uniform" mode, disable thinking on both slots and pin sampling
    # to an equal baseline. Under "per_model", pass None so the adapter
    # uses each model's saved params unchanged.
    extra_params: dict | None = (
        {"chat_template_kwargs": {"enable_thinking": False},
         "top_p": 0.9, "top_k": 40}
        if body.norm_mode == "uniform" else None
    )

    async def _stream_slot(model_name: str, slot: str):
        """Yield SSE events for one slot. Emits periodic heartbeats (every
        HEARTBEAT_S) while the slot is cold-loading so client-side readers
        don't time out during oMLX's warmup + weight-load window (can be
        30-60s for large models)."""
        HEARTBEAT_S = 5.0
        tokens: list[str] = []
        first_token_seen = False

        # Drive arena.stream_to_omlx as a queue consumer so we can interleave
        # heartbeats during long silences.
        chunk_queue: asyncio.Queue = asyncio.Queue()

        async def _consume():
            try:
                async for chunk in arena.stream_to_omlx(
                    model_name, messages, base_url, api_key,
                    body.temperature, body.max_tokens,
                    extra_params=extra_params,
                ):
                    await chunk_queue.put(chunk)
            except Exception as e:
                await chunk_queue.put({"_error": str(e)})
            finally:
                await chunk_queue.put(None)

        consumer = asyncio.create_task(_consume())

        try:
            yield {"event": "slot_start", "slot": slot}
            while True:
                try:
                    chunk = await asyncio.wait_for(chunk_queue.get(), timeout=HEARTBEAT_S)
                except asyncio.TimeoutError:
                    # Silent window — let the client know we're still alive.
                    yield {"event": "heartbeat", "slot": slot,
                           "phase": "generating" if first_token_seen else "loading"}
                    continue
                if chunk is None:
                    break
                if chunk.get("_error"):
                    yield {"event": "error", "slot": slot, "message": chunk["_error"]}
                    return
                if chunk.get("done"):
                    yield {
                        "event": "done", "slot": slot,
                        "tps": chunk.get("tps"),
                        "ttft_ms": chunk.get("ttft_ms"),
                        "load_ms": chunk.get("load_ms"),
                        "output_tokens": chunk.get("output_tokens"),
                    }
                    return
                token = chunk.get("token", "")
                if token:
                    first_token_seen = True
                    tokens.append(token)
                    yield {"event": "token", "slot": slot, "token": token}
        except asyncio.CancelledError:
            consumer.cancel()
            yield {"event": "cancelled", "slot": slot}
            raise
        except Exception as e:
            yield {"event": "error", "slot": slot, "message": str(e)}
        finally:
            if not consumer.done():
                consumer.cancel()
            text = "".join(tokens)
            # slot is now the canonical slot id: "model_a", "model_b", "slot_2"...
            if slot == "model_a":
                battle.response_a = text
            elif slot == "model_b":
                battle.response_b = text
            else:
                idx = arena.slot_index_from_id(slot)
                if idx is not None and idx >= 2:
                    extra_idx = idx - 2
                    if 0 <= extra_idx < len(battle.extra_slots):
                        battle.extra_slots[extra_idx].response = text

    async def _unload(model_name: str) -> None:
        """Best-effort force-unload on oMLX. Matches the pattern used by diff —
        oMLX v0.10.0's engine pool keeps multiple models loaded otherwise, so
        between serial slots we explicitly evict the previous one. Silent on
        failure; worst case is just memory pressure."""
        import httpx
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post(f"{base_url}/v1/models/{model_name}/unload",
                                  headers=headers)
        except Exception:
            pass

    async def _sequential():
        """Drive slots one after the other. Unload each before starting the
        next so oMLX doesn't hold multiple resident. Generalized for N slots.
        On error/cancel we only unload models we actually touched — avoids
        noisy 400s on models that were never loaded."""
        touched: set[str] = set()
        already_unloaded: set[str] = set()
        slots = battle.all_slots
        try:
            for i, s in enumerate(slots):
                touched.add(s.name)
                slot_id = arena.slot_id_at(i)
                async for evt in _stream_slot(s.name, slot_id):
                    yield f"data: {json.dumps(evt)}\n\n"
                if i < len(slots) - 1:
                    await _unload(s.name)
                    already_unloaded.add(s.name)
            yield f"data: {json.dumps({'event': 'complete'})}\n\n"
        except asyncio.CancelledError:
            yield f"data: {json.dumps({'event': 'complete', 'cancelled': True})}\n\n"
            raise
        finally:
            for name in touched:
                if name in already_unloaded:
                    continue
                try:
                    await _unload(name)
                except Exception:
                    pass

    return StreamingResponse(
        _sequential(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class VoteRequest(BaseModel):
    winner: str  # "model_a" | "model_b" | "slot_N" | "tie"


def _validate_winner(winner: str, slot_count: int) -> None:
    if winner == "tie":
        return
    idx = arena.slot_index_from_id(winner)
    if idx is None or idx < 0 or idx >= slot_count:
        raise HTTPException(400,
            f"winner must be 'tie' or a valid slot id for an {slot_count}-slot battle")


@router.post("/arena/battle/{battle_id}/vote")
async def vote(battle_id: str, body: VoteRequest) -> dict:
    battle = arena.get_battle(battle_id)
    if not battle:
        raise HTTPException(404, "Battle not found")
    if battle.winner:
        raise HTTPException(400, "Already voted")
    _validate_winner(body.winner, len(battle.all_slots))
    battle.winner = body.winner
    return await arena.persist_vote(battle)


@router.get("/arena/leaderboard")
async def leaderboard() -> list[dict]:
    return await arena.get_leaderboard()


@router.get("/arena/history")
async def history(limit: int = 50) -> list[dict]:
    return await arena.get_history(limit)


# ─── Autobattle: queue N overnight battles for later review ──────────────────

class AutobattleRequest(BaseModel):
    count: int = 20
    prompts: list[str] | None = None   # if None, use built-in defaults
    max_tokens: int = 1536
    max_wall_s_per_battle: int = 240   # per-slot timeout
    judge_model_id: str | None = None  # when set, judge auto-votes each battle


@router.post("/arena/autobattle")
async def start_autobattle(body: AutobattleRequest, request: Request) -> dict:
    import arena_autobattle as ab
    cfg = request.app.state.config
    base_url = cfg.mlx_external_url or "http://127.0.0.1:8000"
    api_key = cfg.omlx_api_key
    job = ab.start_batch(
        body.count,
        request.app.state.registry,
        base_url, api_key,
        body.prompts,
        body.max_tokens,
        body.max_wall_s_per_battle,
        judge_model_id=body.judge_model_id,
    )
    return {"job_id": job.id, "target": job.target, "judge_model_id": body.judge_model_id}


@router.get("/arena/autobattle")
async def list_autobattle_jobs() -> list[dict]:
    import arena_autobattle as ab
    return ab.list_jobs()


@router.get("/arena/autobattle/{job_id}")
async def autobattle_status(job_id: str) -> dict:
    import arena_autobattle as ab
    j = ab.get_job(job_id)
    if not j:
        raise HTTPException(404, f"Autobattle job not found: {job_id}")
    return {
        "id": j.id, "target": j.target, "completed": j.completed,
        "skipped": j.skipped, "errors": j.errors, "status": j.status,
        "started_at": j.started_at, "finished_at": j.finished_at,
        "last_message": j.last_message,
    }


@router.delete("/arena/autobattle/{job_id}")
async def cancel_autobattle(job_id: str) -> dict:
    import arena_autobattle as ab
    ok = ab.cancel(job_id)
    if not ok:
        raise HTTPException(404, f"Autobattle job not found or already finished: {job_id}")
    return {"status": "cancelling"}


@router.get("/arena/pending")
async def pending() -> list[dict]:
    """Battles waiting for a human vote. Fed into the /arena/review UI."""
    import arena_autobattle as ab
    return await ab.list_pending()


class PendingVoteRequest(BaseModel):
    winner: str  # "model_a" | "model_b" | "tie"


@router.post("/arena/pending/{battle_id}/vote")
async def vote_pending(battle_id: str, body: PendingVoteRequest, request: Request) -> dict:
    """Apply a vote to a pending (autobattle-generated) battle. Fetches the
    stored responses, hydrates a BattleState, then runs the regular ELO/persist
    path so the result lands on the leaderboard the same way a live battle
    would."""
    if body.winner not in ("model_a", "model_b", "tie"):
        raise HTTPException(400, "winner must be 'model_a', 'model_b', or 'tie'")
    import aiosqlite
    from db.database import DB_PATH
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM arena_battles WHERE id = ? AND winner IS NULL", (battle_id,),
        ) as cur:
            row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "Pending battle not found or already voted")
        # Remove the skeleton row; persist_vote will re-INSERT with full data.
        await db.execute("DELETE FROM arena_battles WHERE id = ?", (battle_id,))
        await db.commit()
    # Build a BattleState and run the normal persist/ELO path
    battle = arena.BattleState(
        id=row["id"],
        model_a=row["model_a"],
        model_b=row["model_b"],
        model_a_display=row["model_a"],
        model_b_display=row["model_b"],
        prompt=row["prompt"] or "",
        response_a=row["response_a"] or "",
        response_b=row["response_b"] or "",
        winner=body.winner,
    )
    result = await arena.persist_vote(battle)
    return result
