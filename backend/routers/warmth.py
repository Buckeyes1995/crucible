"""Model warmth analyzer — which models get loaded most, how often, recency.

Stores per-load events in a tiny JSON append-only log so we can see patterns
over time. The existing registry only tracks last_loaded; we need the full
history to reason about access cadence.
"""
from __future__ import annotations

import json
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Request

router = APIRouter()

WARMTH_LOG = Path.home() / ".config" / "crucible" / "warmth_log.jsonl"


def record_load_event(model_id: str) -> None:
    """Append a load event. Called from the models router on successful load."""
    try:
        WARMTH_LOG.parent.mkdir(parents=True, exist_ok=True)
        with WARMTH_LOG.open("a") as f:
            f.write(json.dumps({"model_id": model_id, "ts": time.time()}) + "\n")
    except Exception:
        pass


def _read_events(days_back: int | None = None) -> list[dict]:
    if not WARMTH_LOG.exists():
        return []
    cutoff = time.time() - (days_back * 86400) if days_back else None
    out = []
    try:
        with WARMTH_LOG.open() as f:
            for line in f:
                try:
                    rec = json.loads(line)
                    if cutoff and rec.get("ts", 0) < cutoff:
                        continue
                    out.append(rec)
                except Exception:
                    continue
    except Exception:
        return []
    return out


@router.get("/warmth")
async def warmth(request: Request, days: int = 30) -> dict:
    """Per-model load count + recency + projected pre-warm priority.

    Priority heuristic (0..1):
      0.5 * (load_count / max_count)      — how often
      + 0.5 * exp(-(days_since_last_load) / 14)   — how recently
    So the most-loaded + recently-touched model ranks highest.
    """
    import math
    registry = request.app.state.registry
    events = _read_events(days)
    counts = Counter(e["model_id"] for e in events)
    last_seen: dict[str, float] = {}
    for e in events:
        mid = e["model_id"]
        last_seen[mid] = max(last_seen.get(mid, 0), e.get("ts", 0))

    max_count = max(counts.values()) if counts else 1
    now = time.time()

    rows = []
    for m in registry.all():
        if m.node != "local":
            continue
        count = counts.get(m.id, 0)
        last = last_seen.get(m.id)
        days_since = (now - last) / 86400 if last else None
        # Priority score — normalized 0..1
        freq_score = count / max_count if max_count else 0
        recency_score = math.exp(-(days_since or 999) / 14) if days_since is not None else 0
        priority = round(0.5 * freq_score + 0.5 * recency_score, 3)
        rows.append({
            "model_id": m.id,
            "name": m.name,
            "kind": m.kind,
            "load_count": count,
            "last_load_ts": last,
            "days_since_last_load": round(days_since, 2) if days_since is not None else None,
            "priority": priority,
        })
    rows.sort(key=lambda r: r["priority"], reverse=True)
    return {
        "window_days": days,
        "total_events": len(events),
        "unique_models": len(counts),
        "models": rows,
    }
