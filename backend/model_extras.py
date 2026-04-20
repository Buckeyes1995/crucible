"""Small per-model data stores bundled in one module:

- wishlist: HF repos the user considered but hasn't downloaded yet
- load_timings: per-model cold-load history, used to predict next load
- changelogs: recent HF repo commit messages, fetched lazily on demand
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger(__name__)

_BASE = Path.home() / ".config" / "crucible"
WISHLIST_FILE = _BASE / "wishlist.json"
TIMINGS_FILE = _BASE / "load_timings.json"
CHANGELOG_FILE = _BASE / "model_changelogs.json"


# ── Generic JSON helpers ───────────────────────────────────────────────────

def _read(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text())
    except Exception as e:
        log.warning("model_extras: bad %s (%s)", path, e)
        return default


def _write(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))


# ── Wishlist ───────────────────────────────────────────────────────────────

def wishlist_all() -> list[dict]:
    return _read(WISHLIST_FILE, [])


def wishlist_add(repo_id: str, kind: str = "mlx", note: str = "") -> dict:
    items = wishlist_all()
    if any(i["repo_id"] == repo_id for i in items):
        return next(i for i in items if i["repo_id"] == repo_id)
    entry = {
        "repo_id": repo_id, "kind": kind, "note": note,
        "added_at": time.time(),
    }
    items.append(entry)
    _write(WISHLIST_FILE, items)
    return entry


def wishlist_remove(repo_id: str) -> bool:
    items = wishlist_all()
    new = [i for i in items if i["repo_id"] != repo_id]
    if len(new) == len(items):
        return False
    _write(WISHLIST_FILE, new)
    return True


# ── Load timings — used for cold-load predictor ────────────────────────────

def record_load_timing(model_id: str, elapsed_ms: int, size_bytes: int) -> None:
    data: dict[str, list[dict]] = _read(TIMINGS_FILE, {})
    history = data.setdefault(model_id, [])
    history.append({
        "elapsed_ms": int(elapsed_ms),
        "size_bytes": int(size_bytes or 0),
        "ts": time.time(),
    })
    # Keep the most recent 20 timings per model.
    data[model_id] = history[-20:]
    _write(TIMINGS_FILE, data)


def predicted_load_ms(model_id: str, size_bytes: Optional[int]) -> Optional[int]:
    """Best-effort prediction: use the median of recent timings for this model
    if available, otherwise fall back to a rough size-based estimate
    (~1GB/sec on this class of hardware — good enough for a UI hint)."""
    data: dict[str, list[dict]] = _read(TIMINGS_FILE, {})
    hist = data.get(model_id, [])
    if hist:
        vals = sorted(h["elapsed_ms"] for h in hist)
        mid = vals[len(vals) // 2]
        return int(mid)
    if size_bytes and size_bytes > 0:
        # 1GB/sec is generous for cold cache; use as a upper-ish bound.
        return int((size_bytes / (1024 ** 3)) * 1000)
    return None


def timings_summary() -> dict[str, dict]:
    """Per-model: { count, median_ms, max_ms }. Useful for a debug view."""
    data: dict[str, list[dict]] = _read(TIMINGS_FILE, {})
    out: dict[str, dict] = {}
    for mid, hist in data.items():
        if not hist:
            continue
        vals = sorted(h["elapsed_ms"] for h in hist)
        out[mid] = {
            "count": len(vals),
            "median_ms": vals[len(vals) // 2],
            "max_ms": vals[-1],
        }
    return out


# ── Changelogs — HF repo commit history ────────────────────────────────────

CHANGELOG_CACHE_TTL_SECONDS = 6 * 3600


async def fetch_changelog(repo_id: str) -> list[dict]:
    """Fetch recent commits for an HF repo. Cached 6h. Each entry has
    {sha, title, created_at}. Empty list on any failure."""
    cache: dict[str, dict] = _read(CHANGELOG_FILE, {})
    entry = cache.get(repo_id)
    if entry and (time.time() - entry.get("fetched_at", 0)) < CHANGELOG_CACHE_TTL_SECONDS:
        return entry.get("commits", [])
    try:
        import httpx
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(f"https://huggingface.co/api/models/{repo_id}/commits/main")
            r.raise_for_status()
            rows = r.json()
        commits = [
            {
                "sha": c.get("id") or c.get("oid"),
                "title": (c.get("title") or c.get("message") or "").split("\n")[0][:200],
                "created_at": c.get("date") or c.get("created_at"),
            }
            for c in (rows if isinstance(rows, list) else [])
        ][:30]
        cache[repo_id] = {"fetched_at": time.time(), "commits": commits}
        _write(CHANGELOG_FILE, cache)
        return commits
    except Exception as e:
        log.warning("model_extras: changelog fetch failed for %s (%s)", repo_id, e)
        # Return stale cache if available rather than nothing.
        return entry.get("commits", []) if entry else []
