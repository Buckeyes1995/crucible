"""Favorites router — GET / PUT / POST (toggle one)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

import favorites as _favorites

router = APIRouter()


class FavoritesIn(BaseModel):
    ids: list[str]


class ToggleIn(BaseModel):
    id: str


@router.get("/favorites")
async def get_favorites() -> dict[str, Any]:
    return {"ids": _favorites.load()}


@router.put("/favorites")
async def put_favorites(body: FavoritesIn) -> dict[str, Any]:
    return {"ids": _favorites.save(body.ids)}


@router.post("/favorites/toggle")
async def toggle_favorite(body: ToggleIn) -> dict[str, Any]:
    ids, now = _favorites.toggle(body.id)
    return {"ids": ids, "favorite": now}
