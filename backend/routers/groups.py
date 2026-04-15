"""Model Groups — named collections for batch operations."""

import json
import uuid
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

GROUPS_FILE = Path.home() / ".config" / "crucible" / "model_groups.json"


def _load() -> list[dict]:
    if GROUPS_FILE.exists():
        try:
            return json.loads(GROUPS_FILE.read_text())
        except Exception:
            pass
    return []


def _save(groups: list[dict]):
    GROUPS_FILE.parent.mkdir(parents=True, exist_ok=True)
    GROUPS_FILE.write_text(json.dumps(groups, indent=2))


class GroupCreate(BaseModel):
    name: str
    description: str = ""
    model_ids: list[str] = []


class GroupUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    model_ids: Optional[list[str]] = None


@router.get("/groups")
async def list_groups() -> list[dict]:
    return _load()


@router.post("/groups", status_code=201)
async def create_group(body: GroupCreate) -> dict:
    groups = _load()
    group = {"id": str(uuid.uuid4()), "name": body.name, "description": body.description, "model_ids": body.model_ids}
    groups.append(group)
    _save(groups)
    return group


@router.put("/groups/{group_id}")
async def update_group(group_id: str, body: GroupUpdate) -> dict:
    groups = _load()
    for g in groups:
        if g["id"] == group_id:
            if body.name is not None:
                g["name"] = body.name
            if body.description is not None:
                g["description"] = body.description
            if body.model_ids is not None:
                g["model_ids"] = body.model_ids
            _save(groups)
            return g
    raise HTTPException(404, "Group not found")


@router.delete("/groups/{group_id}", status_code=204)
async def delete_group(group_id: str):
    groups = _load()
    new = [g for g in groups if g["id"] != group_id]
    if len(new) == len(groups):
        raise HTTPException(404, "Group not found")
    _save(new)
