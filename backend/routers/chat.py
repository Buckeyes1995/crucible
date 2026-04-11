import json
import time
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse

from models.schemas import ChatRequest

router = APIRouter()


@router.post("/chat")
async def chat(req: ChatRequest, request: Request) -> StreamingResponse:
    adapter = request.app.state.active_adapter
    if not adapter or not adapter.is_loaded():
        raise HTTPException(status_code=400, detail="No model loaded")

    # Reset TTL idle timer on every chat request
    record = getattr(request.app.state, "record_activity", None)
    if record:
        record()

    async def _stream():
        t_start = time.monotonic()
        t_first: float | None = None
        token_count = 0

        async for chunk in adapter.chat(req.messages, req.temperature, req.max_tokens):
            if chunk.get("done"):
                elapsed = time.monotonic() - t_start
                ttft = (t_first - t_start) * 1000 if t_first else None
                gen_time = elapsed - ((t_first - t_start) if t_first else elapsed)
                tps = token_count / gen_time if gen_time > 0 and token_count > 0 else None
                yield f"data: {json.dumps({'event': 'done', 'ttft_ms': round(ttft, 2) if ttft else None, 'tps': round(tps, 2) if tps else None, 'output_tokens': token_count})}\n\n"
                break

            token = chunk.get("token", "")
            if not token:
                continue
            if t_first is None:
                t_first = time.monotonic()
            token_count += 1
            yield f"data: {json.dumps({'event': 'token', 'token': token})}\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream")
