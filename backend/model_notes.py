"""Model notes and tags — ~/.config/crucible/model_notes.json."""
import json
import logging
from pathlib import Path
from typing import Any

NOTES_FILE = Path.home() / ".config" / "crucible" / "model_notes.json"
log = logging.getLogger(__name__)


def _load() -> dict[str, dict]:
    if not NOTES_FILE.exists():
        return {}
    try:
        return json.loads(NOTES_FILE.read_text())
    except Exception as e:
        log.warning("model_notes: failed to read: %s", e)
        return {}


def _save(data: dict) -> None:
    NOTES_FILE.parent.mkdir(parents=True, exist_ok=True)
    NOTES_FILE.write_text(json.dumps(data, indent=2))


def get_note(model_id: str) -> dict[str, Any]:
    return _load().get(model_id, {"notes": "", "tags": [], "hidden": False, "preferred_engine": None})


def set_note(model_id: str, notes: str, tags: list[str]) -> dict[str, Any]:
    data = _load()
    existing = data.get(model_id, {})
    data[model_id] = {
        "notes": notes,
        "tags": [t.strip() for t in tags if t.strip()],
        "hidden": existing.get("hidden", False),
        "preferred_engine": existing.get("preferred_engine"),
    }
    _save(data)
    return data[model_id]


def set_hidden(model_id: str, hidden: bool) -> dict[str, Any]:
    data = _load()
    existing = data.get(model_id, {"notes": "", "tags": []})
    existing["hidden"] = hidden
    data[model_id] = existing
    _save(data)
    return existing


def set_preferred_engine(model_id: str, engine: str | None) -> dict[str, Any]:
    data = _load()
    existing = data.get(model_id, {"notes": "", "tags": [], "hidden": False})
    existing["preferred_engine"] = engine
    data[model_id] = existing
    _save(data)
    return existing


def all_preferred_engines() -> dict[str, str | None]:
    return {mid: entry.get("preferred_engine") for mid, entry in _load().items()}


def all_hidden() -> dict[str, bool]:
    """Return map of model_id → hidden for all models that have hidden=True."""
    data = _load()
    return {mid: entry.get("hidden", False) for mid, entry in data.items()}


def all_tags() -> list[str]:
    """Return sorted list of all unique tags across all models."""
    data = _load()
    tags: set[str] = set()
    for entry in data.values():
        tags.update(entry.get("tags", []))
    return sorted(tags)


def all_notes() -> dict[str, dict]:
    return _load()
