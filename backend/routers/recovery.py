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
