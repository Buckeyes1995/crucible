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


def _backfill_update_meta(registry) -> int:
    """Stamp the new meta payload onto pre-existing 'Model update available'
    notifications that were pushed before we started including structured
    metadata. Matches by parsing the message text and looking the model up in
    the registry by display name. Returns the count updated."""
    state = hf_updates.all_state()
    notifs = notif._load()
    by_name = {m.name: m for m in registry.all() if m.node == "local"}
    updated = 0
    for n in notifs:
        if n.get("title") != "Model update available":
            continue
        if n.get("meta"):
            continue
        msg = n.get("message", "")
        # Expected format: "<name> has a new version on <origin_repo>"
        marker = " has a new version on "
        if marker not in msg:
            continue
        name, origin_repo = msg.split(marker, 1)
        name = name.strip()
        origin_repo = origin_repo.strip()
        m = by_name.get(name)
        if not m:
            continue
        # Only attach meta if the model is still flagged — stale notifications
        # for models the user already updated get left alone.
        if not state.get(m.id, {}).get("update_available"):
            continue
        n["meta"] = {
            "kind": "model_update",
            "model_id": m.id,
            "model_kind": m.kind,
            "repo_id": origin_repo,
        }
        updated += 1
    if updated:
        notif._save(notifs)
    return updated


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
            link="/models",
            meta={"kind": "model_update",
                  "model_id": mid,
                  "model_kind": (m.kind if m else "mlx"),
                  "repo_id": info["origin_repo"]},
        )
    backfilled = _backfill_update_meta(registry)
    return {
        "newly_flagged": list(newly.keys()),
        "backfilled": backfilled,
        "state": hf_updates.all_state(),
    }


@router.get("/models/{model_id:path}/origin-repo")
async def get_origin_repo(model_id: str) -> dict:
    return hf_updates.get_state(model_id)


@router.put("/models/{model_id:path}/origin-repo")
async def set_origin_repo(model_id: str, payload: OriginRepoPayload) -> dict:
    return hf_updates.set_origin_repo(model_id, payload.repo_id)
