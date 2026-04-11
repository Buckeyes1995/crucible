import asyncio
import time
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from benchmark.metrics import get_memory_pressure, get_thermal_state
from model_params import get_params
import psutil

router = APIRouter()


@router.websocket("/ws/metrics")
async def metrics_ws(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            app = websocket.scope["app"]
            adapter = app.state.active_adapter
            registry = app.state.registry

            tps = getattr(adapter, "last_tps", None) if adapter else None
            prompt_tps = getattr(adapter, "last_prompt_tps", None) if adapter else None
            ttft = getattr(adapter, "last_ttft_ms", None) if adapter else None

            mem_pressure = await asyncio.get_event_loop().run_in_executor(
                None, get_memory_pressure
            )
            thermal = await asyncio.get_event_loop().run_in_executor(
                None, get_thermal_state
            )

            vm = psutil.virtual_memory()

            # Model info + active params
            model_info = None
            if adapter and adapter.is_loaded() and adapter.model_id:
                model_id = adapter.model_id
                entry = registry.get(model_id)
                params = get_params(model_id)
                model_info = {
                    "id": model_id,
                    "name": entry.name if entry else model_id,
                    "kind": entry.kind if entry else None,
                    "quant": entry.quant if entry else None,
                    "context_window": entry.context_window if entry else None,
                    "size_bytes": entry.size_bytes if entry else None,
                    "params": {
                        "temperature": params.get("temperature"),
                        "max_tokens": params.get("max_tokens"),
                        "top_k": params.get("top_k"),
                        "top_p": params.get("top_p"),
                        "min_p": params.get("min_p"),
                        "repetition_penalty": params.get("repetition_penalty"),
                        "context_window": params.get("context_window"),
                        "ttl_minutes": params.get("ttl_minutes"),
                    },
                }

            payload = {
                "ts": time.time(),
                "tps": tps,
                "prompt_tps": prompt_tps,
                "ttft_ms": ttft,
                "memory_pressure": mem_pressure,
                "memory_used_gb": round(vm.used / (1024**3), 2),
                "memory_total_gb": round(vm.total / (1024**3), 2),
                "thermal": thermal,
                "active_model": adapter.model_id if adapter and adapter.is_loaded() else None,
                "model_info": model_info,
            }
            await websocket.send_json(payload)
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        pass
