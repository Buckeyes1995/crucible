from fastapi import APIRouter, Request
from config import CrucibleConfig, save_config

router = APIRouter()


@router.get("/settings")
async def get_settings(request: Request) -> CrucibleConfig:
    return request.app.state.config


@router.put("/settings")
async def update_settings(request: Request, new_config: CrucibleConfig) -> CrucibleConfig:
    before = request.app.state.config.model_dump() if hasattr(request.app.state.config, "model_dump") else dict(request.app.state.config.__dict__)
    save_config(new_config)
    request.app.state.config = new_config
    await request.app.state.registry.refresh()
    try:
        import audit
        after = new_config.model_dump() if hasattr(new_config, "model_dump") else dict(new_config.__dict__)
        # Shrink to just changed keys so the viewer isn't a wall of unchanged paths.
        diff = {k: {"before": before.get(k), "after": after.get(k)}
                for k in set(before) | set(after) if before.get(k) != after.get(k)}
        if diff:
            audit.record(
                actor=request.headers.get("x-forwarded-for") or (request.client.host if request.client else "local"),
                action="settings.update",
                before={k: v["before"] for k, v in diff.items()},
                after={k: v["after"] for k, v in diff.items()},
            )
    except Exception:
        pass
    return new_config
