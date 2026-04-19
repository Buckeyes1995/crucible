"""Crash/session recovery endpoints."""
from fastapi import APIRouter

import session_persist

router = APIRouter()


@router.get("/recovery")
async def check() -> dict:
    """Return the recoverable snapshot (if any). Frontend polls this once on
    load; if present, shows a banner with a one-click restore."""
    snap = session_persist.read_recoverable()
    return {"available": snap is not None, "snapshot": snap}


@router.post("/recovery/dismiss")
async def dismiss() -> dict:
    """Clear the recovery snapshot without restoring — user chose to ignore it."""
    session_persist.forget_recovery()
    return {"status": "ok"}
