"""Memory pressure planner — answer "can I load these models simultaneously?"
before the user tries and OOMs.

The honest math: MLX models mmap their weights into unified memory, so the
size-on-disk is a decent proxy for resident RSS. We add a small overhead per
loaded model (KV cache + activations) and compare against available memory.
vLLM + llama.cpp behave similarly enough for a first-cut estimate; ollama is
opaque but we include its reported size as best-effort.
"""
from __future__ import annotations

import psutil
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()

# Soft per-model overhead for KV cache, activations, and assorted housekeeping.
# Deliberately round; if the planner says "fits with 4 GB headroom" the user
# shouldn't trust it to within 500 MB anyway.
OVERHEAD_PER_MODEL = 2 * 1024 * 1024 * 1024  # 2 GiB

# Safety cushion we don't let the user reserve — OS + other apps need room.
SYSTEM_HEADROOM = 8 * 1024 * 1024 * 1024  # 8 GiB


class PlanRequest(BaseModel):
    model_ids: list[str]


@router.post("/mem-plan")
async def plan(request: Request, body: PlanRequest) -> dict:
    registry = request.app.state.registry
    mem = psutil.virtual_memory()
    total_bytes = mem.total
    available_bytes = mem.available

    models = []
    required_bytes = 0
    for mid in body.model_ids:
        m = registry.get(mid)
        if not m:
            raise HTTPException(404, f"model not found: {mid}")
        size = int(m.size_bytes or 0)
        models.append({
            "id": m.id,
            "name": m.name,
            "kind": m.kind,
            "size_bytes": size,
            "overhead_bytes": OVERHEAD_PER_MODEL,
        })
        required_bytes += size + OVERHEAD_PER_MODEL

    budget_bytes = max(0, total_bytes - SYSTEM_HEADROOM)
    headroom_bytes = budget_bytes - required_bytes
    fits = headroom_bytes >= 0

    return {
        "total_bytes": total_bytes,
        "available_bytes": available_bytes,
        "system_headroom_bytes": SYSTEM_HEADROOM,
        "budget_bytes": budget_bytes,
        "required_bytes": required_bytes,
        "headroom_bytes": headroom_bytes,
        "fits": fits,
        "models": models,
        "overhead_per_model_bytes": OVERHEAD_PER_MODEL,
    }
