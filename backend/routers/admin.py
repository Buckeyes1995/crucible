"""Admin endpoints: backend reset, memory recovery."""
import asyncio
import logging
import shlex

from fastapi import APIRouter, Request

from adapters.port_utils import kill_port

router = APIRouter()
log = logging.getLogger(__name__)


async def _get_listening_cmdline(port: int) -> str | None:
    """Return the full command line of whatever is listening on the given TCP port."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "lsof", "-ti", f":{port}", "-sTCP:LISTEN",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=3.0)
    except Exception:
        return None
    pids = [p for p in out.decode().split() if p.strip().isdigit()]
    if not pids:
        return None
    pid = pids[0]
    try:
        proc = await asyncio.create_subprocess_exec(
            "ps", "-p", pid, "-ww", "-o", "command=",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=3.0)
    except Exception:
        return None
    cmd = out.decode().strip()
    return cmd or None


@router.post("/admin/reset-backends")
async def reset_backends(request: Request) -> dict:
    """Stop all adapters, kill backend subprocesses, and restart oMLX with its current args.

    Used when memory doesn't free up properly (e.g. oMLX stale-state, stuck llama-server).
    """
    cfg = request.app.state.config
    steps: list[str] = []

    # 1) Clean-stop any active adapters
    for attr in ("active_adapter", "compare_adapter"):
        adapter = getattr(request.app.state, attr, None)
        if adapter:
            try:
                await adapter.stop()
                steps.append(f"stopped {attr}")
            except Exception as e:
                steps.append(f"{attr} stop failed: {e}")
            setattr(request.app.state, attr, None)

    # 2) Capture oMLX's current command line BEFORE killing it so we can relaunch
    omlx_cmd = await _get_listening_cmdline(8000)

    # 3) Kill backend ports — oMLX (8000), mlx_lm.server, llama-server (+ compare)
    for port in (8000, cfg.mlx_port, cfg.llama_port, cfg.llama_compare_port):
        await kill_port(port)
        steps.append(f"killed port {port}")

    # 4) Restart oMLX if we captured a valid command
    if omlx_cmd:
        try:
            # Parse and spawn detached; log to /tmp so it persists across backend reloads
            args = shlex.split(omlx_cmd)
            log_f = open("/tmp/omlx.log", "ab")
            await asyncio.create_subprocess_exec(
                *args,
                stdout=log_f, stderr=log_f,
                start_new_session=True,
            )
            steps.append(f"restarted oMLX: {args[0]} …")
        except Exception as e:
            steps.append(f"oMLX restart failed: {e}")
    else:
        steps.append("oMLX was not running — not restarted")

    return {"status": "ok", "steps": steps}
