"""Minimal usage tracker — per-API-key-per-day token counts.

Counts are kept in ~/.config/crucible/usage.json. The main counters we care
about: tokens_in / tokens_out / requests. Per-day buckets so sparklines
over N days render cheaply.
"""
from __future__ import annotations

import json
import time
from datetime import date
from pathlib import Path
from typing import Any

USAGE_FILE = Path.home() / ".config" / "crucible" / "usage.json"


def _read() -> dict[str, Any]:
    if not USAGE_FILE.exists():
        return {}
    try:
        return json.loads(USAGE_FILE.read_text())
    except Exception:
        return {}


def _write(data: dict[str, Any]) -> None:
    USAGE_FILE.parent.mkdir(parents=True, exist_ok=True)
    USAGE_FILE.write_text(json.dumps(data, indent=2))


def record(api_key_tag: str, tokens_in: int, tokens_out: int,
           model_id: str | None = None) -> None:
    """Bump the day's counters. `api_key_tag` is a short label (e.g. first 8
    chars of the key, or 'anonymous') — we never store the raw key."""
    data = _read()
    today = date.today().isoformat()
    day = data.setdefault(today, {})
    bucket = day.setdefault(api_key_tag or "anonymous", {
        "tokens_in": 0, "tokens_out": 0, "requests": 0, "by_model": {},
    })
    bucket["tokens_in"] += int(tokens_in or 0)
    bucket["tokens_out"] += int(tokens_out or 0)
    bucket["requests"] += 1
    if model_id:
        mbucket = bucket["by_model"].setdefault(model_id, {
            "tokens_in": 0, "tokens_out": 0, "requests": 0,
        })
        mbucket["tokens_in"] += int(tokens_in or 0)
        mbucket["tokens_out"] += int(tokens_out or 0)
        mbucket["requests"] += 1
    data["_last_updated"] = time.time()
    _write(data)


def summary(days: int = 30) -> dict[str, Any]:
    """Per-day totals for the last `days`. Also overall + per-key top N."""
    data = _read()
    today = date.today()
    buckets: list[dict] = []
    total_in = 0
    total_out = 0
    total_requests = 0
    per_key: dict[str, dict] = {}
    for day_key in sorted(data.keys()):
        if day_key.startswith("_"):
            continue
        try:
            y, m, d = (int(x) for x in day_key.split("-"))
        except Exception:
            continue
        delta = (today - date(y, m, d)).days
        if delta < 0 or delta > days:
            continue
        day_total = {"date": day_key, "tokens_in": 0, "tokens_out": 0, "requests": 0}
        for key, vals in data[day_key].items():
            day_total["tokens_in"] += vals.get("tokens_in", 0)
            day_total["tokens_out"] += vals.get("tokens_out", 0)
            day_total["requests"] += vals.get("requests", 0)
            k_bucket = per_key.setdefault(key, {
                "tokens_in": 0, "tokens_out": 0, "requests": 0,
            })
            k_bucket["tokens_in"] += vals.get("tokens_in", 0)
            k_bucket["tokens_out"] += vals.get("tokens_out", 0)
            k_bucket["requests"] += vals.get("requests", 0)
        total_in += day_total["tokens_in"]
        total_out += day_total["tokens_out"]
        total_requests += day_total["requests"]
        buckets.append(day_total)
    return {
        "days": days,
        "totals": {"tokens_in": total_in, "tokens_out": total_out, "requests": total_requests},
        "per_day": buckets,
        "per_key": per_key,
    }
