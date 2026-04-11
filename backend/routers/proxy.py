"""OpenAI-compatible proxy — rewrites requests to the active adapter's server."""
import json
import httpx
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse, JSONResponse

router = APIRouter()


@router.get("/v1/models")
async def proxy_models(request: Request):
    adapter = request.app.state.active_adapter
    if not adapter or not adapter.is_loaded():
        return JSONResponse({"object": "list", "data": []})
    # Forward to the underlying server if it has a base_url, else synthesize
    base_url = getattr(adapter, "_base_url", None)
    if base_url:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{base_url}/v1/models")
                return JSONResponse(r.json(), status_code=r.status_code)
        except Exception:
            pass
    # Fallback: synthesize from known model
    model_id = adapter.model_id or "local"
    return JSONResponse({
        "object": "list",
        "data": [{"id": model_id, "object": "model", "created": 0}],
    })


@router.post("/v1/chat/completions")
async def proxy_chat(request: Request):
    adapter = request.app.state.active_adapter
    if not adapter or not adapter.is_loaded():
        return JSONResponse({"error": "No model loaded"}, status_code=503)

    base_url = getattr(adapter, "_base_url", None)
    server_model_id = getattr(adapter, "_server_model_id", None)

    if not base_url or not server_model_id:
        return JSONResponse({"error": "Adapter has no proxy target"}, status_code=503)

    # Rewrite model field to the correct server-side ID (full path for mlx_lm)
    body = await request.json()
    body["model"] = server_model_id

    is_stream = body.get("stream", False)
    if is_stream:
        body.setdefault("stream_options", {})["include_usage"] = True

    async def _stream_proxy():
        import time
        t0 = time.monotonic()
        first_token_time = None
        total_tokens = 0
        got_server_metrics = False
        buf = ""

        async with httpx.AsyncClient(timeout=600.0) as client:
            async with client.stream(
                "POST",
                f"{base_url}/v1/chat/completions",
                json=body,
                headers={"Content-Type": "application/json", **getattr(adapter, "_headers", lambda: {})()},
            ) as resp:
                async for chunk in resp.aiter_bytes():
                    yield chunk
                    try:
                        buf += chunk.decode("utf-8", errors="ignore")
                        while "\n" in buf:
                            line, buf = buf.split("\n", 1)
                            line = line.strip()
                            if not line.startswith("data: ") or line == "data: [DONE]":
                                continue
                            data = json.loads(line[6:])
                            # Use server-reported metrics if available (most accurate)
                            usage = data.get("usage")
                            if usage:
                                tps = usage.get("generation_tokens_per_second")
                                ttft = usage.get("time_to_first_token")
                                prompt_tps = usage.get("prompt_tokens_per_second")
                                if tps:
                                    adapter.last_tps = round(tps, 2)
                                    got_server_metrics = True
                                if ttft:
                                    adapter.last_ttft_ms = round(ttft * 1000, 2)
                                    got_server_metrics = True
                                if prompt_tps:
                                    adapter.last_prompt_tps = round(prompt_tps, 2)
                                continue
                            # Fallback: count content tokens manually
                            choices = data.get("choices", [])
                            if not choices:
                                continue
                            delta = choices[0].get("delta", {})
                            content = delta.get("content") or delta.get("reasoning") or ""
                            if content:
                                if first_token_time is None:
                                    first_token_time = time.monotonic()
                                    adapter.last_ttft_ms = round((first_token_time - t0) * 1000, 2)
                                total_tokens += 1
                    except Exception:
                        pass

        # Fallback tok/s if server didn't report it
        if not got_server_metrics and total_tokens > 0 and first_token_time:
            t1 = time.monotonic()
            if t1 > first_token_time:
                adapter.last_tps = round(total_tokens / (t1 - first_token_time), 2)

    if is_stream:
        return StreamingResponse(
            _stream_proxy(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # Non-streaming — force streaming internally to get usage metrics, return assembled response
    import time
    body_stream = {**body, "stream": True, "stream_options": {"include_usage": True}}
    t0 = time.monotonic()
    first_token_time = None
    content_parts: list[str] = []
    finish_reason = "stop"
    usage_data: dict = {}

    async with httpx.AsyncClient(timeout=600.0) as client:
        async with client.stream(
            "POST",
            f"{base_url}/v1/chat/completions",
            json=body_stream,
            headers={"Content-Type": "application/json", **getattr(adapter, "_headers", lambda: {})()},
        ) as resp:
            buf = ""
            async for chunk in resp.aiter_bytes():
                try:
                    buf += chunk.decode("utf-8", errors="ignore")
                    while "\n" in buf:
                        line, buf = buf.split("\n", 1)
                        line = line.strip()
                        if not line.startswith("data: ") or line == "data: [DONE]":
                            continue
                        data = json.loads(line[6:])
                        usage = data.get("usage")
                        if usage:
                            usage_data = usage
                            tps = usage.get("generation_tokens_per_second")
                            ttft = usage.get("time_to_first_token")
                            prompt_tps = usage.get("prompt_tokens_per_second")
                            if tps:
                                adapter.last_tps = round(tps, 2)
                            if ttft:
                                adapter.last_ttft_ms = round(ttft * 1000, 2)
                            if prompt_tps:
                                adapter.last_prompt_tps = round(prompt_tps, 2)
                            continue
                        choices = data.get("choices", [])
                        if not choices:
                            continue
                        delta = choices[0].get("delta", {})
                        content = delta.get("content") or delta.get("reasoning") or ""
                        if content:
                            if first_token_time is None:
                                first_token_time = time.monotonic()
                            content_parts.append(content)
                        if choices[0].get("finish_reason"):
                            finish_reason = choices[0]["finish_reason"]
                except Exception:
                    pass

    assembled = {
        "id": f"chatcmpl-crucible",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": server_model_id,
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": "".join(content_parts)},
            "finish_reason": finish_reason,
        }],
        "usage": usage_data,
    }
    return JSONResponse(assembled)
