"""Server-side favorites store — flat list of favorited model ids.

Lives at ~/.config/crucible/favorites.json so the menubar companion
and any future CLI / remote client share the same list as the web UI.
Still layered behind a tiny API (routers/favorites.py) so the frontend
caches to localStorage for fast paint but truth lives here.
"""
from __future__ import annotations

import json
from pathlib import Path

STORE = Path.home() / ".config" / "crucible" / "favorites.json"


def load() -> list[str]:
    if not STORE.exists():
        return []
    try:
        raw = json.loads(STORE.read_text())
        return raw if isinstance(raw, list) else []
    except Exception:
        return []


def save(ids: list[str]) -> list[str]:
    STORE.parent.mkdir(parents=True, exist_ok=True)
    # Dedupe while preserving order.
    seen: set[str] = set()
    ordered: list[str] = []
    for x in ids:
        if isinstance(x, str) and x and x not in seen:
            seen.add(x)
            ordered.append(x)
    STORE.write_text(json.dumps(ordered))
    return ordered


def toggle(model_id: str) -> tuple[list[str], bool]:
    """Flip the favorited state of `model_id`. Returns (new list, is_favorite_now)."""
    ids = load()
    if model_id in ids:
        ids = [x for x in ids if x != model_id]
        return save(ids), False
    ids.append(model_id)
    return save(ids), True
