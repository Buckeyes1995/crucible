"""Crash / session recovery.

Writes the active-model state to ~/.config/crucible/session.json whenever a
model loads or unloads, plus a 'clean_shutdown' flag flipped at process
lifecycle edges. On startup we compare: if the last session has a model
recorded but clean_shutdown is False, the previous process died with a model
loaded and the UI should offer a one-click restore.
"""
from __future__ import annotations

import fcntl
import json
import logging
import os
import time
from pathlib import Path

log = logging.getLogger(__name__)

SESSION_FILE = Path.home() / ".config" / "crucible" / "session.json"
LOCK_FILE = SESSION_FILE.parent / "session.lock"

# Process-scoped. The OS releases fcntl locks automatically when the holder
# dies (including kill -9), which is exactly what we need to distinguish a
# crashed primary from a cleanly-exited duplicate-that-failed-to-bind.
_lock_fd = None


def _read() -> dict:
    try:
        if SESSION_FILE.exists():
            return json.loads(SESSION_FILE.read_text())
    except Exception:
        pass
    return {}


def _write(state: dict) -> None:
    SESSION_FILE.parent.mkdir(parents=True, exist_ok=True)
    try:
        SESSION_FILE.write_text(json.dumps(state, indent=2))
    except Exception as e:
        log.warning("session_persist: failed to write %s: %s", SESSION_FILE, e)


def record_load(model_id: str | None, engine: str | None = None) -> None:
    state = _read()
    if model_id is None:
        state["active_model_id"] = None
        state["engine"] = None
    else:
        state["active_model_id"] = model_id
        state["engine"] = engine
        state["loaded_at"] = time.time()
    state["clean_shutdown"] = False
    _write(state)


def mark_running() -> None:
    """Acquire the session lock, record running state. If another process
    already holds the lock (= we're a duplicate backend that failed to bind)
    this is a no-op — we must not touch state."""
    global _lock_fd
    try:
        LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
        _lock_fd = open(LOCK_FILE, "w")
        fcntl.flock(_lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        # Another live process owns the state. Don't touch session.json.
        try:
            if _lock_fd is not None:
                _lock_fd.close()
        except Exception:
            pass
        _lock_fd = None
        log.info("session_persist: another process holds the lock; skipping mark_running")
        return
    except Exception as e:
        log.warning("session_persist: failed to acquire lock: %s", e)
        _lock_fd = None
        return

    state = _read()
    state["clean_shutdown"] = False
    state["started_at"] = time.time()
    state["pid"] = os.getpid()
    _write(state)


def mark_clean_shutdown() -> None:
    """Only flips the flag if we actually held the lock. A duplicate process
    that never acquired the lock (failed to bind) can't clobber the real
    process's dirty-shutdown marker."""
    global _lock_fd
    if _lock_fd is None:
        return
    state = _read()
    state["clean_shutdown"] = True
    state["stopped_at"] = time.time()
    _write(state)
    try:
        fcntl.flock(_lock_fd, fcntl.LOCK_UN)
        _lock_fd.close()
    except Exception:
        pass
    _lock_fd = None


def read_recoverable() -> dict | None:
    """If the last shutdown was dirty AND a model was loaded at the time,
    return a snapshot for the UI. Returns None when there's nothing to
    recover."""
    state = _read()
    if state.get("clean_shutdown"):
        return None
    mid = state.get("active_model_id")
    if not mid:
        return None
    return {
        "model_id": mid,
        "engine": state.get("engine"),
        "loaded_at": state.get("loaded_at"),
        "started_at": state.get("started_at"),
    }


def forget_recovery() -> None:
    state = _read()
    state["active_model_id"] = None
    state["engine"] = None
    _write(state)
