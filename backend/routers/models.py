import asyncio
import json
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse

from adapters.omlx import OMLXAdapter
from adapters.mlx_lm import MLXAdapter
from adapters.llama_cpp import LlamaCppAdapter
from adapters.ollama import OllamaAdapter
from adapters.external import ExternalAdapter, ManagedExternalAdapter
from adapters.remote_node import RemoteNodeAdapter
from adapters.vllm import VLLMAdapter
from models.schemas import ModelEntry
from clients import sync_all_clients
import model_notes
import webhooks as wh
import zlab
import hf_updates

router = APIRouter()


def _sse(event: str, data: dict) -> str:
    return f"data: {json.dumps({'event': event, **data})}\n\n"


def _strip_internal_meta(meta: dict | None) -> dict | None:
    """Remove internal routing fields (API keys, URLs) from backend_meta before sending to clients."""
    if not meta:
        return meta
    return {k: v for k, v in meta.items() if not k.startswith("_remote_")}


def _load_omlx_dflash_state() -> dict[str, bool]:
    """Read oMLX model_settings.json to get DFlash enabled state per model."""
    from pathlib import Path
    import json as _json
    for base in [Path.home() / ".omlx", Path.home() / ".omlx-rc1"]:
        settings_file = base / "model_settings.json"
        if settings_file.exists():
            try:
                data = _json.loads(settings_file.read_text())
                return {
                    mid: s.get("dflash_enabled", False)
                    for mid, s in data.get("models", {}).items()
                }
            except Exception:
                pass
    return {}


ENGINES_BY_KIND: dict[str, list[str]] = {
    "mlx": ["omlx", "mlx_lm"],
    "vllm": ["vllm"],
    "gguf": ["llama_cpp"],
    "ollama": ["ollama"],
    "mlx_studio": ["mlx_studio"],
}


def _annotate_hidden(models: list[ModelEntry]) -> list[ModelEntry]:
    hidden_map = model_notes.all_hidden()
    pref_map = model_notes.all_preferred_engines()
    caps_map = model_notes.all_capabilities()
    deprec_map = model_notes.all_deprecations()
    dflash_state = _load_omlx_dflash_state()
    # z-lab match uses the cache only (no network here). Refresh endpoint below re-fetches.
    zlab_repos = zlab._load_cache().get("repos", [])
    updates_state = hf_updates.all_state()
    for m in models:
        m.hidden = hidden_map.get(m.id, False)
        m.capabilities = caps_map.get(m.id, [])
        dep = deprec_map.get(m.id)
        if dep:
            m.deprecated = True
            m.replacement_id = dep.get("replacement_id")
        m.backend_meta = _strip_internal_meta(m.backend_meta)
        if m.dflash_draft and m.name in dflash_state:
            m.dflash_enabled = dflash_state[m.name]
        if m.node == "local":
            m.available_engines = ENGINES_BY_KIND.get(m.kind, [])
            m.preferred_engine = pref_map.get(m.id)
            # Only surface available_draft_repo when there isn't already a local draft
            if not m.dflash_draft and m.kind in ("mlx", "gguf", "vllm"):
                m.available_draft_repo = zlab.match_draft_for(m.name, zlab_repos)
            up = updates_state.get(m.id, {})
            if up.get("origin_repo"):
                m.origin_repo = up["origin_repo"]
                m.update_available = bool(up.get("update_available"))
                m.upstream_last_modified = up.get("upstream_last_modified")
    return models


@router.get("/models", response_model=list[ModelEntry])
async def list_models(request: Request) -> list[ModelEntry]:
    return _annotate_hidden(request.app.state.registry.all())


@router.post("/models/refresh", response_model=list[ModelEntry])
async def refresh_models(request: Request) -> list[ModelEntry]:
    await request.app.state.registry.refresh()
    return _annotate_hidden(request.app.state.registry.all())


def _resolve_engine(model: ModelEntry, override: str | None, config=None) -> str:
    """Pick which engine to use. Priority: override > per-model preference >
    global default (from config for mlx kind) > first available."""
    available = ENGINES_BY_KIND.get(model.kind, [])
    if override and override in available:
        return override
    pref = model_notes.get_note(model.id).get("preferred_engine")
    if pref and pref in available:
        return pref
    if config is not None and model.kind == "mlx":
        global_default = getattr(config, "default_mlx_engine", "") or ""
        if global_default and global_default in available:
            return global_default
    return available[0] if available else model.kind


def _build_adapter(model: ModelEntry, config, engine: str, compare: bool) -> tuple[object | None, str | None]:
    """Return (adapter, error_message). compare=True uses compare ports where applicable."""
    if model.node != "local":
        meta = model.backend_meta or {}
        return RemoteNodeAdapter(
            node_url=meta["_remote_url"],
            remote_model_id=meta["_remote_model_id"],
            api_key=meta.get("_remote_api_key", ""),
        ), None
    if engine == "omlx":
        if config.mlx_external_url:
            return ExternalAdapter(base_url=config.mlx_external_url), None
        return OMLXAdapter(base_url="http://127.0.0.1:8000", model_dir=config.mlx_dir, api_key=config.omlx_api_key), None
    if engine == "mlx_lm":
        return MLXAdapter(port=config.mlx_port, python=config.mlx_python), None
    if engine == "vllm":
        port = config.vllm_compare_port if compare else config.vllm_port
        return VLLMAdapter(port=port, vllm_bin=config.vllm_bin), None
    if engine == "mlx_studio":
        if not config.mlx_studio_url:
            return None, "MLX Studio URL not configured in Settings"
        return ManagedExternalAdapter(base_url=config.mlx_studio_url), None
    if engine == "llama_cpp":
        port = config.llama_compare_port if compare else config.llama_port
        return LlamaCppAdapter(server_path=config.llama_server, port=port), None
    if engine == "ollama":
        return OllamaAdapter(host=config.ollama_host), None
    return None, f"Unknown engine: {engine}"


