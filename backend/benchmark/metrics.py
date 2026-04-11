"""System metrics collection (memory pressure, thermal state)."""
import asyncio
import re
import subprocess
from typing import Optional


def _parse_vm_stat() -> dict[str, int]:
    try:
        out = subprocess.check_output(["vm_stat"], text=True, timeout=5)
    except Exception:
        return {}
    result = {}
    for line in out.splitlines():
        m = re.match(r"^(.+?):\s+([\d]+)", line)
        if m:
            result[m.group(1).strip()] = int(m.group(2))
    return result


def get_memory_pressure() -> Optional[float]:
    """Return memory pressure as a float 0.0–1.0 using vm_stat page counts."""
    stats = _parse_vm_stat()
    if not stats:
        return None
    pages_free = stats.get("Pages free", 0)
    pages_active = stats.get("Pages active", 0)
    pages_inactive = stats.get("Pages inactive", 0)
    pages_wired = stats.get("Pages wired down", 0)
    pages_compressed = stats.get("Pages occupied by compressor", 0)
    total = pages_free + pages_active + pages_inactive + pages_wired + pages_compressed
    if total == 0:
        return None
    used = pages_active + pages_wired + pages_compressed
    return round(used / total, 4)


def get_thermal_state() -> str:
    """Return macOS thermal state string via sysctl (Apple Silicon compatible)."""
    # Apple Silicon: machdep.thermal_level (0=nominal, 33=fair, 66=serious, 100=critical)
    for oid in ("machdep.thermal_level", "kern.thermal_level"):
        try:
            out = subprocess.check_output(
                ["sysctl", "-n", oid],
                text=True,
                timeout=5,
                stderr=subprocess.DEVNULL,
            ).strip()
            level = int(out)
            if level == 0:
                return "nominal"
            elif level <= 33:
                return "fair"
            elif level <= 66:
                return "serious"
            else:
                return "critical"
        except Exception:
            continue
    return "nominal"


def compute_percentiles(tps_values: list[float]) -> dict[str, Optional[float]]:
    """Compute p50/p90/p99 from a list of tok/s values."""
    if not tps_values:
        return {"p50": None, "p90": None, "p99": None}
    sorted_vals = sorted(tps_values)
    n = len(sorted_vals)

    def percentile(p: float) -> float:
        idx = max(0, min(n - 1, int(p / 100 * n)))
        return sorted_vals[idx]

    return {
        "p50": round(percentile(50), 2),
        "p90": round(percentile(90), 2),
        "p99": round(percentile(99), 2),
    }


def compute_tps_from_timestamps(timestamps: list[float]) -> list[float]:
    """
    Given a list of monotonic timestamps (one per token),
    compute instantaneous tok/s between consecutive tokens.
    """
    if len(timestamps) < 2:
        return []
    rates = []
    for i in range(1, len(timestamps)):
        dt = timestamps[i] - timestamps[i - 1]
        if dt > 0:
            rates.append(1.0 / dt)
    return rates
