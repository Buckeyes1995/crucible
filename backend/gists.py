"""Local gist publishing — turn a snippet (or any piece of content) into a
markdown file under ~/.config/crucible/gists/, served by the FastAPI app
at /api/gists/{slug}. This is the minimum viable "share a thing with
yourself later" workflow; LAN / tunnel access makes it shareable without
GitHub.
"""
from __future__ import annotations

import json
import re
import time
import uuid
from pathlib import Path
from typing import Any

GISTS_DIR = Path.home() / ".config" / "crucible" / "gists"
INDEX_FILE = GISTS_DIR / "_index.json"


def _load_index() -> list[dict[str, Any]]:
    if not INDEX_FILE.exists():
        return []
    try:
        return json.loads(INDEX_FILE.read_text())
    except Exception:
        return []


def _save_index(items: list[dict[str, Any]]) -> None:
    GISTS_DIR.mkdir(parents=True, exist_ok=True)
    INDEX_FILE.write_text(json.dumps(items, indent=2))


def _slug(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9_-]+", "-", name).strip("-").lower()
    return s[:60] or uuid.uuid4().hex[:8]


def list_gists() -> list[dict]:
    return sorted(_load_index(), key=lambda g: -g.get("created_at", 0))


def create(title: str, content: str, tags: list[str] | None = None) -> dict:
    slug = f"{_slug(title)}-{uuid.uuid4().hex[:6]}"
    GISTS_DIR.mkdir(parents=True, exist_ok=True)
    path = GISTS_DIR / f"{slug}.md"
    path.write_text(content)
    entry = {
        "id": slug,
        "slug": slug,
        "title": title,
        "tags": list(tags or []),
        "bytes": len(content.encode("utf-8")),
        "created_at": time.time(),
    }
    idx = _load_index()
    idx.append(entry)
    _save_index(idx)
    return entry


def read(slug: str) -> tuple[dict, str] | None:
    idx = _load_index()
    entry = next((g for g in idx if g["slug"] == slug), None)
    if not entry:
        return None
    path = GISTS_DIR / f"{slug}.md"
    if not path.exists():
        return None
    return entry, path.read_text()


def delete(slug: str) -> bool:
    idx = _load_index()
    before = len(idx)
    idx = [g for g in idx if g["slug"] != slug]
    if len(idx) == before:
        return False
    _save_index(idx)
    path = GISTS_DIR / f"{slug}.md"
    if path.exists():
        path.unlink()
    return True
