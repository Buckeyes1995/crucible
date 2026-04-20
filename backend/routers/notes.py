"""Model notes and tags endpoints."""
from typing import Any
from fastapi import APIRouter
from pydantic import BaseModel

import model_notes

router = APIRouter()


class NotePayload(BaseModel):
    notes: str = ""
    tags: list[str] = []
    # Optional — when omitted, existing capabilities on the model are preserved.
    capabilities: list[str] | None = None
    deprecated: bool | None = None
    replacement_id: str | None = None  # empty string clears the pointer


class HiddenPayload(BaseModel):
    hidden: bool


class PreferredEnginePayload(BaseModel):
    engine: str | None  # None clears the preference


@router.get("/models/{model_id:path}/notes")
async def get_notes(model_id: str) -> dict[str, Any]:
    return model_notes.get_note(model_id)


@router.put("/models/{model_id:path}/notes")
async def set_notes(model_id: str, payload: NotePayload) -> dict[str, Any]:
    return model_notes.set_note(
        model_id, payload.notes, payload.tags,
        capabilities=payload.capabilities,
        deprecated=payload.deprecated,
        replacement_id=payload.replacement_id,
    )


@router.get("/capabilities")
async def list_capabilities() -> dict[str, Any]:
    """Capability taxonomy + per-model assignments."""
    return {
        "taxonomy": model_notes.CAPABILITIES,
        "assignments": model_notes.all_capabilities(),
    }


@router.put("/models/{model_id:path}/hidden")
async def set_hidden(model_id: str, payload: HiddenPayload) -> dict[str, Any]:
    return model_notes.set_hidden(model_id, payload.hidden)


@router.put("/models/{model_id:path}/preferred-engine")
async def set_preferred_engine(model_id: str, payload: PreferredEnginePayload) -> dict[str, Any]:
    return model_notes.set_preferred_engine(model_id, payload.engine)


@router.get("/tags")
async def list_tags() -> list[str]:
    return model_notes.all_tags()
