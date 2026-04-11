import asyncio
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
