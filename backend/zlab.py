"""Tracks z-lab on HuggingFace — the org that publishes DFlash draft models.

Caches the list of z-lab repos in ~/.config/crucible/zlab_drafts.json and
cross-references against local models so we can surface "draft available"
indicators in the UI.
"""
import json
import logging
import re
import time
from pathlib import Path
from typing import Any

import httpx

CACHE_FILE = Path.home() / ".config" / "crucible" / "zlab_drafts.json"
HF_API = "https://huggingface.co/api/models"
ORG = "z-lab"
TTL_SECONDS = 6 * 3600  # re-fetch at most every 6h unless forced

log = logging.getLogger(__name__)


def _norm(name: str) -> str:
    """Strip quant/format/marketing suffixes so Qwen3.5-27B-8bit matches Qwen3.5-27B."""
    s = name.lower()
    s = re.sub(r"-(mlx|gguf|instruct|chat|hf)(?=$|[-_])", "", s)
    s = re.sub(r"-(mxfp\d+|q\d+_k_[ms]|q\d+_\d|q\d+|fp16|bf16|f16|f32|\d+bit)(?=$|[-_])", "", s)
    s = re.sub(r"-(crack|abliterated|distilled|uncensored|ultrachat|b\d+)(?=$|[-_])", "", s)
    s = re.sub(r"[-_]+", "-", s).strip("-")
    return s


def _load_cache() -> dict[str, Any]:
    if not CACHE_FILE.exists():
        return {"fetched_at": 0, "repos": []}
    try:
        return json.loads(CACHE_FILE.read_text())
    except Exception:
        return {"fetched_at": 0, "repos": []}


def _save_cache(data: dict[str, Any]) -> None:
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps(data, indent=2))


async def fetch_repos(force: bool = False) -> list[dict[str, Any]]:
    """Fetch z-lab repo list from HF. Cached for TTL_SECONDS."""
    cache = _load_cache()
    age = time.time() - cache.get("fetched_at", 0)
    if not force and age < TTL_SECONDS and cache.get("repos"):
        return cache["repos"]

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(HF_API, params={"author": ORG, "limit": 200})
            r.raise_for_status()
            raw = r.json()
    except Exception as e:
        log.warning("zlab: HF fetch failed: %s", e)
        return cache.get("repos", [])

    repos = [
        {
            "id": item.get("id", ""),
            "lastModified": item.get("lastModified", ""),
            "downloads": item.get("downloads", 0),
            "tags": item.get("tags", []),
        }
        for item in raw
        if item.get("id", "").startswith(f"{ORG}/")
    ]
    _save_cache({"fetched_at": time.time(), "repos": repos})
    return repos


def _draft_repos(repos: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [r for r in repos if r["id"].endswith("-DFlash") or "-DFlash-" in r["id"]]


def match_draft_for(model_name: str, repos: list[dict[str, Any]]) -> str | None:
    """Return the z-lab draft repo ID that matches model_name, or None."""
    target = _norm(model_name)
    if not target:
        return None
    best: tuple[int, str] | None = None  # (score, repo_id)
    for r in _draft_repos(repos):
        repo_base = r["id"].split("/", 1)[1]
        stripped = re.sub(r"-dflash(-[a-z0-9]+)?$", "", repo_base.lower())
        stripped = _norm(stripped)
        if not stripped:
            continue
        if target == stripped:
            return r["id"]
        # allow target to contain repo base (our "Qwen3.5-35B-A3B-8bit" vs z-lab "Qwen3.5-35B-A3B")
        if target.startswith(stripped + "-") or target.startswith(stripped):
            score = len(stripped)
            if best is None or score > best[0]:
                best = (score, r["id"])
    return best[1] if best else None


async def build_match_map(model_names: list[str], force_refresh: bool = False) -> dict[str, str | None]:
    repos = await fetch_repos(force=force_refresh)
    return {name: match_draft_for(name, repos) for name in model_names}


def cache_info() -> dict[str, Any]:
    cache = _load_cache()
    fetched_at = cache.get("fetched_at", 0)
    return {
        "fetched_at": fetched_at,
        "age_seconds": int(time.time() - fetched_at) if fetched_at else None,
        "repo_count": len(cache.get("repos", [])),
        "draft_count": len(_draft_repos(cache.get("repos", []))),
    }
