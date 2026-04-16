"""HuggingFace upstream update watcher.

Per local model, we track:
- origin_repo: the HF repo the model came from (auto-filled from hf_downloader jobs; user-editable)
- downloaded_at: when we acquired it
- upstream_last_modified: HF's lastModified from the most recent check
- last_checked: when we last asked HF
- update_available: bool derived from comparing downloaded_at vs upstream_last_modified

State lives in ~/.config/crucible/hf_updates.json keyed by model_id.
"""
import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import httpx

STATE_FILE = Path.home() / ".config" / "crucible" / "hf_updates.json"
HF_API = "https://huggingface.co/api/models"

log = logging.getLogger(__name__)


def _load() -> dict[str, dict[str, Any]]:
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return {}


def _save(data: dict[str, dict[str, Any]]) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(data, indent=2))


def get_state(model_id: str) -> dict[str, Any]:
    return _load().get(model_id, {})


def all_state() -> dict[str, dict[str, Any]]:
    return _load()


def set_origin_repo(model_id: str, repo_id: str | None, downloaded_at: float | None = None) -> dict[str, Any]:
    data = _load()
    entry = data.get(model_id, {})
    if repo_id:
        entry["origin_repo"] = repo_id
        if downloaded_at is not None or "downloaded_at" not in entry:
            entry["downloaded_at"] = downloaded_at if downloaded_at is not None else time.time()
    else:
        entry.pop("origin_repo", None)
        entry.pop("downloaded_at", None)
        entry.pop("upstream_last_modified", None)
        entry.pop("update_available", None)
    data[model_id] = entry
    _save(data)
    return entry


def _parse_iso(s: str) -> float | None:
    if not s:
        return None
    try:
        # HF returns ISO-8601 like "2024-11-15T06:20:42.000Z"
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


async def _fetch_last_modified(client: httpx.AsyncClient, repo_id: str) -> str | None:
    try:
        r = await client.get(f"{HF_API}/{repo_id}", timeout=10.0)
        if r.status_code != 200:
            return None
        return r.json().get("lastModified") or None
    except Exception as e:
        log.debug("hf_updates: fetch failed for %s: %s", repo_id, e)
        return None


async def check_models(model_ids: Iterable[str]) -> dict[str, dict[str, Any]]:
    """Refresh upstream lastModified for the given model IDs. Returns newly flagged ids."""
    data = _load()
    to_check = [(mid, data[mid]["origin_repo"]) for mid in model_ids if mid in data and data[mid].get("origin_repo")]
    if not to_check:
        return {}

    newly_flagged: dict[str, dict[str, Any]] = {}
    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(*(_fetch_last_modified(client, repo) for _, repo in to_check))

    now = time.time()
    for (mid, repo), last_mod in zip(to_check, results):
        entry = data[mid]
        entry["last_checked"] = now
        if last_mod:
            prev_avail = entry.get("update_available", False)
            entry["upstream_last_modified"] = last_mod
            upstream_ts = _parse_iso(last_mod)
            downloaded_ts = entry.get("downloaded_at", 0)
            update_avail = bool(upstream_ts and downloaded_ts and upstream_ts > downloaded_ts)
            entry["update_available"] = update_avail
            if update_avail and not prev_avail:
                newly_flagged[mid] = {"origin_repo": repo, "upstream_last_modified": last_mod}
        data[mid] = entry

    _save(data)
    return newly_flagged


def seed_from_downloads(jobs: list[dict[str, Any]]) -> int:
    """Populate origin_repo from completed hf_downloader jobs. Returns count added."""
    data = _load()
    added = 0
    for job in jobs:
        if job.get("status") != "done":
            continue
        repo_id = job.get("repo_id")
        local_dir = job.get("local_dir") or ""
        if not repo_id or not local_dir:
            continue
        dir_name = Path(local_dir).name
        kind = job.get("kind") or "mlx"
        model_id = f"{kind}:{dir_name}"
        if model_id in data and data[model_id].get("origin_repo"):
            continue
        finished_at = job.get("finished_at") or job.get("started_at") or time.time()
        data[model_id] = {
            "origin_repo": repo_id,
            "downloaded_at": finished_at,
            **data.get(model_id, {}),
        }
        # restore own value in case dict merge overwrote
        data[model_id]["origin_repo"] = repo_id
        data[model_id]["downloaded_at"] = finished_at
        added += 1
    if added:
        _save(data)
    return added
