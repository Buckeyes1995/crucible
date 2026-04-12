"""Prompt template (system prompt library) storage."""
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

TEMPLATES_FILE = Path.home() / ".config" / "crucible" / "prompt_templates.json"


def _load() -> list[dict]:
    if not TEMPLATES_FILE.exists():
        return []
    try:
        return json.loads(TEMPLATES_FILE.read_text())
    except Exception:
        return []


def _save(data: list[dict]) -> None:
    TEMPLATES_FILE.parent.mkdir(parents=True, exist_ok=True)
    TEMPLATES_FILE.write_text(json.dumps(data, indent=2))


def list_templates() -> list[dict]:
    return _load()


def get_template(template_id: str) -> dict | None:
    return next((t for t in _load() if t["id"] == template_id), None)


def add_template(name: str, content: str, description: str = "") -> dict:
    templates = _load()
    entry = {
        "id": str(uuid.uuid4()),
        "name": name,
        "content": content,
        "description": description,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    templates.append(entry)
    _save(templates)
    return entry


def update_template(template_id: str, **kwargs: Any) -> dict | None:
    templates = _load()
    for t in templates:
        if t["id"] == template_id:
            for k, v in kwargs.items():
                if k in ("name", "content", "description"):
                    t[k] = v
            _save(templates)
            return t
    return None


def delete_template(template_id: str) -> bool:
    templates = _load()
    new = [t for t in templates if t["id"] != template_id]
    if len(new) == len(templates):
        return False
    _save(new)
    return True
