"""DFlash benchmark — compare tok/s with and without DFlash for eligible models."""

import asyncio
import json
import time
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from omlx_admin import OMLXAdminClient

router = APIRouter()

BENCH_PROMPTS = [
    "Explain the concept of gradient descent in machine learning.",
    "Write a Python function to find the longest common subsequence of two strings.",
    "What are the key differences between TCP and UDP? Give examples of when to use each.",
]


class DFlashBenchRequest(BaseModel):
    model_id: str
    max_tokens: int = 512
    temperature: float = 0.7
    prompts: list[str] | None = None  # defaults to BENCH_PROMPTS


async def _run_one(
    model_name: str,
    prompt: str,
    base_url: str,
    api_key: str,
    temperature: float,
    max_tokens: int,
) -> dict:
    """Run a single chat completion and return timing metrics."""
    import httpx
    payload = {
        "model": model_name,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    t0 = time.monotonic()
    first_token_time = None
    total_tokens = 0

    async with httpx.AsyncClient(timeout=300.0) as client:
        async with client.stream("POST", f"{base_url}/v1/chat/completions", json=payload, headers=headers) as resp:
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
    }


@router.post("/dflash/benchmark")
async def run_dflash_benchmark(body: DFlashBenchRequest, request: Request) -> StreamingResponse:
    """Run benchmark with DFlash on vs off. Streams progress events."""
    registry = request.app.state.registry
    model = registry.get(body.model_id)
    if not model:
        raise HTTPException(404, "Model not found")
    if not model.dflash_draft:
        raise HTTPException(400, "Model is not DFlash-eligible")

    cfg = request.app.state.config
    base_url = cfg.mlx_external_url or "http://127.0.0.1:8000"
    omlx_model_name = model.name
    prompts = body.prompts or BENCH_PROMPTS
    omlx = OMLXAdminClient(base_url=base_url, api_key=cfg.omlx_api_key)

    async def _stream():
        total_steps = len(prompts) * 2
        step = 0

        yield f"data: {json.dumps({'event': 'start', 'total_steps': total_steps, 'model': model.name})}\n\n"

        results_normal = []
        results_dflash = []

        # Phase 1: Run WITHOUT DFlash
        yield f"data: {json.dumps({'event': 'phase', 'phase': 'normal', 'message': 'Running without DFlash…'})}\n\n"
        await omlx.set_dflash(omlx_model_name, enabled=False)
        await asyncio.sleep(1)  # Give oMLX a moment to reconfigure

        for i, prompt in enumerate(prompts):
            step += 1
            yield f"data: {json.dumps({'event': 'progress', 'step': step, 'phase': 'normal', 'prompt_index': i})}\n\n"
            try:
                metrics = await _run_one(omlx_model_name, prompt, base_url, cfg.omlx_api_key, body.temperature, body.max_tokens)
                results_normal.append(metrics)
                yield f"data: {json.dumps({'event': 'result', 'step': step, 'phase': 'normal', 'prompt_index': i, **metrics})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'event': 'error', 'message': f'Normal run failed: {e}'})}\n\n"
                results_normal.append({"tps": None, "ttft_ms": None, "output_tokens": 0, "total_ms": 0})

        # Phase 2: Run WITH DFlash
        yield f"data: {json.dumps({'event': 'phase', 'phase': 'dflash', 'message': 'Running with DFlash…'})}\n\n"
        await omlx.set_dflash(omlx_model_name, enabled=True, draft_model=model.dflash_draft, draft_quant_bits=4)
        await asyncio.sleep(1)

        for i, prompt in enumerate(prompts):
            step += 1
            yield f"data: {json.dumps({'event': 'progress', 'step': step, 'phase': 'dflash', 'prompt_index': i})}\n\n"
            try:
                metrics = await _run_one(omlx_model_name, prompt, base_url, cfg.omlx_api_key, body.temperature, body.max_tokens)
                results_dflash.append(metrics)
                yield f"data: {json.dumps({'event': 'result', 'step': step, 'phase': 'dflash', 'prompt_index': i, **metrics})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'event': 'error', 'message': f'DFlash run failed: {e}'})}\n\n"
                results_dflash.append({"tps": None, "ttft_ms": None, "output_tokens": 0, "total_ms": 0})

        # Reset DFlash to off after benchmark
        await omlx.set_dflash(omlx_model_name, enabled=False)

        # Summary
        normal_tps = [r["tps"] for r in results_normal if r["tps"]]
        dflash_tps = [r["tps"] for r in results_dflash if r["tps"]]
        avg_normal = round(sum(normal_tps) / len(normal_tps), 2) if normal_tps else 0
        avg_dflash = round(sum(dflash_tps) / len(dflash_tps), 2) if dflash_tps else 0
        speedup = round(avg_dflash / avg_normal, 2) if avg_normal > 0 else 0

        normal_ttft = [r["ttft_ms"] for r in results_normal if r["ttft_ms"]]
        dflash_ttft = [r["ttft_ms"] for r in results_dflash if r["ttft_ms"]]
        avg_normal_ttft = round(sum(normal_ttft) / len(normal_ttft), 1) if normal_ttft else 0
        avg_dflash_ttft = round(sum(dflash_ttft) / len(dflash_ttft), 1) if dflash_ttft else 0

        summary = {
            "event": "done",
            "model": model.name,
            "prompts_count": len(prompts),
            "normal": {"avg_tps": avg_normal, "avg_ttft_ms": avg_normal_ttft, "results": results_normal},
            "dflash": {"avg_tps": avg_dflash, "avg_ttft_ms": avg_dflash_ttft, "results": results_dflash},
            "speedup": speedup,
        }
        yield f"data: {json.dumps(summary)}\n\n"

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
