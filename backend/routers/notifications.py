"""Notification Center — in-app notification feed."""
import json, time, uuid
from pathlib import Path
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

router = APIRouter()
NOTIF_FILE = Path.home() / ".config" / "crucible" / "notifications.json"

def _load():
    if NOTIF_FILE.exists():
        try: return json.loads(NOTIF_FILE.read_text())
        except: pass
    return []

def _save(notifs):
    NOTIF_FILE.parent.mkdir(parents=True, exist_ok=True)
    NOTIF_FILE.write_text(json.dumps(notifs[-200:], indent=2))

def push(title: str, message: str, type: str = "info", link: str = ""):
    """Push a notification (called from other modules)."""
    notifs = _load()
    notifs.append({"id": str(uuid.uuid4()), "title": title, "message": message, "type": type, "link": link, "read": False, "ts": time.time()})
    _save(notifs)

@router.get("/notifications")
async def list_notifications(unread_only: bool = False):
    notifs = _load()
    if unread_only:
        notifs = [n for n in notifs if not n.get("read")]
    return notifs[-50:][::-1]

@router.post("/notifications/{notif_id}/read")
async def mark_read(notif_id: str):
    notifs = _load()
    for n in notifs:
        if n["id"] == notif_id:
            n["read"] = True
            _save(notifs)
            return {"status": "ok"}
    return {"status": "not_found"}

@router.post("/notifications/read-all")
async def mark_all_read():
    notifs = _load()
    for n in notifs:
        n["read"] = True
    _save(notifs)
    return {"status": "ok"}

@router.get("/notifications/count")
async def unread_count():
    notifs = _load()
    return {"unread": sum(1 for n in notifs if not n.get("read"))}
