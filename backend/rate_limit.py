"""Per-API-key rate limiting — in-memory token bucket. Intentionally simple:
we're not billing anyone off this, and losing counters on restart is fine.

Used by the /v1/* proxy to cap abuse from a shared Cloudflare tunnel.
"""
from __future__ import annotations

import threading
import time
from typing import Any

# Defaults — generous. Tunable at runtime via update_limits().
_limits: dict[str, dict[str, Any]] = {
    "default":   {"rps": 5,  "burst": 20},
    "anonymous": {"rps": 2,  "burst": 10},
}

_state: dict[str, dict[str, float]] = {}  # key_tag -> {tokens, last}
_lock = threading.Lock()


def update_limits(per_key: dict[str, dict[str, Any]]) -> None:
    """Merge user-supplied overrides into the defaults."""
    with _lock:
        for k, v in per_key.items():
            _limits[k] = {**_limits.get("default", {"rps": 5, "burst": 20}), **v}


def current_limits() -> dict[str, dict[str, Any]]:
    with _lock:
        return dict(_limits)


def allow(key_tag: str) -> bool:
    """Return True if the caller may proceed; False if rate-limited."""
    now = time.monotonic()
    cfg = _limits.get(key_tag) or _limits.get("default") or {"rps": 5, "burst": 20}
    rps = float(cfg["rps"])
    burst = float(cfg["burst"])
    with _lock:
        s = _state.setdefault(key_tag, {"tokens": burst, "last": now})
        # Refill.
        dt = now - s["last"]
        s["tokens"] = min(burst, s["tokens"] + dt * rps)
        s["last"] = now
        if s["tokens"] >= 1.0:
            s["tokens"] -= 1.0
            return True
        return False
