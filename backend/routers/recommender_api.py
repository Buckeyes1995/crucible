"""Model Recommender API."""

from fastapi import APIRouter, Request

import recommender

router = APIRouter()


@router.get("/recommender")
async def get_recommendations(request: Request) -> dict:
    registry = request.app.state.registry
    # Get total RAM from psutil
    try:
        import psutil
        total_ram_gb = psutil.virtual_memory().total / 1e9
    except Exception:
        total_ram_gb = 96.0
    return await recommender.analyze(registry, total_ram_gb)
