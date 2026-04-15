"""Uptime Tracker — track model load durations."""
import json, time
from pathlib import Path
from fastapi import APIRouter, Request

router = APIRouter()
UPTIME_FILE = Path.home() / ".config" / "crucible" / "uptime_log.json"

def _load():
    if UPTIME_FILE.exists():
        try: return json.loads(UPTIME_FILE.read_text())
        except: pass
    return []

def _save(entries):
    UPTIME_FILE.parent.mkdir(parents=True, exist_ok=True)
    UPTIME_FILE.write_text(json.dumps(entries[-1000:], indent=2))

def record_load(model_id: str):
    entries = _load()
    entries.append({"model_id": model_id, "action": "load", "ts": time.time()})
    _save(entries)

def record_unload(model_id: str):
    entries = _load()
    entries.append({"model_id": model_id, "action": "unload", "ts": time.time()})
    _save(entries)

@router.get("/uptime")
async def get_uptime(request: Request) -> dict:
    entries = _load()
    adapter = request.app.state.active_adapter
    current_model = adapter.model_id if adapter and adapter.is_loaded() else None

    # Calculate per-model uptime
    model_times: dict[str, float] = {}
    load_starts: dict[str, float] = {}

    for e in entries:
        mid = e["model_id"]
        if e["action"] == "load":
            load_starts[mid] = e["ts"]
        elif e["action"] == "unload" and mid in load_starts:
            duration = e["ts"] - load_starts[mid]
            model_times[mid] = model_times.get(mid, 0) + duration
            del load_starts[mid]

    # Add ongoing sessions
    now = time.time()
    for mid, start in load_starts.items():
        model_times[mid] = model_times.get(mid, 0) + (now - start)

    ranked = sorted(model_times.items(), key=lambda x: -x[1])
    return {
        "current_model": current_model,
        "models": [
            {"model_id": mid, "total_hours": round(secs / 3600, 2), "total_seconds": round(secs, 0)}
            for mid, secs in ranked
        ],
        "total_events": len(entries),
    }
