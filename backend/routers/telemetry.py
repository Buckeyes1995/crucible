"""System telemetry — lightweight CPU + memory + thermal snapshot for the
sidebar/footer live meter. Kept non-streaming so the frontend can poll it with
a simple interval."""
from __future__ import annotations

import asyncio

import psutil
from fastapi import APIRouter

from benchmark.metrics import get_thermal_state

router = APIRouter()


@router.get("/system/telemetry")
async def telemetry() -> dict:
    # psutil.cpu_percent with interval=None returns the rate since the last
    # call in this process. Taking a 0.1s blocking sample gives a reasonable
    # live-ish number without hanging the event loop for long.
    cpu_pct = await asyncio.get_event_loop().run_in_executor(
        None, lambda: psutil.cpu_percent(interval=0.1),
    )
    vm = psutil.virtual_memory()
    thermal = await asyncio.get_event_loop().run_in_executor(None, get_thermal_state)

    # Power sampling via `powermetrics` needs passwordless sudo — not safe to
    # assume. We attempt a no-prompt invocation and give up on failure so the
    # endpoint stays cheap and unattended.
    package_watts: float | None = None
    try:
        proc = await asyncio.create_subprocess_exec(
            "sudo", "-n", "powermetrics",
            "--samplers", "cpu_power",
            "-i", "200", "-n", "1", "-f", "plist",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout_b, _ = await asyncio.wait_for(proc.communicate(), timeout=2.0)
        text = stdout_b.decode("utf-8", errors="replace")
        import re
        m = re.search(r"<key>combined_power</key>\s*<integer>(\d+)</integer>", text)
        if m:
            package_watts = int(m.group(1)) / 1000.0
    except Exception:
        pass

    return {
        "cpu_percent": round(cpu_pct, 1),
        "mem_percent": round((vm.total - vm.available) / vm.total * 100, 1) if vm.total else 0.0,
        "mem_available_bytes": vm.available,
        "mem_total_bytes": vm.total,
        "thermal_state": thermal,
        "package_watts": package_watts,
    }
