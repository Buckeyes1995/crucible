"""Small cross-cutting endpoints — local gists, reading-level, etc.
One router keeps the main.py import list shallow for tiny features."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

import gists
import textutil

router = APIRouter()


# ── Gists ──────────────────────────────────────────────────────────────────

@router.get("/gists")
async def list_gists() -> list[dict]:
    return gists.list_gists()


class GistCreate(BaseModel):
    title: str
    content: str
    tags: list[str] = []


@router.post("/gists", status_code=201)
async def create_gist(body: GistCreate) -> dict:
    if not body.content.strip():
        raise HTTPException(400, "content is required")
    return gists.create(body.title or "Untitled", body.content, body.tags)


@router.get("/gists/{slug}")
async def read_gist(slug: str):
    got = gists.read(slug)
    if not got:
        raise HTTPException(404, "gist not found")
    entry, content = got
    return {"entry": entry, "content": content}


@router.get("/gists/{slug}/raw", response_class=PlainTextResponse)
async def read_gist_raw(slug: str) -> str:
    """Raw markdown, for wget / curl / sharing a URL."""
    got = gists.read(slug)
    if not got:
        raise HTTPException(404, "gist not found")
    return got[1]


@router.delete("/gists/{slug}")
async def delete_gist(slug: str) -> dict:
    if not gists.delete(slug):
        raise HTTPException(404, "gist not found")
    return {"status": "deleted"}


# ── Text analysis ──────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    text: str


@router.post("/textutil/reading-level")
async def reading_level(body: AnalyzeRequest) -> dict:
    return textutil.flesch_kincaid_grade(body.text or "")


# ── Wishlist / load timings / changelog ────────────────────────────────────

import model_extras


@router.get("/wishlist")
async def list_wishlist() -> list[dict]:
    return model_extras.wishlist_all()


class WishlistAdd(BaseModel):
    repo_id: str
    kind: str = "mlx"
    note: str = ""


@router.post("/wishlist", status_code=201)
async def add_wishlist(body: WishlistAdd) -> dict:
    return model_extras.wishlist_add(body.repo_id, body.kind, body.note)


@router.delete("/wishlist/{repo_id:path}")
async def remove_wishlist(repo_id: str) -> dict:
    if not model_extras.wishlist_remove(repo_id):
        raise HTTPException(404, "not on wishlist")
    return {"status": "removed"}


@router.get("/load-timings")
async def get_load_timings() -> dict[str, dict]:
    return model_extras.timings_summary()


@router.get("/load-timings/{model_id:path}/predict")
async def predict_load(model_id: str, size_bytes: int | None = None) -> dict:
    return {
        "model_id": model_id,
        "predicted_ms": model_extras.predicted_load_ms(model_id, size_bytes),
    }


import cron_workflows
import notification_routes


@router.get("/cron-workflows")
async def list_cron_workflows() -> list[dict]:
    return cron_workflows.list_schedules()


class CronCreate(BaseModel):
    workflow_id: str
    cadence: str                       # "hourly" | "daily" | "weekly"
    hour: int | None = None
    minute: int | None = None
    days: list[int] | None = None
    values: dict = {}


@router.post("/cron-workflows", status_code=201)
async def add_cron_workflow(body: CronCreate) -> dict:
    return cron_workflows.add_schedule(
        body.workflow_id, body.cadence, body.hour, body.minute,
        body.days, body.values,
    )


class CronUpdate(BaseModel):
    workflow_id: str | None = None
    cadence: str | None = None
    hour: int | None = None
    minute: int | None = None
    days: list[int] | None = None
    values: dict | None = None
    enabled: bool | None = None


@router.put("/cron-workflows/{sched_id}")
async def update_cron_workflow(sched_id: str, body: CronUpdate) -> dict:
    r = cron_workflows.update_schedule(sched_id, **body.model_dump(exclude_none=True))
    if not r:
        raise HTTPException(404, "schedule not found")
    return r


@router.delete("/cron-workflows/{sched_id}")
async def delete_cron_workflow(sched_id: str) -> dict:
    if not cron_workflows.delete_schedule(sched_id):
        raise HTTPException(404, "schedule not found")
    return {"status": "deleted"}


@router.get("/notification-routes")
async def list_notification_routes() -> list[dict]:
    return notification_routes.list_routes()


class RouteCreate(BaseModel):
    name: str
    event: str
    target: dict                       # {kind, url, ...}


@router.post("/notification-routes", status_code=201)
async def add_notification_route(body: RouteCreate) -> dict:
    return notification_routes.add_route(body.name, body.event, body.target)


@router.put("/notification-routes/{route_id}")
async def update_notification_route(route_id: str, body: dict) -> dict:
    r = notification_routes.update_route(route_id, **body)
    if not r:
        raise HTTPException(404, "route not found")
    return r


@router.delete("/notification-routes/{route_id}")
async def delete_notification_route(route_id: str) -> dict:
    if not notification_routes.delete_route(route_id):
        raise HTTPException(404, "route not found")
    return {"status": "deleted"}


class ClassifyRequest(BaseModel):
    message: str


@router.post("/errors/classify")
async def classify_error(body: ClassifyRequest) -> dict:
    import errors
    return errors.classify(body.message)


@router.get("/rate-limits")
async def get_rate_limits() -> dict:
    import rate_limit
    return rate_limit.current_limits()


class RateLimitUpdate(BaseModel):
    # Shape: {key_tag: {rps, burst}}. key_tag "default" applies to all
    # callers without a more specific entry.
    limits: dict[str, dict]


@router.put("/rate-limits")
async def set_rate_limits(body: RateLimitUpdate) -> dict:
    import rate_limit
    rate_limit.update_limits(body.limits)
    return rate_limit.current_limits()


@router.get("/usage")
async def usage(days: int = 30) -> dict:
    import usage_tracker
    return usage_tracker.summary(days)


class QuantAdvise(BaseModel):
    param_count_billion: float
    ram_budget_gb: float


@router.post("/quant-advisor")
async def quant_advise(body: QuantAdvise) -> dict:
    import quant_advisor
    return quant_advisor.suggest(body.param_count_billion, body.ram_budget_gb)


class FolderPinSet(BaseModel):
    folder: str
    model_id: str


@router.get("/folder-pins")
async def list_folder_pins() -> list[dict]:
    import folder_pins
    return folder_pins.list_pins()


@router.post("/folder-pins")
async def set_folder_pin(body: FolderPinSet) -> dict:
    import folder_pins
    return folder_pins.set_pin(body.folder, body.model_id)


@router.delete("/folder-pins")
async def remove_folder_pin(folder: str) -> dict:
    import folder_pins
    if not folder_pins.remove_pin(folder):
        raise HTTPException(404, "no pin for that folder")
    return {"status": "removed"}


@router.get("/folder-pins/resolve")
async def resolve_folder_pin(cwd: str) -> dict:
    import folder_pins
    got = folder_pins.resolve(cwd)
    return {"cwd": cwd, "match": got}


class GitContextRequest(BaseModel):
    path: str
    max_diff_lines: int = 400


@router.post("/git/context")
async def git_context(body: GitContextRequest) -> dict:
    """Pull git status/diff/log for a local repo. Used to give a model
    context for commit-message / PR-description requests. Everything stays
    local — nothing is shipped to a remote service."""
    import git_context as gc
    return gc.context(body.path, body.max_diff_lines)


@router.get("/models/{model_id:path}/changelog")
async def model_changelog(model_id: str) -> dict:
    """Pass-through to HF repo commit history. Resolves the repo from the
    model's origin_repo (set via Notes or auto-filled on download)."""
    import hf_updates
    state = hf_updates.all_state()
    entry = state.get(model_id) or {}
    repo = entry.get("origin_repo")
    if not repo:
        raise HTTPException(
            404,
            "no origin HF repo configured — set it in the Notes dialog first",
        )
    commits = await model_extras.fetch_changelog(repo)
    return {"repo_id": repo, "commits": commits}
