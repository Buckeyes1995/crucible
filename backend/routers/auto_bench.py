"""Auto-bench admin endpoints — trigger a quick benchmark for any local model,
useful for T10-style verification ("did the post-download hook actually fire
and land results?"). Reads / writes the same results file the download hook
uses.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

import auto_bench

router = APIRouter()


class _FakeJob:
    """Minimal DownloadJob-shaped object for calling on_download_complete
    on a model we didn't just download (e.g. to re-benchmark an existing one)."""
    def __init__(self, model_name: str, dest_dir: str, kind: str, repo_id: str) -> None:
        self.repo_id = repo_id
        self.dest_dir = dest_dir
        self.kind = kind


class TriggerRequest(BaseModel):
    model_id: str


@router.post("/auto-bench/trigger")
async def trigger(body: TriggerRequest, request: Request) -> dict[str, Any]:
    """Fire the auto-bench flow for an already-present model. Returns
    immediately; the bench runs in the background via on_download_complete.
    Poll /api/auto-bench/results to see when it lands."""
    registry = getattr(request.app.state, "registry", None)
    if registry is None:
        raise HTTPException(500, "registry unavailable")
    model = registry.get(body.model_id)
    if not model:
        raise HTTPException(404, f"model not found: {body.model_id}")
    if model.kind != "mlx":
        raise HTTPException(400, "auto-bench currently supports MLX only")
    path = Path(model.path or "")
    if not path.exists():
        raise HTTPException(400, f"model path missing: {path}")
    fake_job = _FakeJob(
        model_name=path.name, dest_dir=str(path),
        kind="mlx", repo_id=path.name,
    )
    import asyncio
    asyncio.create_task(auto_bench.on_download_complete(fake_job))
    return {"status": "started", "model_id": body.model_id, "model_name": path.name}


@router.get("/auto-bench/results")
async def results() -> list[dict]:
    """Recent auto-bench results, newest first. Each entry has model_name,
    avg_tps, ran_at, and the individual per-prompt results."""
    return sorted(auto_bench._load_results(), key=lambda r: -r.get("ran_at_ts", 0))
