"""Operations router — live log tailing, backend process tree, auto-restart
toggles. All useful for 'why did X stop working?' debugging from inside
Crucible without opening a terminal.
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

router = APIRouter()


# Known log sources — each entry is a label + an absolute path. Only readable
# files are ever exposed; anything missing is silently omitted from the list.
LOG_SOURCES: dict[str, Path] = {
    "crucible":   Path("/tmp/crucible-backend.log"),
    "frontend":   Path("/tmp/crucible-frontend.log"),
    "omlx":       Path.home() / ".omlx" / "logs" / "server.log",
    "launchd":    Path("/tmp/crucible-launchd.out"),
}


@router.get("/logs/sources")
async def list_sources() -> list[dict]:
    out = []
    for key, path in LOG_SOURCES.items():
        if path.exists():
            st = path.stat()
            out.append({
                "key": key, "path": str(path), "size_bytes": st.st_size,
                "mtime": st.st_mtime,
            })
    return out


@router.get("/logs/{source}/tail")
async def tail(source: str, lines: int = 200) -> dict:
    """Return the last N lines of the requested log. One-shot — not a stream."""
    path = LOG_SOURCES.get(source)
    if not path or not path.exists():
        raise HTTPException(404, f"log source not found: {source}")
    try:
        r = subprocess.run(
            ["tail", "-n", str(max(1, min(lines, 5000))), str(path)],
            capture_output=True, text=True, timeout=5,
        )
        return {"source": source, "content": r.stdout}
    except Exception as e:
        raise HTTPException(500, f"tail failed: {e}")


@router.get("/logs/{source}/stream")
async def stream(source: str) -> StreamingResponse:
    """SSE stream following the log with `tail -f`."""
    path = LOG_SOURCES.get(source)
    if not path or not path.exists():
        raise HTTPException(404, f"log source not found: {source}")

    async def _gen():
        proc = await asyncio.create_subprocess_exec(
            "tail", "-n", "50", "-F", str(path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            assert proc.stdout
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                yield f"data: {json.dumps({'line': line.decode(errors='replace').rstrip()})}\n\n"
        finally:
            try:
                proc.terminate()
                await proc.wait()
            except Exception:
                pass

    return StreamingResponse(_gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache"})


# ── Process tree ───────────────────────────────────────────────────────────

_TRACKED = [
    ("uvicorn",      ["uvicorn main:app"]),
    ("next-server",  ["next-server"]),
    ("omlx",         ["omlx serve", ".venvs/omlx/bin/omlx"]),
    ("mlx_lm",       ["mlx_lm.server"]),
    ("vllm",         ["vllm serve"]),
    ("llama-server", ["llama-server"]),
]


def _ps_grep(substrings: list[str]) -> list[dict]:
    """Return lightweight rows for matching processes."""
    try:
        r = subprocess.run(["ps", "-axo", "pid,etime,rss,command"],
                            capture_output=True, text=True, timeout=3)
    except Exception:
        return []
    rows: list[dict] = []
    for line in r.stdout.splitlines()[1:]:
        parts = line.strip().split(None, 3)
        if len(parts) < 4:
            continue
        pid, etime, rss, cmd = parts
        if any(sub in cmd for sub in substrings):
            rows.append({
                "pid": int(pid), "etime": etime,
                "rss_kb": int(rss) if rss.isdigit() else 0,
                "command": cmd[:300],
            })
    return rows


@router.get("/ops/processes")
async def processes() -> list[dict]:
    out = []
    for name, subs in _TRACKED:
        entries = _ps_grep(subs)
        out.append({"name": name, "running": len(entries) > 0, "entries": entries})
    return out


# ── Auto-restart policy ────────────────────────────────────────────────────

AUTORESTART_FILE = Path.home() / ".config" / "crucible" / "auto_restart.json"

DEFAULT_POLICY: dict[str, Any] = {
    "enabled": False,
    "services": {
        "omlx":         {"watch": True,  "max_failures": 3, "restart_cmd": "launchctl kickstart -k gui/$(id -u)/com.jim.omlx"},
        "mlx_lm":       {"watch": False, "max_failures": 3, "restart_cmd": ""},
        "llama-server": {"watch": False, "max_failures": 3, "restart_cmd": ""},
    },
}


def _load_policy() -> dict:
    if not AUTORESTART_FILE.exists():
        return dict(DEFAULT_POLICY)
    try:
        return {**DEFAULT_POLICY, **json.loads(AUTORESTART_FILE.read_text())}
    except Exception:
        return dict(DEFAULT_POLICY)


def _save_policy(p: dict) -> None:
    AUTORESTART_FILE.parent.mkdir(parents=True, exist_ok=True)
    AUTORESTART_FILE.write_text(json.dumps(p, indent=2))


@router.get("/ops/auto-restart")
async def get_auto_restart() -> dict:
    return _load_policy()


@router.put("/ops/auto-restart")
async def set_auto_restart(body: dict) -> dict:
    p = _load_policy()
    # Only accept known fields to avoid garbage persisting.
    if "enabled" in body:
        p["enabled"] = bool(body["enabled"])
    if "services" in body and isinstance(body["services"], dict):
        p["services"].update(body["services"])
    _save_policy(p)
    return p


@router.post("/ops/run-restart/{name}")
async def run_restart(name: str) -> dict:
    """Trigger the configured restart_cmd for a named service. Always
    user-initiated — no auto-fire here. The background loop in main.py
    also calls into this module."""
    p = _load_policy()
    svc = p.get("services", {}).get(name)
    if not svc or not svc.get("restart_cmd"):
        raise HTTPException(404, f"no restart command configured for {name}")
    try:
        r = subprocess.run(svc["restart_cmd"], shell=True, capture_output=True,
                            text=True, timeout=30)
        return {
            "name": name, "exit_code": r.returncode,
            "stdout_tail": r.stdout[-1000:], "stderr_tail": r.stderr[-1000:],
        }
    except Exception as e:
        raise HTTPException(500, f"restart failed: {e}")
