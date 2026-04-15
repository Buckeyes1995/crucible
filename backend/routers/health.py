"""Health Check — status of all backends, ports, connections."""
import asyncio
import httpx
from fastapi import APIRouter, Request

router = APIRouter()

async def _check_port(url: str, timeout: float = 3.0) -> dict:
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(url)
            return {"url": url, "status": "up", "code": r.status_code}
    except Exception as e:
        return {"url": url, "status": "down", "error": str(e)[:100]}

@router.get("/health/check")
async def health_check(request: Request) -> dict:
    cfg = request.app.state.config
    checks = []

    # oMLX / MLX External
    omlx_url = cfg.mlx_external_url or "http://127.0.0.1:8000"
    checks.append(("oMLX", f"{omlx_url}/health"))

    # Ollama
    if cfg.ollama_host:
        checks.append(("Ollama", f"{cfg.ollama_host}/api/tags"))

    # MLX Studio
    if cfg.mlx_studio_url:
        checks.append(("MLX Studio", f"{cfg.mlx_studio_url}/v1/models"))

    # Remote nodes
    for node in cfg.nodes:
        checks.append((f"Node: {node.name}", f"{node.url.rstrip('/')}/api/status"))

    results = await asyncio.gather(*[_check_port(url) for _, url in checks])
    services = []
    for (name, _), result in zip(checks, results):
        services.append({"name": name, **result})

    # Crucible itself
    adapter = request.app.state.active_adapter
    services.insert(0, {
        "name": "Crucible",
        "url": "http://localhost:7777",
        "status": "up",
        "active_model": adapter.model_id if adapter and adapter.is_loaded() else None,
    })

    all_up = all(s["status"] == "up" for s in services)
    return {"overall": "healthy" if all_up else "degraded", "services": services}
