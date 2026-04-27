"""Utility to free a TCP port before binding a subprocess to it."""
import asyncio
import logging
import signal

log = logging.getLogger(__name__)


async def kill_port(port: int, timeout: float = 5.0) -> None:
    """Kill any process(es) listening on the given TCP port.

    Uses lsof to find PIDs, sends SIGTERM, waits, then SIGKILL if needed.
    Silently does nothing if the port is already free.
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            "lsof", "-ti", f":{port}", "-sTCP:LISTEN",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5.0)
    except Exception:
        return

    pids = [int(p) for p in stdout.decode().split() if p.strip().isdigit()]
    if not pids:
        return

    log.warning("Port %d in use by PID(s) %s — sending SIGTERM", port, pids)
    for pid in pids:
        try:
            import os
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

    # Wait up to timeout for them to exit, then SIGKILL stragglers
    deadline = asyncio.get_event_loop().time() + timeout
    remaining = list(pids)
    while remaining and asyncio.get_event_loop().time() < deadline:
        await asyncio.sleep(0.3)
        still_alive = []
        for pid in remaining:
            try:
                import os
                os.kill(pid, 0)  # signal 0 = existence check
                still_alive.append(pid)
            except ProcessLookupError:
                pass
        remaining = still_alive

    for pid in remaining:
        log.warning("PID %d did not exit — sending SIGKILL", pid)
        try:
            import os
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    # The PID is dead but the kernel may not have fully released the listening
    # socket yet — observed 2026-04-26: kill_port returned, the new spawn
    # immediately tried to bind :8080, and got EADDRINUSE because the dying
    # llama-server hadn't released the socket. Re-poll lsof until the port
    # is genuinely unbound (or we hit the deadline).
    verify_deadline = asyncio.get_event_loop().time() + 3.0
    while asyncio.get_event_loop().time() < verify_deadline:
        await asyncio.sleep(0.2)
        try:
            check = await asyncio.create_subprocess_exec(
                "lsof", "-ti", f":{port}", "-sTCP:LISTEN",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            check_out, _ = await asyncio.wait_for(check.communicate(), timeout=2.0)
        except Exception:
            break  # lsof flaked — best-effort, proceed
        if not check_out.strip():
            return
    log.warning("Port %d still has a listener after kill — proceeding anyway", port)
