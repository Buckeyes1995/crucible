"""Structured audit log — record admin actions with actor + before/after
for later debugging ('who turned on auto-restart at 3am and why did the
whole stack bounce?')."""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

LOG_FILE = Path.home() / ".config" / "crucible" / "audit.log.jsonl"
MAX_LINES = 10_000   # keep the last N lines


def record(actor: str, action: str,
           before: Any | None = None, after: Any | None = None,
           meta: dict | None = None) -> None:
    """Append one audit line. Best-effort — never raises, never blocks the
    caller on IO failures."""
    entry = {
        "ts": time.time(),
        "actor": actor or "anonymous",
        "action": action,
        "before": before,
        "after": after,
        "meta": meta or {},
    }
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with LOG_FILE.open("a") as f:
            f.write(json.dumps(entry, default=str) + "\n")
        # Trim if too long. Cheap linear rewrite — fine for our volume.
        with LOG_FILE.open() as f:
            lines = f.readlines()
        if len(lines) > MAX_LINES:
            LOG_FILE.write_text("".join(lines[-MAX_LINES:]))
    except Exception:
        pass


def recent(limit: int = 200) -> list[dict]:
    if not LOG_FILE.exists():
        return []
    try:
        lines = LOG_FILE.read_text().splitlines()
    except Exception:
        return []
    out: list[dict] = []
    for line in lines[-limit:]:
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return list(reversed(out))
