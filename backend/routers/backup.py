"""Backup & Restore — export/import all Crucible data."""
import json, shutil, subprocess, time, zipfile, io, os
from pathlib import Path
from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter()
CONFIG_DIR = Path.home() / ".config" / "crucible"

BACKUP_FILES = [
    "config.json", "model_params.json", "model_notes.json", "model_stats.json",
    "schedules.json", "webhooks.json", "prompt_templates.json", "model_groups.json",
    "smart_router.json", "system_prompts.json", "chat_templates.json",
    "chat_reactions.json", "bench_presets.json", "bench_schedules.json",
    "api_keys.json", "notifications.json", "response_cache.json",
    "uptime_log.json", "model_changelog.json", "auto_bench_results.json",
    "snippets.json", "mcps.json", "wishlist.json", "load_timings.json",
    "model_changelogs.json", "reddit_watcher.json", "reddit_drafts.json",
    "workflows.json", "hf_updates.json", "zlab_drafts.json",
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


class RsyncRequest(BaseModel):
    destination: str  # rsync-style dest: "user@host:/path/" or "/local/path/"
    dry_run: bool = False


@router.post("/backup/rsync")
async def rsync_backup(body: RsyncRequest) -> dict:
    """Push ~/.config/crucible/ to a user-supplied rsync destination. No creds
    are stored — this assumes the user has SSH keys or a local mount already
    set up. Intentionally user-supplied to avoid baking in any specific host."""
    if not body.destination.strip():
        raise HTTPException(400, "destination is required")
    # Basic sanity checks on the destination.
    if any(ch in body.destination for ch in (";", "&", "|", "`", "$(")):
        raise HTTPException(400, "destination contains unsupported shell metacharacters")
    args = ["rsync", "-aH", "--delete"]
    if body.dry_run:
        args.insert(2, "--dry-run")
    args += [str(CONFIG_DIR) + "/", body.destination]
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=600)
    except FileNotFoundError:
        raise HTTPException(500, "rsync not installed")
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "rsync timed out after 10 minutes")
    return {
        "status": "ok" if r.returncode == 0 else "error",
        "exit_code": r.returncode,
        "dry_run": body.dry_run,
        "stdout_tail": r.stdout[-2000:],
        "stderr_tail": r.stderr[-2000:],
    }
