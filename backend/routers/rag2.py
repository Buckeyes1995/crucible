"""RAG v2 router (Roadmap v4 #2) — create named indexes over directories,
query them with BM25.  Paired with backend/rag2.py."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import rag2

router = APIRouter()


class CreateIndex(BaseModel):
    name: str
    source_dir: str


class QueryRequest(BaseModel):
    q: str
    top_k: int = 8


@router.get("/rag2/indexes")
async def list_indexes() -> list[dict[str, Any]]:
    return rag2.list_indexes()


@router.post("/rag2/indexes", status_code=201)
async def create_index(body: CreateIndex) -> dict[str, Any]:
    try:
        return rag2.create_index(body.name.strip(), body.source_dir)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/rag2/indexes/{slug}")
async def get_index(slug: str) -> dict[str, Any]:
    got = rag2.get_index(slug)
    if not got:
        raise HTTPException(404, "Index not found")
    return got


@router.post("/rag2/indexes/{slug}/query")
async def query_index(slug: str, body: QueryRequest) -> dict[str, Any]:
    if not rag2.get_index(slug):
        raise HTTPException(404, "Index not found")
    results = rag2.query(slug, body.q, top_k=max(1, min(body.top_k, 40)))
    return {"results": results, "count": len(results)}


@router.delete("/rag2/indexes/{slug}")
async def delete_index(slug: str) -> dict[str, Any]:
    if not rag2.delete_index(slug):
        raise HTTPException(404, "Index not found")
    return {"status": "deleted"}
