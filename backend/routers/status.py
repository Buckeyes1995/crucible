import asyncio
import httpx
from fastapi import APIRouter, Request
from benchmark.metrics import get_memory_pressure, get_thermal_state

router = APIRouter()


def _get_memory_bytes() -> dict:
    try:
        import psutil
        m = psutil.virtual_memory()
        return {"total_bytes": m.total, "available_bytes": m.available}
    except Exception:
        return {"total_bytes": 0, "available_bytes": 0}


@router.get("/status")
async def get_status(request: Request) -> dict:
    adapter = request.app.state.active_adapter
    mem, thermal = await asyncio.gather(
        asyncio.get_event_loop().run_in_executor(None, get_memory_pressure),
        asyncio.get_event_loop().run_in_executor(None, get_thermal_state),
    )
    mem_bytes = _get_memory_bytes()
    compare = request.app.state.compare_adapter
    return {
        "active_model_id": adapter.model_id if adapter and adapter.is_loaded() else None,
        "compare_model_id": compare.model_id if compare and compare.is_loaded() else None,
        "engine_state": "loaded" if adapter and adapter.is_loaded() else "idle",
        "memory_pressure": mem,
        "thermal_state": thermal,
        "total_memory_bytes": mem_bytes["total_bytes"],
        "available_memory_bytes": mem_bytes["available_bytes"],
    }


@router.get("/nodes")
async def list_nodes(request: Request) -> list[dict]:
    """Return connectivity status for all configured remote nodes."""
    nodes = request.app.state.config.nodes

    async def _check(node) -> dict:
        info = {"name": node.name, "url": node.url, "status": "offline", "model_count": 0, "active_model_id": None}
        headers = {"X-API-Key": node.api_key} if node.api_key else {}
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                r = await client.get(f"{node.url.rstrip('/')}/api/status", headers=headers)
                if r.status_code == 200:
                    info["status"] = "online"
                    data = r.json()
                    info["active_model_id"] = data.get("active_model_id")
                    info["memory_pressure"] = data.get("memory_pressure")
                    info["thermal_state"] = data.get("thermal_state")
                r2 = await client.get(f"{node.url.rstrip('/')}/api/models", headers=headers)
                if r2.status_code == 200:
                    local_models = [m for m in r2.json() if m.get("node", "local") == "local"]
                    info["model_count"] = len(local_models)
        except Exception:
            pass
        return info

    if not nodes:
        return []
    return list(await asyncio.gather(*(_check(n) for n in nodes)))
