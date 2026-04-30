"""Crash/session recovery endpoints."""
import time

from fastapi import APIRouter, Request

import session_persist

router = APIRouter()

# Snapshots older than this are considered stale — the user has moved on,
# offering to restore some model from yesterday is just noise.
RECOVERY_MAX_AGE_S = 24 * 3600


@router.get("/recovery")
async def check(request: Request) -> dict:
    """Return the recoverable snapshot (if any). Frontend polls this once on
    load; if present, shows a banner with a one-click restore.

    Self-heals two noise sources:
    - The snapshot's model is already loaded in the current process (the
      auto-load picked it back up — nothing to restore).
    - The snapshot is older than RECOVERY_MAX_AGE_S — stale; user has moved
      on and probably doesn't want to load a 60GB model from yesterday.
    """
    snap = session_persist.read_recoverable()
    if snap:
        cur = request.app.state.active_adapter
        if cur and cur.is_loaded() and cur.model_id == snap.get("model_id"):
            session_persist.forget_recovery()
            snap = None
    if snap:
        loaded_at = snap.get("loaded_at") or 0
        if loaded_at and (time.time() - loaded_at) > RECOVERY_MAX_AGE_S:
            session_persist.forget_recovery()
            snap = None
    return {"available": snap is not None, "snapshot": snap}


@router.post("/recovery/dismiss")
async def dismiss() -> dict:
    """Clear the recovery snapshot without restoring — user chose to ignore it."""
    session_persist.forget_recovery()
    return {"status": "ok"}


@router.post("/recovery/clean-restore")
async def clean_restore() -> dict:
    """Fresh-start option: clear the recovery snapshot AND wipe transient
    download/history state so the process comes up with a clean slate.
    Does NOT touch chat history or benchmark DB — those are persistent
    user data and deleting them silently would be a trap.

    Returns a summary of what was cleared so the UI can show a toast."""
    session_persist.forget_recovery()
    downloads_cleared = 0
    try:
        from hf_downloader import download_manager
        downloads_cleared = download_manager.clear_finished()
    except Exception:
        pass
    return {"status": "ok", "downloads_cleared": downloads_cleared}
