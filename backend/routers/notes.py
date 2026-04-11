"""Model notes and tags endpoints."""
from typing import Any
from fastapi import APIRouter
from pydantic import BaseModel

import model_notes

router = APIRouter()


class NotePayload(BaseModel):
    notes: str = ""
    tags: list[str] = []


@router.get("/models/{model_id:path}/notes")
async def get_notes(model_id: str) -> dict[str, Any]:
    return model_notes.get_note(model_id)


@router.put("/models/{model_id:path}/notes")
async def set_notes(model_id: str, payload: NotePayload) -> dict[str, Any]:
    return model_notes.set_note(model_id, payload.notes, payload.tags)


@router.get("/tags")
async def list_tags() -> list[str]:
    return model_notes.all_tags()
