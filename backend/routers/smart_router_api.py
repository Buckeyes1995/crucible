"""Smart Router API — configure and test prompt routing."""

from fastapi import APIRouter, Request
from pydantic import BaseModel

import smart_router

router = APIRouter()


@router.get("/smart-router/config")
async def get_config() -> dict:
    return smart_router.get_config()


@router.put("/smart-router/config")
async def save_config(body: dict) -> dict:
    smart_router.save_config(body)
    return {"status": "saved"}


class ClassifyRequest(BaseModel):
    prompt: str


@router.post("/smart-router/classify")
async def classify(body: ClassifyRequest, request: Request) -> dict:
    """Classify a prompt and show which model would be selected."""
    scores = smart_router.classify_prompt(body.prompt)
    registry = request.app.state.registry
    available = [
        {"name": m.name, "kind": m.kind, "size_bytes": m.size_bytes, "node": m.node}
        for m in registry.all()
    ]
    selected = smart_router.select_model(body.prompt, available)
    return {
        "scores": scores,
        "selected_model": selected,
        "category": max(scores, key=scores.get) if scores else None,
    }
