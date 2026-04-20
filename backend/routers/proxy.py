"""OpenAI-compatible proxy — rewrites requests to the active adapter's server."""
import hashlib
import json
import logging
import httpx
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse, JSONResponse


def _api_key_tag(request: Request) -> str:
    """Short stable hash of the caller's API key. Never stores the raw key —
    gives per-caller sparklines without PII."""
    auth = request.headers.get("authorization") or request.headers.get("x-api-key") or ""
    token = auth.replace("Bearer ", "").strip()
    if not token:
        return "anonymous"
    return "k:" + hashlib.sha1(token.encode()).hexdigest()[:10]

router = APIRouter()
log = logging.getLogger(__name__)


def _resolve_model_id(registry, requested: str):
    """Find a ModelEntry matching the requested name. Tolerates bare names and kind-prefixed IDs."""
    if not requested:
        return None
    # Exact ID match
    m = registry.get(requested)
    if m:
        return m
    # Try common prefix variants
    for prefix in ("mlx:", "gguf:", "ollama:", "vllm:", "mlx_studio:"):
        m = registry.get(prefix + requested)
        if m:
            return m
    # Fall back to matching by name (may match multiple — pick first)
    for m in registry.all():
        if m.name == requested:
            return m
    return None


async def _ensure_loaded(app_state, requested_model: str) -> tuple[bool, str]:
    """Ensure the requested model is the active one; load it if not. Returns (ok, error)."""
    from routers.models import _resolve_engine, _build_adapter
    from clients import sync_all_clients

    registry = app_state.registry
    config = app_state.config
    target = _resolve_model_id(registry, requested_model)
    if not target:
        return False, f"Model '{requested_model}' not found in registry"

    current = app_state.active_adapter
    if current and current.is_loaded() and current.model_id == target.id:
        return True, ""

    log.info("Auto-loading %s for proxy request (was: %s)",
             target.id, current.model_id if current else "none")
    if current:
        try:
            await current.stop()
        except Exception as e:
            log.warning("Failed to stop current adapter: %s", e)
        app_state.active_adapter = None

    engine = _resolve_engine(target, None)
    adapter, err = _build_adapter(target, config, engine, compare=False)
    if not adapter:
        return False, err or "Adapter build failed"

    async for evt in adapter.load(target):
        kind = evt.get("event")
        if kind == "error":
            return False, evt.get("data", {}).get("message", "Load failed")
        if kind == "done":
            break
    app_state.active_adapter = adapter
    try:
        sync_all_clients(target.id, base_url="http://127.0.0.1:7777/v1")
    except Exception:
        pass
    return True, ""


@router.get("/v1/models")
async def proxy_models(request: Request):
    adapter = request.app.state.active_adapter
    if not adapter or not adapter.is_loaded():
        return JSONResponse({"object": "list", "data": []})
    # Forward to the underlying server if it has a base_url, else synthesize
    base_url = getattr(adapter, "_base_url", None)
    if base_url:
        try:
            headers = getattr(adapter, "_headers", lambda: {})()
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{base_url}/v1/models", headers=headers)
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
    body = await request.json()

    # Rate limit — best-effort, keyed off the hashed caller.
    try:
        import rate_limit
        if not rate_limit.allow(_api_key_tag(request)):
            return JSONResponse(
                {"error": "rate limit exceeded; slow your requests"},
                status_code=429,
            )
    except Exception:
        pass

    # Auto-load the requested model if it's not currently active.
    # Lets opencode / Qwen Code / any OpenAI client switch models by name
    # without having to load through Crucible's UI first.
    requested_model = body.get("model")
    adapter = request.app.state.active_adapter
    if requested_model and (not adapter or not adapter.is_loaded()
                            or adapter.model_id != requested_model
                            and not (adapter.model_id or "").endswith(":" + requested_model)):
        ok, err = await _ensure_loaded(request.app.state, requested_model)
        if not ok:
            return JSONResponse({"error": err}, status_code=503)
        adapter = request.app.state.active_adapter

    if not adapter or not adapter.is_loaded():
        return JSONResponse({"error": "No model loaded"}, status_code=503)

    base_url = getattr(adapter, "_base_url", None)
    server_model_id = getattr(adapter, "_server_model_id", None)

    if not base_url or not server_model_id:
        return JSONResponse({"error": "Adapter has no proxy target"}, status_code=503)

    # Smart routing — auto-select model based on prompt content
    from smart_router import select_model, get_config as get_router_config
    router_cfg = get_router_config()
    if router_cfg.get("enabled"):
        messages = body.get("messages", [])
        prompt_text = " ".join(m.get("content", "") for m in messages if m.get("role") == "user")
        if prompt_text:
            registry = request.app.state.registry
            available = [
                {"name": m.name, "kind": m.kind, "size_bytes": m.size_bytes, "node": m.node}
                for m in registry.all()
            ]
            routed_model = select_model(prompt_text, available, router_cfg)
            if routed_model and routed_model != server_model_id:
                # Route to the selected model via oMLX (multi-model server)
                body["model"] = routed_model
                body["_smart_routed"] = True
            else:
                body["model"] = server_model_id
    else:
        body["model"] = server_model_id

    # Rewrite model field to the correct server-side ID (full path for mlx_lm)
    if not body.get("_smart_routed"):
        body["model"] = server_model_id
    body.pop("_smart_routed", None)

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

        # Usage tracker — best-effort, anonymous key tag so we never store secrets.
        try:
            import usage_tracker
            tag = _api_key_tag(request)
            usage_tracker.record(tag, tokens_in=0, tokens_out=total_tokens,
                                 model_id=getattr(adapter, "model_id", None))
        except Exception:
            pass

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
