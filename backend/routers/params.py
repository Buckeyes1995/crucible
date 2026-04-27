"""Per-model parameter endpoints."""
import logging
from typing import Any
from fastapi import APIRouter, Request
from pydantic import BaseModel

import model_params

log = logging.getLogger(__name__)

router = APIRouter()


def _sync_clients(request: Request) -> None:
    """Regenerate ~/.pi/agent/models.json and opencode's models block so
    param changes (especially context_window / max_tokens) propagate to
    pi.dev and opencode without requiring a manual sync. Best-effort —
    a failure here must not poison the params PUT response."""
    try:
        from clients import regenerate_opencode_models, regenerate_pi_models
        registry = request.app.state.registry
        regenerate_opencode_models(registry, model_params.get_params)
        regenerate_pi_models(registry, model_params.get_params)
    except Exception as e:
        log.warning("params: client config sync failed: %s", e)


class ModelParams(BaseModel):
    # Inference (all backends)
    temperature: float | None = None
    max_tokens: int | None = None
    context_window: int | None = None
    top_k: int | None = None
    top_p: float | None = None
    min_p: float | None = None
    repetition_penalty: float | None = None
    presence_penalty: float | None = None
    # Qwen3.5/3.6 chat-template kwargs (passed as chat_template_kwargs to the server)
    enable_thinking: bool | None = None
    preserve_thinking: bool | None = None
    # MLX-specific
    cache_limit_gb: float | None = None
    num_draft_tokens: int | None = None
    # GGUF-specific
    batch_size: int | None = None
    ubatch_size: int | None = None
    threads: int | None = None
    flash_attn: bool | None = None
    cache_type_k: str | None = None
    cache_type_v: str | None = None
    # Auto-unload after N minutes of inactivity (0 = never)
    ttl_minutes: int | None = None
    # Extra passthrough flags (adapter appends these verbatim to the subprocess cmd)
    extra_args: list[str] = []


@router.get("/params/defaults")
async def get_defaults() -> dict[str, Any]:
    return model_params.get_defaults()


@router.put("/params/defaults")
async def set_defaults(params: ModelParams, request: Request) -> dict[str, Any]:
    data = {k: v for k, v in params.model_dump().items() if v is not None and v != []}
    result = model_params.set_defaults(data)
    _sync_clients(request)
    return result


@router.delete("/params/defaults")
async def reset_defaults(request: Request) -> dict[str, str]:
    model_params.set_defaults({})
    _sync_clients(request)
    return {"status": "reset"}


@router.get("/models/{model_id:path}/params")
async def get_params(model_id: str) -> dict[str, Any]:
    # Return raw per-model params only (UI shows defaults separately)
    return model_params.get_params_raw(model_id)


@router.put("/models/{model_id:path}/params")
async def set_params(model_id: str, params: ModelParams, request: Request) -> dict[str, Any]:
    data = {k: v for k, v in params.model_dump().items() if v is not None and v != []}
    result = model_params.set_params(model_id, data)
    _sync_clients(request)
    return result


@router.delete("/models/{model_id:path}/params")
async def reset_params(model_id: str, request: Request) -> dict[str, str]:
    model_params.delete_params(model_id)
    _sync_clients(request)
    return {"status": "reset"}
