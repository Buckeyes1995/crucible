"""Model Diff — run same prompt through multiple models and compare outputs."""

import asyncio
import json
import time
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from arena import stream_to_omlx

router = APIRouter()


class DiffRequest(BaseModel):
    model_ids: list[str]
    prompt: str
    temperature: float = 0.7
    max_tokens: int = 1024


@router.post("/diff/run")
async def run_diff(body: DiffRequest, request: Request) -> StreamingResponse:
    if len(body.model_ids) < 2:
        raise HTTPException(400, "Need at least 2 models")
    if len(body.model_ids) > 6:
        raise HTTPException(400, "Max 6 models")

    registry = request.app.state.registry
    cfg = request.app.state.config
    base_url = cfg.mlx_external_url or "http://127.0.0.1:8000"
    api_key = cfg.omlx_api_key
    messages = [{"role": "user", "content": body.prompt}]

    # Resolve model names
    models = []
    for mid in body.model_ids:
        m = registry.get(mid)
        if not m:
            raise HTTPException(404, f"Model not found: {mid}")
        from pathlib import Path
        models.append({"id": mid, "name": m.name, "omlx_name": Path(m.path).name if m.path else m.name})

    queue: asyncio.Queue = asyncio.Queue()

    async def _stream_model(model: dict, index: int):
        tokens = []
        try:
            async for chunk in stream_to_omlx(
                model["omlx_name"], messages, base_url, api_key,
                body.temperature, body.max_tokens,
            ):
                if chunk.get("done"):
                    await queue.put({
                        "event": "done", "index": index, "model": model["name"],
                        "tps": chunk.get("tps"), "ttft_ms": chunk.get("ttft_ms"),
                        "output_tokens": chunk.get("output_tokens"),
                        "response": "".join(tokens),
                    })
                    return
                token = chunk.get("token", "")
                if token:
                    tokens.append(token)
                    await queue.put({"event": "token", "index": index, "token": token})
        except Exception as e:
            await queue.put({"event": "error", "index": index, "model": model["name"], "message": str(e)})

    async def _merged():
        yield f"data: {json.dumps({'event': 'start', 'models': [m['name'] for m in models]})}\n\n"
        tasks = [asyncio.create_task(_stream_model(m, i)) for i, m in enumerate(models)]
        finished = 0
        total = len(models)
        while finished < total:
            item = await queue.get()
            yield f"data: {json.dumps(item)}\n\n"
            if item.get("event") in ("done", "error"):
                finished += 1
        # Auto-unload every model we loaded for this diff — diff bypasses Crucible's
        # active_adapter, so oMLX would otherwise keep them in its engine pool forever.
        # Preserve the model currently held by active_adapter (if any) so we don't
        # interfere with a chat session.
        active = request.app.state.active_adapter
        keep = active.model_id if active and active.is_loaded() else None
        import httpx
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        async with httpx.AsyncClient(timeout=10.0) as client:
            for m in models:
                if m["id"] == keep:
                    continue
                try:
                    await client.post(f"{base_url}/v1/models/{m['omlx_name']}/unload", headers=headers)
                except Exception:
                    pass
        yield f"data: {json.dumps({'event': 'complete'})}\n\n"
        for t in tasks:
            t.cancel()

    return StreamingResponse(_merged(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
