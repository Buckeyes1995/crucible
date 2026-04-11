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
    return _load().get(model_id, {"notes": "", "tags": []})


def set_note(model_id: str, notes: str, tags: list[str]) -> dict[str, Any]:
    data = _load()
    data[model_id] = {"notes": notes, "tags": [t.strip() for t in tags if t.strip()]}
    _save(data)
    return data[model_id]


def all_tags() -> list[str]:
    """Return sorted list of all unique tags across all models."""
    data = _load()
    tags: set[str] = set()
    for entry in data.values():
        tags.update(entry.get("tags", []))
    return sorted(tags)


def all_notes() -> dict[str, dict]:
    return _load()
