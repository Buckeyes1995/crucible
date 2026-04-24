"""oMLX watchdog — tails ~/Library/Logs/omlx.log and raises a notification
(plus an audit record) when oMLX logs patterns that historically precede
a full crash.

Triggered patterns (2026-04-23 incident): a 36 GB model that oMLX's
internal "Emergency reclaim" can't unload back down to its 5 GB safe
threshold, followed hours later by a NoneType crash in the streaming
handler that takes the whole service down.

Byte-offset state persists so we don't re-alert on old log lines across
Crucible restarts. Rotate-safe: if the file shrinks we reset to 0.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

LOG_FILE = Path.home() / "Library" / "Logs" / "omlx.log"
STATE_FILE = Path.home() / ".config" / "crucible" / "omlx_watchdog.json"

TICK_SECONDS = 20

# Patterns → (severity, human message). `match` groups can be surfaced.
PATTERNS: list[tuple[re.Pattern, str, str]] = [
    (
        re.compile(r"Emergency reclaim failed for '([^']+)': active_memory=([\d.]+)GB"),
        "critical",
        "oMLX memory reclaim failed for {0} ({1} GB). A crash is likely. Restart oMLX or stop the model.",
    ),
    (
        re.compile(r"Error during chat streaming: 'NoneType' object has no attribute 'abort_request'"),
        "critical",
        "oMLX engine crashed mid-stream. Service may have restarted; re-load your model.",
    ),
    (
        re.compile(r"CUDA out of memory|out of memory|OOM"),
        "critical",
        "oMLX reports out-of-memory. Reduce the loaded model size or unload.",
    ),
    (
        re.compile(r"Engine pool shutdown"),
        "warning",
        "oMLX engine pool shut down. Next request will cold-start the engine.",
    ),
    # Observed 2026-04-24: VLM engine hangs on very long prefills (65K+
    # tokens), launchd kills it, KeepAlive respawns. The "Aborting request"
    # + "Prefill interrupted" pair is the fingerprint. Surfacing early
    # lets the user unload mxfp8 and switch to a more stable model
    # (Qwen3-Coder-Next) before the hang becomes a kill.
    (
        re.compile(r"\[vlm_stream_generate\] Aborting request"),
        "warning",
        "VLM engine aborted a request mid-prefill. If this repeats, the current model may be stuck on long context — consider switching to a non-VLM model (e.g. Qwen3-Coder-Next).",
    ),
    (
        re.compile(r"Prefill interrupted at (\d+)/(\d+) tokens"),
        "warning",
        "Prefill interrupted at {0}/{1} tokens. Long-context prefills on mxfp8 sometimes stall — if the session stops responding, restart oMLX and shorten context.",
    ),
    # Fresh process start without an orderly shutdown preceding it means
    # launchd KeepAlive respawned after a crash or SIGKILL. Not fatal on
    # its own (service is back up), but worth knowing when you're mid-
    # session and suddenly have no model loaded.
    (
        re.compile(r"Server initialized with \d+ models"),
        "warning",
        "oMLX process (re)started. If you didn't trigger this, it was killed by launchd — any loaded model is gone; reload before continuing.",
    ),
    (
        re.compile(r"Process memory enforcer .* killed|MemoryEnforcer terminating"),
        "critical",
        "oMLX's process-memory enforcer killed the engine. Reduce the loaded model size or lower the cap in ~/.omlx/settings.json.",
    ),
]


def _load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else {}
    except Exception:
        return {}


def _save_state(s: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(s))


def _notify(severity: str, title: str, body: str) -> None:
    try:
        import notifications
        notifications.add(f"omlx-watchdog/{severity}", f"{title} — {body}")
    except Exception:
        pass
    try:
        import audit
        audit.record(
            actor="omlx_watchdog",
            action=f"omlx.alert.{severity}",
            meta={"title": title, "body": body},
        )
    except Exception:
        pass
    log.warning("[omlx-watchdog %s] %s — %s", severity, title, body)


async def _scan_once() -> None:
    if not LOG_FILE.exists():
        return
    state = _load_state()
    size = LOG_FILE.stat().st_size
    prev_offset = int(state.get("offset", 0))
    # Rotation-safe: if the file shrank (truncated / rotated), start over.
    if prev_offset > size:
        prev_offset = 0

    # Cap single-scan work so we don't OOM on a huge log. If we're
    # behind by >10 MB (shouldn't happen in practice) jump forward.
    MAX_BEHIND = 10 * 1024 * 1024
    if size - prev_offset > MAX_BEHIND:
        prev_offset = size - MAX_BEHIND

    try:
        with LOG_FILE.open("r", errors="ignore") as f:
            f.seek(prev_offset)
            chunk = f.read()
    except Exception as e:
        log.warning("omlx-watchdog: read failed (%s)", e)
        return

    for line in chunk.splitlines():
        for pat, sev, msg_tpl in PATTERNS:
            m = pat.search(line)
            if m:
                try:
                    body = msg_tpl.format(*m.groups())
                except Exception:
                    body = msg_tpl
                title = {"critical": "oMLX critical", "warning": "oMLX warning"}.get(sev, "oMLX alert")
                _notify(sev, title, body)
                break  # one pattern per line; avoid double-firing on overlapping regexes

    state["offset"] = size
    _save_state(state)


_loop_task: Optional[asyncio.Task] = None


async def start_loop(app_state) -> None:
    """Spawn the tail loop on the running event loop. Idempotent."""
    global _loop_task
    if _loop_task and not _loop_task.done():
        return

    # On first boot after the watchdog ships, treat the current file tail
    # as "already seen" so we don't fire a notification storm for
    # historical incidents we already know about.
    if not _load_state() and LOG_FILE.exists():
        _save_state({"offset": LOG_FILE.stat().st_size})

    async def _run():
        while True:
            try:
                await _scan_once()
            except Exception as e:
                log.warning("omlx-watchdog loop error: %s", e)
            await asyncio.sleep(TICK_SECONDS)

    _loop_task = asyncio.create_task(_run())


async def stop_loop() -> None:
    global _loop_task
    if _loop_task:
        _loop_task.cancel()
        try:
            await _loop_task
        except asyncio.CancelledError:
            pass
        except Exception:
            pass
        _loop_task = None
