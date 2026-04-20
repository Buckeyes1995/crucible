"""Crucible Store — fetches the curated catalog from the crucible-store repo.

The catalog is a single JSON file hosted on GitHub. We cache it locally with
a TTL so the /store page is fast and still works offline. When the network
fetch fails we fall back to whatever we have on disk; if we have nothing we
return an empty catalog rather than 500'ing.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

import httpx

log = logging.getLogger(__name__)

CATALOG_URL = "https://raw.githubusercontent.com/Buckeyes1995/crucible-store/main/catalog.json"
CACHE_FILE = Path.home() / ".config" / "crucible" / "store_catalog.json"
CACHE_TTL_SECONDS = 3600  # 1h — edits land fast enough; users can hit refresh.

EMPTY_CATALOG: dict[str, Any] = {
    "version": 1,
    "updated_at": None,
    "models": [],
    "prompts": [],
    "workflows": [],
    "system_prompts": [],
    "mcps": [],
}


def _read_cache() -> dict[str, Any] | None:
    if not CACHE_FILE.exists():
        return None
    try:
        return json.loads(CACHE_FILE.read_text())
    except Exception as e:
        log.warning("store: unreadable cache, ignoring (%s)", e)
        return None


def _write_cache(catalog: dict[str, Any]) -> None:
    try:
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(json.dumps(catalog, indent=2))
    except Exception as e:
        log.warning("store: cache write failed (%s)", e)


async def _fetch_remote() -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.get(CATALOG_URL)
        r.raise_for_status()
        return r.json()


async def get_catalog(force: bool = False) -> dict[str, Any]:
    """Return the catalog. If the local cache is fresh enough (and force=False),
    return that. Otherwise attempt a network fetch; on failure, return the
    cache anyway — the store must not crash just because GitHub is slow."""
    cached = _read_cache()
    if not force and cached is not None:
        age = time.time() - CACHE_FILE.stat().st_mtime
        if age < CACHE_TTL_SECONDS:
            return cached

    try:
        fresh = await _fetch_remote()
        _write_cache(fresh)
        return fresh
    except Exception as e:
        log.warning("store: remote fetch failed (%s), using cache", e)
        return cached if cached is not None else EMPTY_CATALOG.copy()


def find_entry(catalog: dict[str, Any], kind: str, entry_id: str) -> dict | None:
    """Look up a single entry by kind + id. Returns None if missing."""
    items = catalog.get(kind) or []
    return next((e for e in items if e.get("id") == entry_id), None)
