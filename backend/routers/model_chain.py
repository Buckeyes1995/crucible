"""Model chaining — pipe the output of model A into model B as input, repeat
for an arbitrary list. One-shot, non-streaming, meant for small creative /
refinement pipelines ('draft with small model, polish with big one')."""
from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()


class ChainStep(BaseModel):
    model_id: str
    system_prompt: str = ""
    # Template for this step's user message. {input} gets replaced with the
    # previous step's output (or the initial input for step 0).
    template: str = "{input}"
    temperature: float = 0.5
    max_tokens: int = 1024


class ChainRequest(BaseModel):
    initial_input: str
    steps: list[ChainStep]


def _omlx_name(model_id: str, registry) -> str:
    m = registry.get(model_id) if registry else None
    if m and getattr(m, "path", None):
        return Path(m.path).name
    return model_id.split(":", 1)[-1] if ":" in model_id else model_id


@router.post("/chain/run")
async def run_chain(body: ChainRequest, request: Request) -> dict[str, Any]:
    if not body.steps:
        raise HTTPException(400, "need at least one step")
    cfg = request.app.state.config
    registry = getattr(request.app.state, "registry", None)
    base_url = cfg.mlx_external_url or "http://127.0.0.1:8000"
    api_key = cfg.omlx_api_key

    current = body.initial_input
    outputs: list[dict[str, Any]] = []
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}

    async with httpx.AsyncClient(timeout=600.0, headers=headers) as client:
        for i, step in enumerate(body.steps):
            name = _omlx_name(step.model_id, registry)
            user_msg = step.template.replace("{input}", current)
            messages: list[dict] = []
            if step.system_prompt:
                messages.append({"role": "system", "content": step.system_prompt})
            messages.append({"role": "user", "content": user_msg})
            payload = {
                "model": name, "messages": messages,
                "temperature": step.temperature, "max_tokens": step.max_tokens,
                "stream": False,
            }
            t0 = time.monotonic()
            try:
                r = await client.post(f"{base_url}/v1/chat/completions", json=payload)
                r.raise_for_status()
                data = r.json()
                text = data["choices"][0]["message"].get("content") or ""
            except Exception as e:
                outputs.append({"step": i, "model_id": step.model_id, "error": str(e)})
                return {"success": False, "outputs": outputs}
            elapsed = round(time.monotonic() - t0, 2)
            outputs.append({
                "step": i, "model_id": step.model_id,
                "output": text, "elapsed_s": elapsed,
            })
            # Unload between steps to keep oMLX memory bounded — best-effort.
            try:
                await client.post(f"{base_url}/v1/models/{name}/unload")
            except Exception:
                pass
            current = text

    return {"success": True, "final": current, "outputs": outputs}
