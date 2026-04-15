"""Model Changelog — track when models were added/removed."""
import json, time
from pathlib import Path
from fastapi import APIRouter

router = APIRouter()
CHANGELOG_FILE = Path.home() / ".config" / "crucible" / "model_changelog.json"

def _load():
    if CHANGELOG_FILE.exists():
        try: return json.loads(CHANGELOG_FILE.read_text())
        except: pass
    return []

def _save(entries):
    CHANGELOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CHANGELOG_FILE.write_text(json.dumps(entries[-500:], indent=2))  # Keep last 500

def record_change(model_id: str, model_name: str, action: str, detail: str = ""):
    entries = _load()
    entries.append({"model_id": model_id, "model_name": model_name, "action": action, "detail": detail, "timestamp": time.time()})
    _save(entries)

@router.get("/models/changelog")
async def get_changelog(limit: int = 100):
    entries = _load()
    return entries[-limit:][::-1]  # Most recent first
