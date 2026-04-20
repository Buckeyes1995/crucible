"""Vision helper — accept an image upload + prompt, wrap into OpenAI vision
message format, and forward to the active MLX adapter. Works with VLM
models (Qwen3.5-VL etc.) that oMLX exposes.
"""
from __future__ import annotations

import base64
import httpx
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

router = APIRouter()


@router.post("/vision/describe")
async def describe(
    request: Request,
    image: UploadFile = File(...),
    prompt: str = Form("Describe this image."),
    max_tokens: int = Form(512),
    temperature: float = Form(0.3),
):
    adapter = getattr(request.app.state, "active_adapter", None)
    if adapter is None or not adapter.is_loaded():
        raise HTTPException(400, "no model loaded; load a VLM in /models first")

    raw = await image.read()
    b64 = base64.b64encode(raw).decode("ascii")
    mime = image.content_type or "image/png"
    data_url = f"data:{mime};base64,{b64}"

    base_url = getattr(adapter, "base_url", None) or request.app.state.config.mlx_external_url or "http://127.0.0.1:8000"
    api_key = getattr(adapter, "api_key", "") or request.app.state.config.omlx_api_key
    model_name = getattr(adapter, "server_model_id", None) or adapter.model_id

    payload = {
        "model": model_name,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": data_url}},
            ],
        }],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    try:
        async with httpx.AsyncClient(timeout=300.0, headers=headers) as client:
            r = await client.post(f"{base_url}/v1/chat/completions", json=payload)
            if not r.is_success:
                raise HTTPException(502, f"upstream returned {r.status_code}: {r.text[:300]}")
            data = r.json()
            content = data["choices"][0]["message"].get("content") or ""
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"vision request failed: {e}")
    return {"response": content, "model_id": adapter.model_id, "bytes_in": len(raw)}
