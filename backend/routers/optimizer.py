"""Prompt Optimizer — test multiple prompt variations and compare performance."""

import asyncio
import json
import time
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter()


class OptimizerRequest(BaseModel):
    prompts: list[str]
    model_id: str | None = None  # None = use active model
    temperature: float = 0.7
    max_tokens: int = 512


@router.post("/optimizer/run")
async def run_optimizer(body: OptimizerRequest, request: Request) -> StreamingResponse:
    if len(body.prompts) < 2:
        raise HTTPException(400, "Need at least 2 prompt variations")
    if len(body.prompts) > 10:
        raise HTTPException(400, "Max 10 variations")

    cfg = request.app.state.config
    base_url = cfg.mlx_external_url or "http://127.0.0.1:8000"
    api_key = cfg.omlx_api_key

    # Determine model
    if body.model_id:
        registry = request.app.state.registry
        model = registry.get(body.model_id)
        if not model:
            raise HTTPException(404, "Model not found")
        from pathlib import Path
        model_name = Path(model.path).name if model.path else model.name
    else:
        adapter = request.app.state.active_adapter
        if not adapter or not adapter.is_loaded():
            raise HTTPException(400, "No model loaded and no model_id specified")
        model_name = getattr(adapter, "_server_model_id", None) or adapter.model_id

    import httpx

    async def _run_one(prompt: str) -> dict:
        payload = {
            "model": model_name,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": body.temperature,
            "max_tokens": body.max_tokens,
            "stream": True,
        }
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        t0 = time.monotonic()
        first_token_time = None
        total_tokens = 0
        output = []

        async with httpx.AsyncClient(timeout=300.0) as client:
            async with client.stream("POST", f"{base_url}/v1/chat/completions",
                json=payload, headers=headers) as resp:
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
                            output.append(content)
                    except Exception:
                        continue

        t1 = time.monotonic()
        ttft_ms = round((first_token_time - t0) * 1000, 2) if first_token_time else None
        gen_time = (t1 - first_token_time) if first_token_time else (t1 - t0)
        tps = round(total_tokens / gen_time, 2) if gen_time > 0 and total_tokens > 0 else None

        return {
            "tps": tps,
            "ttft_ms": ttft_ms,
            "output_tokens": total_tokens,
            "total_ms": round((t1 - t0) * 1000, 1),
            "output_length": len("".join(output)),
            "response_preview": "".join(output)[:300],
        }

    async def _stream():
        yield f"data: {json.dumps({'event': 'start', 'model': model_name, 'count': len(body.prompts)})}\n\n"
        results = []

        for i, prompt in enumerate(body.prompts):
            yield f"data: {json.dumps({'event': 'progress', 'index': i, 'prompt': prompt[:100]})}\n\n"
            try:
                r = await _run_one(prompt)
                results.append(r)
                yield f"data: {json.dumps({'event': 'result', 'index': i, **r})}\n\n"
            except Exception as e:
                results.append({"tps": None, "ttft_ms": None, "output_tokens": 0, "total_ms": 0, "output_length": 0, "response_preview": ""})
                yield f"data: {json.dumps({'event': 'error', 'index': i, 'message': str(e)})}\n\n"

        # Find best
        tps_vals = [(i, r["tps"]) for i, r in enumerate(results) if r["tps"]]
        best_idx = max(tps_vals, key=lambda x: x[1])[0] if tps_vals else 0
        fastest_ttft = [(i, r["ttft_ms"]) for i, r in enumerate(results) if r["ttft_ms"]]
        fastest_ttft_idx = min(fastest_ttft, key=lambda x: x[1])[0] if fastest_ttft else 0

        yield f"data: {json.dumps({'event': 'done', 'results': results, 'best_tps_index': best_idx, 'best_ttft_index': fastest_ttft_idx})}\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
