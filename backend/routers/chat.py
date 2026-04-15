import asyncio
import json
import time
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse

from models.schemas import ChatRequest, ChatMessage
from pydantic import BaseModel
import rag

router = APIRouter()


async def _record_chat_profile(adapter, output_tokens, total_ms, ttft_ms, tps):
    """Record inference profile in background."""
    from profiler import record_profile
    from benchmark.metrics import get_memory_pressure
    model_id = adapter.model_id or "unknown"
    model_name = model_id.split(":")[-1] if ":" in model_id else model_id
    dflash = False  # Chat doesn't know DFlash state; profiler page can filter
    try:
        mem = get_memory_pressure()
    except Exception:
        mem = None
    await record_profile(
        model_id=model_id,
        model_name=model_name,
        output_tokens=output_tokens,
        total_ms=total_ms,
        ttft_ms=ttft_ms,
        tps=tps,
        memory_start=mem,
        source="chat",
    )


@router.post("/chat")
async def chat(req: ChatRequest, request: Request) -> StreamingResponse:
    adapter = request.app.state.active_adapter
    if not adapter or not adapter.is_loaded():
        raise HTTPException(status_code=400, detail="No model loaded")

    # Reset TTL idle timer on every chat request
    record = getattr(request.app.state, "record_activity", None)
    if record:
        record()

    # Inject RAG context into the last user message if a session is active
    messages = list(req.messages)
    if req.rag_session_id:
        last_user = next((m for m in reversed(messages) if m.role == "user"), None)
        if last_user:
            ctx = rag.get_context(req.rag_session_id, last_user.content)
            if ctx:
                # Prepend context as a system message
                messages = [ChatMessage(role="system", content=ctx)] + [
                    m for m in messages if m.role != "system"
                ]

    async def _stream():
        t_start = time.monotonic()
        t_first: float | None = None
        token_count = 0
        _last_tps_update = 0.0

        async for chunk in adapter.chat(messages, req.temperature, req.max_tokens):
            if chunk.get("done"):
                elapsed = time.monotonic() - t_start
                ttft = (t_first - t_start) * 1000 if t_first else None
                gen_time = elapsed - ((t_first - t_start) if t_first else elapsed)
                tps = token_count / gen_time if gen_time > 0 and token_count > 0 else None
                # Update adapter attributes so Live Metrics WebSocket picks them up
                if ttft is not None:
                    adapter.last_ttft_ms = round(ttft, 2)
                if tps is not None:
                    adapter.last_tps = round(tps, 2)
                yield f"data: {json.dumps({'event': 'done', 'ttft_ms': round(ttft, 2) if ttft else None, 'tps': round(tps, 2) if tps else None, 'output_tokens': token_count})}\n\n"
                # Record inference profile
                asyncio.create_task(_record_chat_profile(
                    adapter, token_count, elapsed * 1000, ttft, tps,
                ))
                break

            token = chunk.get("token", "")
            if not token:
                continue
            now = time.monotonic()
            if t_first is None:
                t_first = now
                adapter.last_ttft_ms = round((now - t_start) * 1000, 2)
            token_count += 1
            # Update rolling live TPS every ~0.5s so metrics WS sees it during streaming
            if now - _last_tps_update >= 0.5:
                gen_time = now - t_first
                if gen_time > 0:
                    adapter.last_tps = round(token_count / gen_time, 2)
                _last_tps_update = now
            yield f"data: {json.dumps({'event': 'token', 'token': token})}\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream")


class CompareRequest(BaseModel):
    messages: list[ChatMessage]
    temperature: float = 0.7
    max_tokens: int = 1024


@router.post("/chat/compare")
async def chat_compare(req: CompareRequest, request: Request) -> StreamingResponse:
    adapter_a = request.app.state.active_adapter
    adapter_b = request.app.state.compare_adapter

    if not adapter_a or not adapter_a.is_loaded():
        raise HTTPException(status_code=400, detail="No primary model loaded (slot A)")
    if not adapter_b or not adapter_b.is_loaded():
        raise HTTPException(status_code=400, detail="No comparison model loaded (slot B)")

    queue: asyncio.Queue[dict | None] = asyncio.Queue()

    async def _stream_slot(adapter, slot: str) -> None:
        t_start = time.monotonic()
        t_first: float | None = None
        token_count = 0
        try:
            async for chunk in adapter.chat(req.messages, req.temperature, req.max_tokens):
                if chunk.get("done"):
                    ttft = (t_first - t_start) * 1000 if t_first else None
                    gen_end = time.monotonic()
                    gen_time = (gen_end - t_first) if t_first else (gen_end - t_start)
                    tps = token_count / gen_time if gen_time > 0 and token_count > 0 else None
                    await queue.put({
                        "event": "done", "slot": slot,
                        "ttft_ms": round(ttft, 2) if ttft else None,
                        "tps": round(tps, 2) if tps else None,
                        "output_tokens": token_count,
                    })
                    return
                token = chunk.get("token", "")
                if not token:
                    continue
                if t_first is None:
                    t_first = time.monotonic()
                token_count += 1
                await queue.put({"event": "token", "slot": slot, "token": token})
        except Exception as e:
            await queue.put({"event": "error", "slot": slot, "message": str(e)})

    async def _merged_stream():
        tasks = [
            asyncio.create_task(_stream_slot(adapter_a, "a")),
            asyncio.create_task(_stream_slot(adapter_b, "b")),
        ]
        finished = 0
        while finished < 2:
            item = await queue.get()
            yield f"data: {json.dumps(item)}\n\n"
            if item["event"] in ("done", "error"):
                finished += 1
        yield f"data: {json.dumps({'event': 'complete'})}\n\n"
        # Cancel any remaining tasks
        for t in tasks:
            t.cancel()

    return StreamingResponse(
        _merged_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
