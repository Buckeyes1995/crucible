"""DFlash speculative decoding routes — toggle per-model via oMLX admin API."""

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from typing import Optional

from omlx_admin import OMLXAdminClient

router = APIRouter()


def _get_omlx_client(request: Request) -> OMLXAdminClient:
    config = request.app.state.config
    base_url = f"http://127.0.0.1:8000"
    return OMLXAdminClient(base_url=base_url, api_key=config.omlx_api_key)


class DFlashToggle(BaseModel):
    enabled: bool
    draft_quant_bits: Optional[int] = 4


@router.get("/models/{model_id:path}/dflash")
async def get_dflash(model_id: str, request: Request) -> dict:
    """Get DFlash eligibility and status for a model."""
    registry = request.app.state.registry
    model = registry.get(model_id)
    if not model:
        raise HTTPException(404, "Model not found")

    if not model.dflash_draft:
        return {"eligible": False, "enabled": False, "draft_model": None}

    # Check oMLX for current state
    omlx_model_id = model.name  # oMLX uses directory name as model ID
    client = _get_omlx_client(request)
    status = await client.get_dflash_status(omlx_model_id)
    status["eligible"] = True
    status["draft_model"] = model.dflash_draft
    return status


@router.put("/models/{model_id:path}/dflash")
async def toggle_dflash(model_id: str, body: DFlashToggle, request: Request) -> dict:
    """Enable or disable DFlash for a model."""
    registry = request.app.state.registry
    model = registry.get(model_id)
    if not model:
        raise HTTPException(404, "Model not found")

    if not model.dflash_draft:
        raise HTTPException(400, "Model is not DFlash-eligible (no draft model found)")

    omlx_model_id = model.name
    client = _get_omlx_client(request)
    result = await client.set_dflash(
        model_id=omlx_model_id,
        enabled=body.enabled,
        draft_model=model.dflash_draft,
        draft_quant_bits=body.draft_quant_bits,
    )
    if result is None:
        raise HTTPException(502, "Failed to update oMLX settings")

    # Update the model's dflash_enabled in registry
    model.dflash_enabled = body.enabled

    return {
        "model_id": model_id,
        "dflash_enabled": body.enabled,
        "draft_model": model.dflash_draft,
        "settings": result.get("settings", {}),
    }
