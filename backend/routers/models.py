import asyncio
import json
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse

from adapters.omlx import OMLXAdapter
from adapters.mlx_lm import MLXAdapter
from adapters.llama_cpp import LlamaCppAdapter
from adapters.ollama import OllamaAdapter
from adapters.external import ExternalAdapter
from models.schemas import ModelEntry
from clients import sync_opencode
import webhooks as wh

router = APIRouter()


def _sse(event: str, data: dict) -> str:
    return f"data: {json.dumps({'event': event, **data})}\n\n"


@router.get("/models", response_model=list[ModelEntry])
async def list_models(request: Request) -> list[ModelEntry]:
    return request.app.state.registry.all()


@router.post("/models/refresh", response_model=list[ModelEntry])
async def refresh_models(request: Request) -> list[ModelEntry]:
    await request.app.state.registry.refresh()
    return request.app.state.registry.all()


@router.post("/models/stop")
async def stop_model(request: Request) -> dict:
    adapter = request.app.state.active_adapter
    if adapter:
        model_id = adapter.model_id
        await adapter.stop()
        request.app.state.active_adapter = None
        sync_opencode(None)
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
        if model.kind == "mlx":
            if config.mlx_external_url:
                adapter = ExternalAdapter(base_url=config.mlx_external_url)
            else:
                adapter = OMLXAdapter(base_url="http://127.0.0.1:8000", model_dir=config.mlx_dir)
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
                sync_opencode(model_id, base_url="http://127.0.0.1:7777/v1")
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
        if model.kind == "mlx":
            if config.mlx_external_url:
                adapter = ExternalAdapter(base_url=config.mlx_external_url)
            else:
                adapter = OMLXAdapter(base_url="http://127.0.0.1:8000", model_dir=config.mlx_dir)
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
