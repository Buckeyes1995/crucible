"""Log-probs endpoint — stream token generation with alternative-token
probabilities so the visualizer can render a per-step distribution.

Uses the standard OpenAI logprobs/top_logprobs parameters that oMLX
supports. Other adapters may return null for logprobs; the frontend
falls back to plain tokens in that case.
"""
from __future__ import annotations

import json
from typing import AsyncGenerator

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter()


class LogprobRequest(BaseModel):
    prompt: str
    max_tokens: int = 128
    temperature: float = 0.7
    top_logprobs: int = 5     # number of alternative tokens per step


@router.post("/logprobs/stream")
async def stream_with_logprobs(body: LogprobRequest, request: Request) -> StreamingResponse:
    """Fire a /v1/chat/completions request with logprobs enabled and forward
    the upstream SSE with a per-token event the visualizer can consume."""
    cfg = request.app.state.config
    adapter = request.app.state.active_adapter
    if not adapter or not adapter.is_loaded():
        return StreamingResponse(
            iter([f"data: {json.dumps({'event': 'error', 'message': 'no model loaded'})}\n\n"]),
            media_type="text/event-stream",
        )
    base_url = f"http://127.0.0.1:{cfg.mlx_port}" if adapter.kind == "mlx" else None
    # Prefer the running adapter's direct base_url if it exposes one.
    if hasattr(adapter, "base_url") and adapter.base_url:
        base_url = adapter.base_url.rstrip("/")
    if not base_url:
        return StreamingResponse(
            iter([f"data: {json.dumps({'event': 'error', 'message': 'no base_url for active adapter'})}\n\n"]),
            media_type="text/event-stream",
        )
    api_key = cfg.omlx_api_key if adapter.kind == "mlx" else ""

    # oMLX's /v1 uses the bare directory name; fall back to model_id for other
    # adapters (mlx_lm, vllm) that already speak in full-path / raw form.
    wire_model = getattr(adapter, "server_model_id", None) or adapter.model_id
    payload = {
        "model": wire_model,
        "messages": [{"role": "user", "content": body.prompt}],
        "max_tokens": body.max_tokens,
        "temperature": body.temperature,
        "stream": True,
        "logprobs": True,
        "top_logprobs": max(1, min(10, body.top_logprobs)),
    }
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}

    async def _stream() -> AsyncGenerator[str, None]:
        async with httpx.AsyncClient(timeout=600.0) as client:
            try:
                async with client.stream("POST", f"{base_url}/v1/chat/completions",
                                         json=payload, headers=headers) as resp:
                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        chunk = line[6:]
                        if chunk.strip() == "[DONE]":
                            yield f"data: {json.dumps({'event': 'done'})}\n\n"
                            return
                        try:
                            data = json.loads(chunk)
                            choice = data.get("choices", [{}])[0]
                            delta = choice.get("delta", {})
                            content = delta.get("content") or delta.get("reasoning_content") or ""
                            lp = choice.get("logprobs", {}) or {}
                            step_info = None
                            if lp and lp.get("content"):
                                # logprobs.content is a list of per-token entries. Pull the
                                # one corresponding to the delta (we emit one at a time so
                                # the last element is our step).
                                entries = lp["content"]
                                step = entries[-1] if entries else None
                                if step:
                                    step_info = {
                                        "token": step.get("token"),
                                        "logprob": step.get("logprob"),
                                        "top": [
                                            {"token": t.get("token"), "logprob": t.get("logprob")}
                                            for t in (step.get("top_logprobs") or [])
                                        ],
                                    }
                            if content or step_info:
                                yield f"data: {json.dumps({'event': 'token', 'content': content, 'logprobs': step_info})}\n\n"
                        except Exception:
                            continue
            except Exception as e:
                yield f"data: {json.dumps({'event': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
