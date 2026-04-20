"""Per-folder default model pinning. Maps an absolute directory prefix to
a model_id so 'when I chat from $repo, use $model' becomes automatic."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional

PINS_FILE = Path.home() / ".config" / "crucible" / "folder_pins.json"


def _load() -> list[dict]:
    if not PINS_FILE.exists():
        return []
    try:
        return json.loads(PINS_FILE.read_text())
    except Exception:
        return []


def _save(items: list[dict]) -> None:
    PINS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PINS_FILE.write_text(json.dumps(items, indent=2))


def list_pins() -> list[dict]:
    return _load()


def set_pin(folder: str, model_id: str) -> dict:
    """Upsert by normalized folder path."""
    folder = os.path.abspath(os.path.expanduser(folder))
    items = [p for p in _load() if p.get("folder") != folder]
    entry = {"folder": folder, "model_id": model_id}
    items.append(entry)
    items.sort(key=lambda p: -len(p.get("folder", "")))
    _save(items)
    return entry


def remove_pin(folder: str) -> bool:
    folder = os.path.abspath(os.path.expanduser(folder))
    items = _load()
    new = [p for p in items if p.get("folder") != folder]
    if len(new) == len(items):
        return False
    _save(new)
    return True


def resolve(cwd: str) -> Optional[dict]:
    """Return the pin whose folder is the longest prefix of cwd."""
    cwd_norm = os.path.abspath(os.path.expanduser(cwd))
    best: Optional[dict] = None
    for p in _load():
        f = p.get("folder", "")
        if not f:
            continue
        if cwd_norm == f or cwd_norm.startswith(f.rstrip("/") + "/"):
            if best is None or len(f) > len(best.get("folder", "")):
                best = p
    return best
