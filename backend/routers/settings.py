from fastapi import APIRouter, Request
from config import CrucibleConfig, save_config

router = APIRouter()


@router.get("/settings")
async def get_settings(request: Request) -> CrucibleConfig:
    return request.app.state.config


@router.put("/settings")
async def update_settings(request: Request, new_config: CrucibleConfig) -> CrucibleConfig:
    save_config(new_config)
    request.app.state.config = new_config
    # Refresh registry with new dirs
    await request.app.state.registry.refresh()
    return new_config
