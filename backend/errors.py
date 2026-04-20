"""Structured error taxonomy — classify common adapter / runtime failures into
a handful of buckets so UI components can react uniformly (banner color,
suggested action, etc.) rather than every caller string-matching.
"""
from __future__ import annotations

from typing import Any


# Category → (label, suggested_user_action). Ordered so earlier matches win.
CATEGORIES = [
    ("oom",              ("Out of memory", "Close other models or pick a smaller quant.")),
    ("auth",             ("Auth", "Check your API key / bearer token in Settings.")),
    ("not_found_model",  ("Model missing", "Download the model from /store or check the path in Settings.")),
    ("port_in_use",      ("Port busy", "Another process is holding the adapter's port. Stop it or reconfigure in Settings.")),
    ("network",          ("Network", "Upstream API (HuggingFace / Brave / etc.) is unreachable — retry later.")),
    ("timeout",          ("Timeout", "The upstream took too long. Try a smaller model or raise the timeout.")),
    ("bad_request",      ("Bad request", "Input payload was rejected. Check the request body against the endpoint docs.")),
    ("unknown",          ("Unknown", "No classification matched. See the raw message below.")),
]


def _matches_oom(msg: str) -> bool:
    m = msg.lower()
    return any(x in m for x in (
        "out of memory", "oom", "cannot allocate", "cuda out", "metal oom",
        "mps out of memory",
    ))


def classify(message: str) -> dict[str, Any]:
    msg = (message or "").strip()
    low = msg.lower()
    cat = "unknown"
    if _matches_oom(low):
        cat = "oom"
    elif any(x in low for x in ("401", "403", "unauthorized", "forbidden", "api key", "bearer")):
        cat = "auth"
    elif any(x in low for x in ("no such file", "not found", "404 model", "model missing", "file does not exist")):
        cat = "not_found_model"
    elif any(x in low for x in ("address already in use", "port", "bind", "48]")):
        cat = "port_in_use"
    elif any(x in low for x in ("timed out", "timeout", "deadline")):
        cat = "timeout"
    elif any(x in low for x in ("connection refused", "connection error", "name resolution", "unreachable", "network")):
        cat = "network"
    elif any(x in low for x in ("400 bad request", "validation error", "bad request")):
        cat = "bad_request"

    label, action = dict(CATEGORIES)[cat]
    return {
        "category": cat,
        "label": label,
        "suggested_action": action,
        "message": msg[:1000],
    }
