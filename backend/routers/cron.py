"""Cron Jobs — scheduled maintenance tasks."""
import json, time
from pathlib import Path
from fastapi import APIRouter

router = APIRouter()
CONFIG_DIR = Path.home() / ".config" / "crucible"

@router.get("/cron/status")
async def cron_status() -> dict:
    """Report status of built-in maintenance tasks."""
    db_path = CONFIG_DIR / "crucible.db"
    cache_path = CONFIG_DIR / "response_cache.json"

    tasks = [
        {
            "name": "Database Size",
            "status": f"{db_path.stat().st_size / 1e6:.1f} MB" if db_path.exists() else "N/A",
            "type": "info",
        },
        {
            "name": "Response Cache",
            "status": f"{cache_path.stat().st_size / 1e3:.1f} KB" if cache_path.exists() else "empty",
            "type": "info",
        },
    ]

    # Check for stale files
    for fname in ["notifications.json", "uptime_log.json"]:
        fpath = CONFIG_DIR / fname
        if fpath.exists():
            age_days = (time.time() - fpath.stat().st_mtime) / 86400
            tasks.append({"name": fname, "status": f"{age_days:.0f} days old, {fpath.stat().st_size / 1e3:.1f} KB", "type": "info"})

    return {"tasks": tasks}

@router.post("/cron/cleanup")
async def run_cleanup() -> dict:
    """Run maintenance: trim logs, compact caches."""
    cleaned = []

    # Trim notifications
    notif_file = CONFIG_DIR / "notifications.json"
    if notif_file.exists():
        try:
            data = json.loads(notif_file.read_text())
            if len(data) > 100:
                data = data[-100:]
                notif_file.write_text(json.dumps(data, indent=2))
                cleaned.append("notifications trimmed")
        except: pass

    # Trim uptime log
    uptime_file = CONFIG_DIR / "uptime_log.json"
    if uptime_file.exists():
        try:
            data = json.loads(uptime_file.read_text())
            if len(data) > 500:
                data = data[-500:]
                uptime_file.write_text(json.dumps(data, indent=2))
                cleaned.append("uptime log trimmed")
        except: pass

    # Clear old response cache entries (>7 days)
    cache_file = CONFIG_DIR / "response_cache.json"
    if cache_file.exists():
        try:
            data = json.loads(cache_file.read_text())
            cutoff = time.time() - 7 * 86400
            before = len(data)
            data = {k: v for k, v in data.items() if v.get("ts", 0) > cutoff}
            if len(data) < before:
                cache_file.write_text(json.dumps(data, indent=2))
                cleaned.append(f"cache: removed {before - len(data)} stale entries")
        except: pass

    return {"cleaned": cleaned if cleaned else ["nothing to clean"]}
