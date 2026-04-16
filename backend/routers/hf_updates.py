"""HuggingFace upstream update watcher endpoints."""
from fastapi import APIRouter, Request
from pydantic import BaseModel

import hf_updates
from routers import notifications as notif

router = APIRouter()


class OriginRepoPayload(BaseModel):
    repo_id: str | None  # None clears


@router.get("/hf-updates")
async def list_updates() -> dict:
    state = hf_updates.all_state()
    return {
        "state": state,
        "update_available_count": sum(1 for e in state.values() if e.get("update_available")),
    }


@router.post("/hf-updates/refresh")
async def refresh_updates(request: Request) -> dict:
    registry = request.app.state.registry
    ids = [m.id for m in registry.all() if m.node == "local"]
    newly = await hf_updates.check_models(ids)
    for mid, info in newly.items():
        m = registry.get(mid)
        name = m.name if m else mid
        notif.push(
            title="Model update available",
            message=f"{name} has a new version on {info['origin_repo']}",
            type="info",
            link=f"/models",
        )
    return {
        "newly_flagged": list(newly.keys()),
        "state": hf_updates.all_state(),
    }


@router.get("/models/{model_id:path}/origin-repo")
async def get_origin_repo(model_id: str) -> dict:
    return hf_updates.get_state(model_id)


@router.put("/models/{model_id:path}/origin-repo")
async def set_origin_repo(model_id: str, payload: OriginRepoPayload) -> dict:
    return hf_updates.set_origin_repo(model_id, payload.repo_id)
