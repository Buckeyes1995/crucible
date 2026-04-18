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
    max_tokens: int = 2048


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

    # Build per-model param overrides from Crucible's model_params store so
    # diff respects enable_thinking, top_k/p, presence_penalty, etc.
    from model_params import get_params
    def _extra_for(model_id: str) -> dict:
        p = get_params(model_id)
        extra: dict = {}
        for key in ("top_k", "top_p", "min_p", "repetition_penalty", "presence_penalty"):
            if p.get(key) is not None:
                extra[key] = p[key]
        ctk: dict = {}
        if p.get("enable_thinking") is not None:
            ctk["enable_thinking"] = bool(p["enable_thinking"])
        if p.get("preserve_thinking") is not None:
            ctk["preserve_thinking"] = bool(p["preserve_thinking"])
        if ctk:
            extra["chat_template_kwargs"] = ctk
        return extra

    async def _stream_model(model: dict, index: int):
        tokens = []
        try:
            async for chunk in stream_to_omlx(
                model["omlx_name"], messages, base_url, api_key,
                body.temperature, body.max_tokens,
                extra_params=_extra_for(model["id"]),
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

    # 2KB padding so proxies flush each chunk rather than buffering up to ~4KB
    _PAD = ":" + (" " * 2048) + "\n"

    async def _unload_all_except_active():
        """Unload every model this diff touched. Fires on clean completion AND on
        abort/disconnect — wrapped in try/finally so it can't leak models."""
        active = request.app.state.active_adapter
        keep = active.model_id if active and active.is_loaded() else None
        import httpx
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                for m in models:
                    if m["id"] == keep:
                        continue
                    try:
                        await client.post(f"{base_url}/v1/models/{m['omlx_name']}/unload", headers=headers)
                    except Exception:
                        pass
        except Exception:
            pass

    async def _merged():
        """Sequential diff: run one model at a time.

        Parallel execution thrashes oMLX's engine pool when combined model
        weights exceed its memory budget — models keep evicting each other
        and no one finishes. Sequential is slower wall-clock but reliable.
        """
        completed_cleanly = False
        current_task: asyncio.Task | None = None
        current_model: dict | None = None  # track which model is being processed for abort-unload
        try:
            yield _PAD + f"data: {json.dumps({'event': 'start', 'models': [m['name'] for m in models]})}\n\n"
            for i, m in enumerate(models):
                current_model = m
                # Tell the frontend we're now starting this model (sequential mode)
                yield _PAD + f"data: {json.dumps({'event': 'running', 'index': i, 'model': m['name']})}\n\n"
                current_task = asyncio.create_task(_stream_model(m, i))
                # Drain this model's events until its done/error before starting the next
                while True:
                    item = await queue.get()
                    yield _PAD + f"data: {json.dumps(item)}\n\n"
                    if item.get("event") in ("done", "error") and item.get("index") == i:
                        break
                # Unload before loading the next — keeps oMLX memory headroom open
                if i < len(models) - 1:
                    try:
                        import httpx
                        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
                        async with httpx.AsyncClient(timeout=10.0) as client:
                            await client.post(f"{base_url}/v1/models/{m['omlx_name']}/unload", headers=headers)
                    except Exception:
                        pass
                current_task = None
                current_model = None
            yield f"data: {json.dumps({'event': 'complete'})}\n\n"
            completed_cleanly = True
        finally:
            if current_task and not current_task.done():
                current_task.cancel()
            # On abort, explicitly unload the in-progress model so oMLX stops its load/infer.
            # oMLX honors POST /v1/models/X/unload even mid-load ("immediate abort" in its logs).
            if not completed_cleanly and current_model is not None:
                try:
                    import httpx
                    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
                    async with httpx.AsyncClient(timeout=10.0) as client:
                        await client.post(
                            f"{base_url}/v1/models/{current_model['omlx_name']}/unload",
                            headers=headers,
                        )
                except Exception:
                    pass
            if completed_cleanly:
                try:
                    await _unload_all_except_active()
                except Exception:
                    pass

    return StreamingResponse(_merged(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
