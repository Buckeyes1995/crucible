"""Inference profiler API — view per-request performance data."""

from fastapi import APIRouter
from typing import Optional

import profiler

router = APIRouter()


@router.get("/profiler/profiles")
async def list_profiles(model_id: Optional[str] = None, limit: int = 100) -> list[dict]:
    return await profiler.get_profiles(model_id, limit)


@router.get("/profiler/stats")
async def model_stats() -> list[dict]:
    return await profiler.get_model_stats()
