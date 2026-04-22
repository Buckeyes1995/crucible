"""Snippet library router."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import snippets

router = APIRouter()


class CreateRequest(BaseModel):
    title: str = ""
    content: str
    source: str = "chat"
    tags: list[str] = []
    model_id: str | None = None
    project_id: str | None = None


class UpdateRequest(BaseModel):
    title: str | None = None
    content: str | None = None
    tags: list[str] | None = None
    project_id: str | None = None


@router.get("/snippets")
async def list_snippets(project: str | None = None) -> list[dict]:
    return snippets.list_snippets(project_id=project)


@router.post("/snippets", status_code=201)
async def create(body: CreateRequest) -> dict:
    if not body.content.strip():
        raise HTTPException(400, "content is required")
    return snippets.create(
        title=body.title, content=body.content, source=body.source,
        tags=body.tags, model_id=body.model_id, project_id=body.project_id,
    )


@router.put("/snippets/{snippet_id}")
async def update(snippet_id: str, body: UpdateRequest) -> dict:
    fields = body.model_dump(exclude_none=True)
    updated = snippets.update(snippet_id, **fields)
    if not updated:
        raise HTTPException(404, "snippet not found")
    return updated


@router.delete("/snippets/{snippet_id}")
async def delete(snippet_id: str) -> dict:
    if not snippets.delete(snippet_id):
        raise HTTPException(404, "snippet not found")
    return {"status": "deleted"}


@router.get("/snippet-tags")
async def list_tags() -> list[str]:
    return snippets.all_tags()
