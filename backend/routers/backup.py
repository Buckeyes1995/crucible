"""Backup & Restore — export/import all Crucible data."""
import json, shutil, time, zipfile, io, os
from pathlib import Path
from fastapi import APIRouter, UploadFile, File
from fastapi.responses import StreamingResponse

router = APIRouter()
CONFIG_DIR = Path.home() / ".config" / "crucible"

BACKUP_FILES = [
    "config.json", "model_params.json", "model_notes.json", "model_stats.json",
    "schedules.json", "webhooks.json", "prompt_templates.json", "model_groups.json",
    "smart_router.json", "system_prompts.json", "chat_templates.json",
    "chat_reactions.json", "bench_presets.json", "bench_schedules.json",
    "api_keys.json", "notifications.json", "response_cache.json",
    "uptime_log.json", "model_changelog.json", "auto_bench_results.json",
]

@router.get("/backup/export")
async def export_backup():
    """Export all config files as a ZIP."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for fname in BACKUP_FILES:
            fpath = CONFIG_DIR / fname
            if fpath.exists():
                zf.writestr(fname, fpath.read_text())
        # Include SQLite DB
        db_path = CONFIG_DIR / "crucible.db"
        if db_path.exists():
            zf.write(str(db_path), "crucible.db")
    buf.seek(0)
    ts = time.strftime("%Y%m%d_%H%M%S")
    return StreamingResponse(buf, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="crucible_backup_{ts}.zip"'})

@router.post("/backup/import")
async def import_backup(file: UploadFile = File(...)):
    """Import a backup ZIP, overwriting existing config files."""
    content = await file.read()
    restored = []
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        for name in zf.namelist():
            if name in BACKUP_FILES:
                (CONFIG_DIR / name).write_text(zf.read(name).decode())
                restored.append(name)
            elif name == "crucible.db":
                (CONFIG_DIR / name).write_bytes(zf.read(name))
                restored.append(name)
    return {"status": "restored", "files": restored}

@router.get("/backup/files")
async def list_backup_files():
    """List all config files and their sizes."""
    files = []
    for fname in BACKUP_FILES:
        fpath = CONFIG_DIR / fname
        if fpath.exists():
            files.append({"name": fname, "size": fpath.stat().st_size})
    db = CONFIG_DIR / "crucible.db"
    if db.exists():
        files.append({"name": "crucible.db", "size": db.stat().st_size})
    return files
