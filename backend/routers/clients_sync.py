"""Manual sync trigger for external coding-agent configs.

Crucible auto-syncs opencode + pi configs on model refresh + load-done,
but this endpoint lets you force-sync when you've tweaked per-model
params in the UI and want the change to land in opencode / pi
immediately.

Paired with `scripts/sync-clients.sh` for a one-line shell call."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

router = APIRouter()


@router.post("/clients/sync-configs")
async def sync_configs(request: Request) -> dict[str, Any]:
    """Rebuild opencode.json + ~/.pi/agent/models.json from the current
    Crucible registry + per-model params. Returns per-client counts."""
    try:
        from clients import regenerate_opencode_models, regenerate_pi_models
        from model_params import get_params
    except Exception as e:
        return {"ok": False, "error": str(e)}

    registry = request.app.state.registry
    opencode_count = 0
    pi_count = 0
    errors: list[str] = []
    try:
        opencode_count = regenerate_opencode_models(registry, get_params)
    except Exception as e:
        errors.append(f"opencode: {e}")
    try:
        pi_count = regenerate_pi_models(registry, get_params)
    except Exception as e:
        errors.append(f"pi: {e}")

    try:
        import audit
        audit.record(
            actor=request.headers.get("x-forwarded-for") or (request.client.host if request.client else "local"),
            action="clients.sync",
            meta={"opencode": opencode_count, "pi": pi_count, "errors": errors},
        )
    except Exception:
        pass

    return {
        "ok": not errors,
        "opencode_models_written": opencode_count,
        "pi_models_written": pi_count,
        "errors": errors,
    }
