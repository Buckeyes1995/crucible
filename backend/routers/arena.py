"""Arena router — blind A/B model battles with ELO rankings."""

import asyncio
import json
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import arena

router = APIRouter()


@router.post("/arena/battle")
async def start_battle(request: Request) -> dict:
    registry = request.app.state.registry
    try:
        battle = arena.create_battle(registry)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"battle_id": battle.id, "status": "ready"}


class ChatRequest(BaseModel):
    prompt: str
    temperature: float = 0.7
    max_tokens: int = 4096


@router.post("/arena/battle/{battle_id}/chat")
async def battle_chat(battle_id: str, body: ChatRequest, request: Request) -> StreamingResponse:
    battle = arena.get_battle(battle_id)
    if not battle:
        raise HTTPException(404, "Battle not found")
    if battle.winner:
        raise HTTPException(400, "Battle already voted on")

    battle.prompt = body.prompt
    cfg = request.app.state.config
    base_url = cfg.mlx_external_url or "http://127.0.0.1:8000"
    api_key = cfg.omlx_api_key
    messages = [{"role": "user", "content": body.prompt}]

    async def _stream_slot(model_name: str, slot: str):
        """Generator that yields SSE events for one slot and records the
        accumulated text on the battle state at the end."""
        tokens: list[str] = []
        try:
            yield {"event": "slot_start", "slot": slot}
            async for chunk in arena.stream_to_omlx(
                model_name, messages, base_url, api_key,
                body.temperature, body.max_tokens,
            ):
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
                    tokens.append(token)
                    yield {"event": "token", "slot": slot, "token": token}
        except asyncio.CancelledError:
            yield {"event": "cancelled", "slot": slot}
            raise
        except Exception as e:
            yield {"event": "error", "slot": slot, "message": str(e)}
        finally:
            text = "".join(tokens)
            if slot == "a":
                battle.response_a = text
            else:
                battle.response_b = text

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
        """Drive slots one after the other. We explicitly unload slot A before
        starting slot B so oMLX doesn't end up with both models resident (which
        it happily does with v0.10.0's engine pool). Aborts propagate through
        CancelledError; we also unload on error / cancel to keep the server
        tidy between battles."""
        completed_slots: list[str] = []
        try:
            async for evt in _stream_slot(battle.model_a, "a"):
                yield f"data: {json.dumps(evt)}\n\n"
            completed_slots.append(battle.model_a)
            await _unload(battle.model_a)
            async for evt in _stream_slot(battle.model_b, "b"):
                yield f"data: {json.dumps(evt)}\n\n"
            completed_slots.append(battle.model_b)
            yield f"data: {json.dumps({'event': 'complete'})}\n\n"
        except asyncio.CancelledError:
            yield f"data: {json.dumps({'event': 'complete', 'cancelled': True})}\n\n"
            raise
        finally:
            # Don't leave the losing side (or a cancelled half-run) parked in
            # memory either — unload everything we touched.
            for name in (battle.model_a, battle.model_b):
                if name not in completed_slots:
                    continue
            # unload both unconditionally; the helper is idempotent + silent
            for name in {battle.model_a, battle.model_b}:
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
    winner: str  # "model_a", "model_b", or "tie"


@router.post("/arena/battle/{battle_id}/vote")
async def vote(battle_id: str, body: VoteRequest) -> dict:
    if body.winner not in ("model_a", "model_b", "tie"):
        raise HTTPException(400, "winner must be 'model_a', 'model_b', or 'tie'")
    battle = arena.get_battle(battle_id)
    if not battle:
        raise HTTPException(404, "Battle not found")
    if battle.winner:
        raise HTTPException(400, "Already voted")
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
