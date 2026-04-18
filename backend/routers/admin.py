"""Admin endpoints: backend reset, memory recovery."""
import asyncio
import logging
import os

from fastapi import APIRouter, Request

from adapters.port_utils import kill_port

router = APIRouter()
log = logging.getLogger(__name__)


async def _port_pid(port: int) -> int | None:
    """Return the PID listening on TCP `port`, or None."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "lsof", "-ti", f":{port}", "-sTCP:LISTEN",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=3.0)
    except Exception:
        return None
    for token in out.decode().split():
        if token.strip().isdigit():
            return int(token)
    return None


async def _kickstart_omlx() -> bool:
    """Ask launchd to restart com.jim.omlx. Returns True on success."""
    try:
        uid = os.getuid()
        proc = await asyncio.create_subprocess_exec(
            "launchctl", "kickstart", "-k", f"gui/{uid}/com.jim.omlx",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        await asyncio.wait_for(proc.communicate(), timeout=10.0)
        return proc.returncode == 0
    except Exception as e:
        log.warning("launchctl kickstart failed: %s", e)
        return False


@router.post("/admin/reset-backends")
async def reset_backends(request: Request) -> dict:
    """Stop all adapters and force a fresh oMLX process.

    Used when memory doesn't free up properly (e.g. oMLX stale-state).
    Unlike plain kill_port, this uses launchctl kickstart so launchd's
    keepalive doesn't race against our kill, producing a reliable fresh PID.
    """
    cfg = request.app.state.config
    steps: list[str] = []

    # 1) Drop adapters so callers don't think a stale one is usable
    for attr in ("active_adapter", "compare_adapter"):
        adapter = getattr(request.app.state, attr, None)
        if adapter:
            try:
                await adapter.stop()
                steps.append(f"stopped {attr}")
            except Exception as e:
                steps.append(f"{attr} stop failed: {e}")
            setattr(request.app.state, attr, None)

    # 2) Restart oMLX via launchd (preserves args, avoids kill-vs-respawn race)
    pid_before = await _port_pid(8000)
    if await _kickstart_omlx():
        # Wait up to ~15s for launchd to come back up with a NEW pid
        pid_after = pid_before
        for _ in range(50):
            await asyncio.sleep(0.3)
            pid_after = await _port_pid(8000)
            if pid_after and pid_after != pid_before:
                break
        if pid_after and pid_after != pid_before:
            steps.append(f"oMLX restarted (pid {pid_before} → {pid_after})")
        else:
            # launchd will finish the respawn async — return anyway, user can verify
            steps.append(f"oMLX kickstart issued; launchd will respawn (was pid {pid_before})")
    else:
        # Fallback: kill_port directly
        await kill_port(8000)
        steps.append("launchctl kickstart failed, fell back to kill_port(8000)")

    # 3) Other subprocess ports — these have no launchd keeper, plain kill is fine
    for port in (cfg.mlx_port, cfg.llama_port, cfg.llama_compare_port):
        await kill_port(port)
        steps.append(f"killed port {port}")

    return {"status": "ok", "steps": steps}
