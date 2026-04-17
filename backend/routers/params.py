"""Per-model parameter endpoints."""
from typing import Any
from fastapi import APIRouter
from pydantic import BaseModel

import model_params

router = APIRouter()


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
async def set_defaults(params: ModelParams) -> dict[str, Any]:
    data = {k: v for k, v in params.model_dump().items() if v is not None and v != []}
    return model_params.set_defaults(data)


@router.delete("/params/defaults")
async def reset_defaults() -> dict[str, str]:
    model_params.set_defaults({})
    return {"status": "reset"}


@router.get("/models/{model_id:path}/params")
async def get_params(model_id: str) -> dict[str, Any]:
    # Return raw per-model params only (UI shows defaults separately)
    return model_params.get_params_raw(model_id)


@router.put("/models/{model_id:path}/params")
async def set_params(model_id: str, params: ModelParams) -> dict[str, Any]:
    data = {k: v for k, v in params.model_dump().items() if v is not None and v != []}
    return model_params.set_params(model_id, data)


@router.delete("/models/{model_id:path}/params")
async def reset_params(model_id: str) -> dict[str, str]:
    model_params.delete_params(model_id)
    return {"status": "reset"}
