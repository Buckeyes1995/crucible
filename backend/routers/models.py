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
from models.schemas import ModelEntry
from clients import sync_all_clients
import model_notes
import webhooks as wh

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


def _annotate_hidden(models: list[ModelEntry]) -> list[ModelEntry]:
    hidden_map = model_notes.all_hidden()
    dflash_state = _load_omlx_dflash_state()
    for m in models:
        m.hidden = hidden_map.get(m.id, False)
        m.backend_meta = _strip_internal_meta(m.backend_meta)
        if m.dflash_draft and m.name in dflash_state:
            m.dflash_enabled = dflash_state[m.name]
    return models


@router.get("/models", response_model=list[ModelEntry])
async def list_models(request: Request) -> list[ModelEntry]:
    return _annotate_hidden(request.app.state.registry.all())


@router.post("/models/refresh", response_model=list[ModelEntry])
async def refresh_models(request: Request) -> list[ModelEntry]:
    await request.app.state.registry.refresh()
    return _annotate_hidden(request.app.state.registry.all())


@router.post("/models/stop")
async def stop_model(request: Request) -> dict:
    adapter = request.app.state.active_adapter
    if adapter:
        model_id = adapter.model_id
        await adapter.stop()
        request.app.state.active_adapter = None
        sync_all_clients(None)
        asyncio.create_task(wh.fire("model.unloaded", {"model_id": model_id}))
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

    async def _stream():
        # Stop any currently running adapter
        current = request.app.state.active_adapter
        if current and current.is_loaded():
            await current.stop()
            request.app.state.active_adapter = None

        # Build adapter for this model kind
        if model.node != "local":
            meta = model.backend_meta or {}
            adapter = RemoteNodeAdapter(
                node_url=meta["_remote_url"],
                remote_model_id=meta["_remote_model_id"],
                api_key=meta.get("_remote_api_key", ""),
            )
        elif model.kind == "mlx":
            if config.mlx_external_url:
                adapter = ExternalAdapter(base_url=config.mlx_external_url)
            else:
                adapter = OMLXAdapter(base_url="http://127.0.0.1:8000", model_dir=config.mlx_dir, api_key=config.omlx_api_key)
        elif model.kind == "mlx_studio":
            if not config.mlx_studio_url:
                yield _sse("error", {"data": {"message": "MLX Studio URL not configured in Settings"}})
                return
            adapter = ManagedExternalAdapter(base_url=config.mlx_studio_url)
        elif model.kind == "gguf":
            adapter = LlamaCppAdapter(
                server_path=config.llama_server,
                port=config.llama_port,
            )
        elif model.kind == "ollama":
            adapter = OllamaAdapter(host=config.ollama_host)
        else:
            yield _sse("error", {"data": {"message": f"Unknown kind: {model.kind}"}})
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

    async def _stream():
        # Stop any currently running compare adapter
        current = request.app.state.compare_adapter
        if current and current.is_loaded():
            await current.stop()
            request.app.state.compare_adapter = None

        # Build adapter — GGUF gets separate compare port; MLX reuses oMLX; Ollama is always multi-model
        if model.node != "local":
            meta = model.backend_meta or {}
            adapter = RemoteNodeAdapter(
                node_url=meta["_remote_url"],
                remote_model_id=meta["_remote_model_id"],
                api_key=meta.get("_remote_api_key", ""),
            )
        elif model.kind == "mlx":
            if config.mlx_external_url:
                adapter = ExternalAdapter(base_url=config.mlx_external_url)
            else:
                adapter = OMLXAdapter(base_url="http://127.0.0.1:8000", model_dir=config.mlx_dir, api_key=config.omlx_api_key)
        elif model.kind == "mlx_studio":
            if not config.mlx_studio_url:
                yield _sse("error", {"data": {"message": "MLX Studio URL not configured in Settings"}})
                return
            adapter = ManagedExternalAdapter(base_url=config.mlx_studio_url)
        elif model.kind == "gguf":
            adapter = LlamaCppAdapter(
                server_path=config.llama_server,
                port=config.llama_compare_port,
            )
        elif model.kind == "ollama":
            adapter = OllamaAdapter(host=config.ollama_host)
        else:
            yield _sse("error", {"data": {"message": f"Unknown kind: {model.kind}"}})
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
