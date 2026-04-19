"""Disk pressure / model reclaim endpoints.

Gives the UI enough to answer 'which local models haven't I used in N days,
and how much would I reclaim by deleting them?' without forcing the user to
scan /models by eye. Reuses the existing registry state + last_loaded
timestamps — no new tracking needed.
"""
from __future__ import annotations

import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()


def _age_days(iso: str | None) -> float | None:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        delta = datetime.now(timezone.utc) - dt
        return round(delta.total_seconds() / 86400, 2)
    except Exception:
        return None


def _dir_size_bytes(path: str) -> int:
    """Sum all file sizes under a directory. Returns 0 for non-existent paths
    so we don't blow up on stale registry entries."""
    total = 0
    try:
        for root, _dirs, files in os.walk(path):
            for f in files:
                try:
                    total += os.path.getsize(os.path.join(root, f))
                except Exception:
                    pass
    except Exception:
        return 0
    return total


@router.get("/disk/summary")
async def summary(request: Request) -> dict:
    """Per-model disk usage + last-loaded age, sorted by how 'idle' they are.
    Frontend uses this to rank candidates for pruning."""
    registry = request.app.state.registry
    models = []
    total_bytes = 0
    by_kind: dict[str, int] = {}
    now = datetime.now(timezone.utc)
    for m in registry.all():
        if m.node != "local" or not m.path:
            continue
        # Prefer size_bytes from the registry (already computed); fall back to
        # a live du-style walk for models that didn't report one.
        size = int(m.size_bytes or 0) or _dir_size_bytes(m.path)
        age = _age_days(m.last_loaded)
        models.append({
            "id": m.id,
            "name": m.name,
            "kind": m.kind,
            "path": m.path,
            "size_bytes": size,
            "last_loaded": m.last_loaded,
            "days_since_loaded": age,
            "never_loaded": m.last_loaded is None,
        })
        total_bytes += size
        by_kind[m.kind] = by_kind.get(m.kind, 0) + size

    # Sort: never-loaded first, then oldest-load, then largest
    def _sort_key(row: dict):
        age = row["days_since_loaded"]
        # None (never loaded) comes first; we use a huge number so it floats up
        # when we sort descending on age.
        return (age if age is not None else 10 ** 9, row["size_bytes"])
    models.sort(key=_sort_key, reverse=True)

    # Live free bytes on the volume containing mlx_dir (best proxy for "how
    # much disk pressure are we under").
    cfg = request.app.state.config
    probe_path = cfg.mlx_dir or str(Path.home())
    try:
        usage = shutil.disk_usage(probe_path)
        volume = {
            "path": str(probe_path),
            "total_bytes": usage.total,
            "used_bytes": usage.used,
            "free_bytes": usage.free,
        }
    except Exception:
        volume = None

    return {
        "now": now.isoformat(),
        "total_bytes_used_by_models": total_bytes,
        "by_kind": by_kind,
        "models": models,
        "volume": volume,
    }


class ReclaimRequest(BaseModel):
    model_ids: list[str]


@router.post("/disk/reclaim")
async def reclaim(request: Request, body: ReclaimRequest) -> dict:
    """Bulk-delete a list of models from disk. Mirrors the safety rules of
    DELETE /models/{id}/disk: only local mlx/gguf/vllm models, and the target
    path must be under one of the configured model directories."""
    registry = request.app.state.registry
    config = request.app.state.config
    allowed_roots = []
    for attr in ("mlx_dir", "gguf_dir", "vllm_dir"):
        val = getattr(config, attr, None)
        if val:
            try:
                allowed_roots.append(Path(val).expanduser().resolve())
            except Exception:
                pass

    results = []
    freed = 0
    for mid in body.model_ids:
        m = registry.get(mid)
        if not m:
            results.append({"id": mid, "ok": False, "reason": "not found"})
            continue
        if m.node != "local" or m.kind not in ("mlx", "gguf", "vllm") or not m.path:
            results.append({"id": mid, "ok": False, "reason": f"cannot delete kind={m.kind}"})
            continue
        try:
            target = Path(m.path).expanduser().resolve()
        except Exception:
            results.append({"id": mid, "ok": False, "reason": "path resolve failed"})
            continue
        # Ensure the target is under at least one configured root — refuse
        # anything else to avoid deleting unrelated files.
        if not any(str(target).startswith(str(root) + "/") or target == root for root in allowed_roots):
            results.append({"id": mid, "ok": False, "reason": "path not under a configured model dir"})
            continue
        try:
            size = int(m.size_bytes or 0) or _dir_size_bytes(str(target))
            shutil.rmtree(target)
            freed += size
            results.append({"id": mid, "ok": True, "bytes_freed": size})
        except Exception as e:
            results.append({"id": mid, "ok": False, "reason": str(e)})
    try:
        await registry.refresh()
    except Exception:
        pass
    return {"results": results, "bytes_freed_total": freed}