@router.delete("/models/{model_id:path}/disk")
async def delete_model_from_disk(model_id: str, request: Request) -> dict:
    """Delete a model's files from disk. Only supports local mlx/gguf/vllm models.

    Safety: the path must be under one of the configured model directories.
    Active models are stopped first. Refuses for remote/ollama/mlx_studio kinds.
    """
    import shutil
    from pathlib import Path

    registry = request.app.state.registry
    config = request.app.state.config
    model = registry.get(model_id)
    if not model:
        raise HTTPException(404, f"Model not found: {model_id}")
    if model.node != "local":
        raise HTTPException(400, "Cannot delete remote-node models")
    if model.kind not in ("mlx", "gguf", "vllm"):
        raise HTTPException(400, f"Delete not supported for kind={model.kind}")
    if not model.path:
        raise HTTPException(400, "Model has no path on disk")

    target = Path(model.path).resolve()
    allowed_roots = [
        Path(config.mlx_dir).expanduser().resolve(),
        Path(config.gguf_dir).expanduser().resolve(),
        Path(config.vllm_dir).expanduser().resolve(),
    ]
    if not any(str(target).startswith(str(root) + "/") or target == root for root in allowed_roots):
        raise HTTPException(400, f"Refusing to delete path outside configured model dirs: {target}")

    # Stop the model if it's the active adapter
    current = request.app.state.active_adapter
    if current and current.model_id == model_id:
        await current.stop()
        request.app.state.active_adapter = None

    if target.is_dir():
        shutil.rmtree(target)
    elif target.is_file():
        target.unlink()
    else:
        raise HTTPException(404, f"Path does not exist on disk: {target}")

    await registry.refresh()
    return {"deleted": str(target), "model_id": model_id}


@router.post("/models/stop")
async def stop_model(request: Request) -> dict:
    adapter = request.app.state.active_adapter
    if adapter:
        model_id = adapter.model_id
        await adapter.stop()
        request.app.state.active_adapter = None
        sync_all_clients(None)
        asyncio.create_task(wh.fire("model.unloaded", {"model_id": model_id}))
        try:
            import session_persist
            session_persist.record_load(None)
        except Exception:
            pass
    return {"status": "stopped"}


@router.post("/models/compare/stop")
async def stop_compare_model(request: Request) -> dict:
    adapter = request.app.state.compare_adapter
    if adapter:
        await adapter.stop()
        request.app.state.compare_adapter = None
    return {"status": "stopped"}


@router.post("/models/{model_id:path}/load")
async def load_model(model_id: str, request: Request) -> StreamingResponse:
    registry = request.app.state.registry
    config = request.app.state.config

    model = registry.get(model_id)
    if not model:
        raise HTTPException(status_code=404, detail=f"Model not found: {model_id}")

    engine_override = request.query_params.get("engine")
    engine = _resolve_engine(model, engine_override, request.app.state.config)

    async def _stream():
        # Stop any currently running adapter
        current = request.app.state.active_adapter
        if current and current.is_loaded():
            await current.stop()
            request.app.state.active_adapter = None

        adapter, err = _build_adapter(model, config, engine, compare=False)
        if err:
            yield _sse("error", {"data": {"message": err}})
            return

        async for evt in adapter.load(model):
            event_type = evt.get("event", "stage")
            data = evt.get("data", {})
            yield _sse(event_type, {"data": data})
            if event_type == "done":
                request.app.state.active_adapter = adapter
                sync_all_clients(model_id, base_url="http://127.0.0.1:7777/v1")
                asyncio.create_task(wh.fire("model.loaded", {
                    "model_id": model.id,
                    "model_name": model.name,
                    "elapsed_ms": data.get("elapsed_ms", 0),
                }))
                try:
                    import session_persist
                    session_persist.record_load(model.id, engine)
                except Exception:
                    pass
                try:
                    import model_extras
                    model_extras.record_load_timing(
                        model.id, int(data.get("elapsed_ms", 0) or 0),
                        int(model.size_bytes or 0),
                    )
                except Exception:
                    pass
                try:
                    from routers.warmth import record_load_event
                    record_load_event(model.id)
                except Exception:
                    pass
            elif event_type == "error":
                return

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/models/{model_id:path}/load-compare")
async def load_compare_model(model_id: str, request: Request) -> StreamingResponse:
    """Load a model into slot B (compare slot) without disturbing slot A."""
    registry = request.app.state.registry
    config = request.app.state.config

    model = registry.get(model_id)
    if not model:
        raise HTTPException(status_code=404, detail=f"Model not found: {model_id}")

    engine_override = request.query_params.get("engine")
    engine = _resolve_engine(model, engine_override, request.app.state.config)

    async def _stream():
        # Stop any currently running compare adapter
        current = request.app.state.compare_adapter
        if current and current.is_loaded():
            await current.stop()
            request.app.state.compare_adapter = None

        adapter, err = _build_adapter(model, config, engine, compare=True)
        if err:
            yield _sse("error", {"data": {"message": err}})
            return

        async for evt in adapter.load(model):
            event_type = evt.get("event", "stage")
            data = evt.get("data", {})
            yield _sse(event_type, {"data": data})
            if event_type == "done":
                request.app.state.compare_adapter = adapter
            elif event_type == "error":
                return

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
