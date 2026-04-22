"""Snippet library — pinned chat responses / useful outputs.

Stores as a flat JSON list at ~/.config/crucible/snippets.json.
"""
from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any

STORE = Path.home() / ".config" / "crucible" / "snippets.json"


def _load() -> list[dict[str, Any]]:
    if not STORE.exists():
        return []
    try:
        return json.loads(STORE.read_text())
    except Exception:
        return []


def _save(items: list[dict[str, Any]]) -> None:
    STORE.parent.mkdir(parents=True, exist_ok=True)
    STORE.write_text(json.dumps(items, indent=2))


def list_snippets(project_id: str | None = None) -> list[dict[str, Any]]:
    """All snippets newest-first. If `project_id` is passed, filter to
    that project. The sentinel `"__none__"` means "no project" (the
    uncategorized bucket). None/empty = no filter."""
    items = _load()
    if project_id == "__none__":
        items = [s for s in items if not s.get("project_id")]
    elif project_id:
        items = [s for s in items if s.get("project_id") == project_id]
    return sorted(items, key=lambda s: -s.get("created_at", 0))


def create(title: str, content: str, source: str = "chat",
           tags: list[str] | None = None, model_id: str | None = None,
           project_id: str | None = None) -> dict:
    items = _load()
    entry = {
        "id": uuid.uuid4().hex[:12],
        "title": title.strip() or "Untitled",
        "content": content,
        "source": source,       # "chat" | "arena" | "diff" | "manual"
        "tags": list(tags or []),
        "model_id": model_id,
        "project_id": project_id,
        "created_at": time.time(),
    }
    items.append(entry)
    _save(items)
    return entry


def detach_project(project_id: str) -> int:
    """Null-out project_id on snippets that reference a deleted project.
    Returns how many were updated."""
    items = _load()
    n = 0
    for s in items:
        if s.get("project_id") == project_id:
            s["project_id"] = None
            n += 1
    if n:
        _save(items)
    return n


def update(snippet_id: str, **fields: Any) -> dict | None:
    items = _load()
    for s in items:
        if s.get("id") == snippet_id:
            for k in ("title", "content", "tags", "project_id"):
                if k in fields:
                    s[k] = fields[k]
            _save(items)
            return s
    return None


def delete(snippet_id: str) -> bool:
    items = _load()
    new = [s for s in items if s.get("id") != snippet_id]
    if len(new) == len(items):
        return False
    _save(new)
    return True


def all_tags() -> list[str]:
    tags: set[str] = set()
    for s in _load():
        for t in s.get("tags", []):
            if t:
                tags.add(t)
    return sorted(tags)
