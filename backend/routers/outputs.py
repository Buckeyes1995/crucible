"""Save generated code from arena / diff output panels to a sandboxed dir.

Keeps all written files under ~/.config/crucible/outputs/<source>/<id>/ so we
never write outside that root regardless of what the model or a bug emits.
"""
from __future__ import annotations

import asyncio
import re
import subprocess
import time
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

# Extensions we know how to execute. Each maps to an argv prefix; the sandboxed
# file path is appended. Intentionally limited — executing arbitrary model
# output is already dangerous, and we only opt in to interpreters that (a) are
# likely on the user's PATH and (b) don't need a build step to run a single
# file.
_RUNNERS: dict[str, list[str]] = {
    ".py": ["/usr/bin/env", "python3"],
    ".js": ["/usr/bin/env", "node"],
    ".sh": ["/usr/bin/env", "bash"],
    ".rb": ["/usr/bin/env", "ruby"],
}
_RUN_TIMEOUT_S = 30.0
_MAX_OUTPUT_BYTES = 64 * 1024

OUTPUT_ROOT = Path.home() / ".config" / "crucible" / "outputs"
_SAFE_NAME = re.compile(r"^[A-Za-z0-9._\- ]+$")


def _validate_segment(name: str, label: str) -> None:
    if not name or "/" in name or "\\" in name or ".." in name:
        raise HTTPException(400, f"invalid {label}")
    if name.startswith("."):
        raise HTTPException(400, f"{label} cannot start with .")


def _sandbox(source: str, run_id: str, filename: str, subdir: str | None = None) -> Path:
    """Resolve + validate the final target path. Rejects traversal attempts."""
    source = source.strip().lower()
    if source not in {"arena", "diff", "chat"}:
        raise HTTPException(400, f"source must be arena/diff/chat, got {source!r}")

    _validate_segment(run_id, "run_id")
    if subdir:
        _validate_segment(subdir, "subdir")

    if not filename or not _SAFE_NAME.match(filename):
        raise HTTPException(400, f"invalid filename {filename!r}")
    if filename.startswith(".") or filename in {".", ".."}:
        raise HTTPException(400, "filename cannot start with . or be . / ..")

    base = OUTPUT_ROOT / source / run_id
    if subdir:
        base = base / subdir
    target = (base / filename).resolve()
    base_resolved = base.resolve()
    # Final check that target stays under base even after resolve() normalization
    if not str(target).startswith(str(base_resolved) + "/") and target != base_resolved:
        raise HTTPException(400, "path escapes sandbox")
    return target


class SaveRequest(BaseModel):
    source: Literal["arena", "diff", "chat"]
    run_id: str = Field(min_length=1, max_length=64)
    # Optional per-model folder. For diff, callers pass the (sanitized) model
    # name so multi-model runs land in separate dirs.
    subdir: str | None = Field(default=None, max_length=128)
    filename: str = Field(min_length=1, max_length=128)
    content: str


@router.post("/output/save")
async def save_output(body: SaveRequest) -> dict:
    target = _sandbox(body.source, body.run_id, body.filename, body.subdir)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(body.content, encoding="utf-8")
    return {
        "status": "ok",
        "path": str(target),
        "bytes": len(body.content.encode("utf-8")),
    }


class RevealRequest(BaseModel):
    source: Literal["arena", "diff", "chat"]
    run_id: str = Field(min_length=1, max_length=64)


@router.post("/output/reveal")
async def reveal_output(body: RevealRequest) -> dict:
    """Open the output directory in Finder. Best-effort — never raises if
    the dir doesn't exist yet, just reports back."""
    base = OUTPUT_ROOT / body.source / body.run_id
    base.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.Popen(["open", str(base)])
    except FileNotFoundError:
        raise HTTPException(500, "`open` command not available (non-macOS?)")
    return {"status": "ok", "path": str(base)}


class RunRequest(BaseModel):
    source: Literal["arena", "diff", "chat"]
    run_id: str = Field(min_length=1, max_length=64)
    subdir: str | None = Field(default=None, max_length=128)
    filename: str = Field(min_length=1, max_length=128)


@router.post("/output/run")
async def run_output(body: RunRequest) -> dict:
    """Execute a previously-saved file and return captured output. Only files
    with known extensions (.py / .js / .sh / .rb) run; everything else is
    rejected rather than silently no-op'd. 30s wall-clock cap; output is
    truncated at 64KB each side to keep the browser responsive."""
    target = _sandbox(body.source, body.run_id, body.filename, body.subdir)
    if not target.exists():
        raise HTTPException(404, f"file not found: {target.name}")

    ext = target.suffix.lower()
    runner = _RUNNERS.get(ext)
    if not runner:
        raise HTTPException(400,
            f"can't run {ext} files (supported: {', '.join(sorted(_RUNNERS))})")

    # Run with cwd = file's own directory so the script can open sibling files
    # (its own test fixtures etc). Stays inside the sandbox either way.
    cwd = target.parent
    t0 = time.monotonic()
    try:
        proc = await asyncio.create_subprocess_exec(
            *runner, str(target),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(cwd),
        )
        try:
            stdout_b, stderr_b = await asyncio.wait_for(
                proc.communicate(), timeout=_RUN_TIMEOUT_S,
            )
            timed_out = False
        except asyncio.TimeoutError:
            proc.kill()
            try:
                stdout_b, stderr_b = await proc.communicate()
            except Exception:
                stdout_b, stderr_b = b"", b""
            timed_out = True
    except FileNotFoundError as e:
        raise HTTPException(500, f"runner missing: {e}")
    elapsed = time.monotonic() - t0

    def _clip(b: bytes) -> str:
        if len(b) > _MAX_OUTPUT_BYTES:
            return b[:_MAX_OUTPUT_BYTES].decode("utf-8", errors="replace") + \
                   f"\n… [truncated {len(b) - _MAX_OUTPUT_BYTES} more bytes]"
        return b.decode("utf-8", errors="replace")

    return {
        "status": "ok",
        "exit_code": proc.returncode,
        "timed_out": timed_out,
        "elapsed_s": round(elapsed, 2),
        "stdout": _clip(stdout_b),
        "stderr": _clip(stderr_b),
        "runner": " ".join(runner),
    }


@router.get("/output/list")
async def list_outputs(source: str, run_id: str) -> dict:
    base = OUTPUT_ROOT / source / run_id
    if not base.exists():
        return {"path": str(base), "files": []}
    files = []
    for p in sorted(base.iterdir()):
        if p.is_file():
            files.append({
                "name": p.name,
                "bytes": p.stat().st_size,
                "modified": p.stat().st_mtime,
            })
    return {"path": str(base), "files": files}
