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
    max_tokens: int = 1024


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

    queue: asyncio.Queue[dict | None] = asyncio.Queue()

    async def _stream_slot(model_name: str, slot: str):
        tokens = []
        try:
            async for chunk in arena.stream_to_omlx(
                model_name, messages, base_url, api_key,
                body.temperature, body.max_tokens,
            ):
                if chunk.get("done"):
                    await queue.put({
                        "event": "done", "slot": slot,
                        "tps": chunk.get("tps"),
                        "ttft_ms": chunk.get("ttft_ms"),
                        "output_tokens": chunk.get("output_tokens"),
                    })
                    return
                token = chunk.get("token", "")
                if token:
                    tokens.append(token)
                    await queue.put({"event": "token", "slot": slot, "token": token})
        except Exception as e:
            await queue.put({"event": "error", "slot": slot, "message": str(e)})
        finally:
            # Store accumulated response
            text = "".join(tokens)
            if slot == "a":
                battle.response_a = text
            else:
                battle.response_b = text

    async def _merged():
        tasks = [
            asyncio.create_task(_stream_slot(battle.model_a, "a")),
            asyncio.create_task(_stream_slot(battle.model_b, "b")),
        ]
        finished = 0
        while finished < 2:
            item = await queue.get()
            yield f"data: {json.dumps(item)}\n\n"
            if item.get("event") in ("done", "error"):
                finished += 1
        yield f"data: {json.dumps({'event': 'complete'})}\n\n"
        for t in tasks:
            t.cancel()

    return StreamingResponse(
        _merged(),
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
