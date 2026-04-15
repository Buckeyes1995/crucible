"""Batch Inference — run a list of prompts and collect all results."""
import asyncio, json, time
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from arena import stream_to_omlx

router = APIRouter()

class BatchRequest(BaseModel):
    prompts: list[str]
    model_id: str | None = None
    temperature: float = 0.7
    max_tokens: int = 1024
    system_prompt: str = ""

@router.post("/batch/run")
async def run_batch(body: BatchRequest, request: Request) -> StreamingResponse:
    if len(body.prompts) > 50:
        raise HTTPException(400, "Max 50 prompts per batch")

    cfg = request.app.state.config
    base_url = cfg.mlx_external_url or "http://127.0.0.1:8000"
    api_key = cfg.omlx_api_key

    if body.model_id:
        m = request.app.state.registry.get(body.model_id)
        if not m: raise HTTPException(404, "Model not found")
        from pathlib import Path
        model_name = Path(m.path).name if m.path else m.name
    else:
        adapter = request.app.state.active_adapter
        if not adapter: raise HTTPException(400, "No model loaded")
        model_name = getattr(adapter, "_server_model_id", None) or adapter.model_id

    async def _stream():
        yield f"data: {json.dumps({'event': 'start', 'total': len(body.prompts), 'model': model_name})}\n\n"
        results = []
        for i, prompt in enumerate(body.prompts):
            msgs = []
            if body.system_prompt:
                msgs.append({"role": "system", "content": body.system_prompt})
            msgs.append({"role": "user", "content": prompt})

            yield f"data: {json.dumps({'event': 'progress', 'index': i})}\n\n"
            tokens = []
            tps = None; ttft = None
            try:
                async for chunk in stream_to_omlx(model_name, msgs, base_url, api_key, body.temperature, body.max_tokens):
                    if chunk.get("done"):
                        tps = chunk.get("tps"); ttft = chunk.get("ttft_ms")
                    elif chunk.get("token"):
                        tokens.append(chunk["token"])
            except Exception as e:
                yield f"data: {json.dumps({'event': 'error', 'index': i, 'message': str(e)})}\n\n"
                continue

            result = {"index": i, "prompt": prompt[:100], "response": "".join(tokens), "tps": tps, "ttft_ms": ttft, "tokens": len(tokens)}
            results.append(result)
            yield f"data: {json.dumps({'event': 'result', **result})}\n\n"

        yield f"data: {json.dumps({'event': 'done', 'count': len(results)})}\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
