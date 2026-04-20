"""MCP client/host — spawn installed MCP servers and talk JSON-RPC 2.0 over stdio.

Scope of this module:
  * One subprocess per installed MCP, started lazily on first request.
  * initialize → notifications/initialized handshake per MCP spec.
  * tools/list (cached for CACHE_TTL) and tools/call pass-through.
  * Idle servers auto-stop after IDLE_TIMEOUT_S so we don't leak processes.

What this module does NOT do:
  * Wire tool calls into chat/arena/workflows. That's a separate integration
    layer — this is the plumbing it would sit on top of.
  * Resources / prompts / sampling / roots. Tools-only for now.

Protocol reference: https://spec.modelcontextprotocol.io/
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any

log = logging.getLogger(__name__)

CACHE_TTL = 60.0        # how long tools/list results are considered fresh
IDLE_TIMEOUT_S = 300.0  # auto-stop a server after 5 minutes of no requests
CALL_TIMEOUT_S = 60.0   # per-request timeout


class MCPError(Exception):
    """Raised when the MCP server returns an error, or the client can't reach it."""


class _MCPClient:
    """Single long-lived connection to one MCP server subprocess."""

    def __init__(self, mcp_id: str, name: str, command: str,
                 args: list[str], env: dict[str, str]) -> None:
        self.mcp_id = mcp_id
        self.name = name
        self.command = command
        self.args = list(args)
        self.env = dict(env)
        self.proc: asyncio.subprocess.Process | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._reader: asyncio.StreamReader | None = None
        self._req_id = 0
        self._pending: dict[int, asyncio.Future[Any]] = {}
        self._tools_cache: list[dict] | None = None
        self._tools_cache_at = 0.0
        self._lock = asyncio.Lock()  # serialize initialize / reconnect
        self._reader_task: asyncio.Task | None = None
        self._stderr_task: asyncio.Task | None = None
        self._last_used_at = time.monotonic()
        self._initialized = False

    async def start(self) -> None:
        async with self._lock:
            if self.proc and self.proc.returncode is None:
                return
            # Merge the user's env into the parent's so npx / uvx find node /
            # homebrew / etc. Explicit entries from the registry override.
            merged_env = os.environ.copy()
            for k, v in self.env.items():
                merged_env[k] = v
            log.info("mcp-host: spawning %s (%s %s)", self.mcp_id, self.command, " ".join(self.args))
            self.proc = await asyncio.create_subprocess_exec(
                self.command, *self.args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=merged_env,
            )
            assert self.proc.stdin and self.proc.stdout and self.proc.stderr
            self._writer = self.proc.stdin
            self._reader = self.proc.stdout
            self._reader_task = asyncio.create_task(self._read_loop())
            self._stderr_task = asyncio.create_task(self._drain_stderr())
            try:
                await self._handshake()
            except Exception:
                await self._teardown()
                raise
            self._initialized = True

    async def _handshake(self) -> None:
        # Per MCP spec: client sends `initialize`, server replies, client
        # sends `notifications/initialized` (no response expected).
        result = await self._request("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "crucible", "version": "1.0"},
        })
        log.info("mcp-host: %s initialized (server: %s)", self.mcp_id,
                 result.get("serverInfo", {}).get("name", "?"))
        await self._notify("notifications/initialized", {})

    async def list_tools(self, force: bool = False) -> list[dict]:
        self._last_used_at = time.monotonic()
        if not force and self._tools_cache is not None:
            if time.monotonic() - self._tools_cache_at < CACHE_TTL:
                return self._tools_cache
        await self.start()
        result = await self._request("tools/list", {})
        tools = result.get("tools") or []
        self._tools_cache = tools
        self._tools_cache_at = time.monotonic()
        return tools

    async def call_tool(self, tool_name: str, arguments: dict) -> dict:
        self._last_used_at = time.monotonic()
        await self.start()
        return await self._request("tools/call", {
            "name": tool_name,
            "arguments": arguments,
        })

    async def stop(self) -> None:
        await self._teardown()

    async def _teardown(self) -> None:
        self._initialized = False
        self._tools_cache = None
        if self._reader_task:
            self._reader_task.cancel()
            self._reader_task = None
        if self._stderr_task:
            self._stderr_task.cancel()
            self._stderr_task = None
        # Reject any still-pending futures so callers don't hang forever.
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(MCPError(f"{self.mcp_id} connection closed"))
        self._pending.clear()
        if self.proc:
            try:
                if self.proc.returncode is None:
                    self.proc.terminate()
                    try:
                        await asyncio.wait_for(self.proc.wait(), timeout=5.0)
                    except asyncio.TimeoutError:
                        self.proc.kill()
            except ProcessLookupError:
                pass
            self.proc = None
        self._writer = None
        self._reader = None

    # ── JSON-RPC plumbing ──────────────────────────────────────────────────

    async def _request(self, method: str, params: dict) -> Any:
        if not self._writer:
            raise MCPError(f"{self.mcp_id}: not connected")
        self._req_id += 1
        rid = self._req_id
        fut: asyncio.Future[Any] = asyncio.get_event_loop().create_future()
        self._pending[rid] = fut
        msg = {"jsonrpc": "2.0", "id": rid, "method": method, "params": params}
        self._writer.write((json.dumps(msg) + "\n").encode())
        try:
            await self._writer.drain()
        except Exception as e:
            self._pending.pop(rid, None)
            raise MCPError(f"{self.mcp_id}: write failed: {e}") from e
        try:
            return await asyncio.wait_for(fut, timeout=CALL_TIMEOUT_S)
        except asyncio.TimeoutError:
            self._pending.pop(rid, None)
            raise MCPError(f"{self.mcp_id}: {method} timed out after {CALL_TIMEOUT_S}s")

    async def _notify(self, method: str, params: dict) -> None:
        if not self._writer:
            raise MCPError(f"{self.mcp_id}: not connected")
        msg = {"jsonrpc": "2.0", "method": method, "params": params}
        self._writer.write((json.dumps(msg) + "\n").encode())
        try:
            await self._writer.drain()
        except Exception as e:
            raise MCPError(f"{self.mcp_id}: notify failed: {e}") from e

    async def _read_loop(self) -> None:
        """Dispatch responses to their waiting futures. Ignores
        notifications from the server; the only incoming messages we care
        about in this minimal host are responses to our id'd requests."""
        assert self._reader
        try:
            while True:
                line = await self._reader.readline()
                if not line:
                    break
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    continue
                rid = msg.get("id")
                if rid is None:
                    continue  # server-originated notification — not used here
                fut = self._pending.pop(rid, None)
                if fut is None or fut.done():
                    continue
                if "error" in msg:
                    err = msg["error"]
                    fut.set_exception(MCPError(
                        f"{self.mcp_id}: {err.get('message','?')} (code {err.get('code')})"
                    ))
                else:
                    fut.set_result(msg.get("result"))
        except asyncio.CancelledError:
            pass
        except Exception as e:
            log.warning("mcp-host: %s read loop ended: %s", self.mcp_id, e)
        finally:
            for fut in self._pending.values():
                if not fut.done():
                    fut.set_exception(MCPError(f"{self.mcp_id} stream closed"))
            self._pending.clear()

    async def _drain_stderr(self) -> None:
        """Route stderr to our logger at debug level so noisy servers don't
        block and we can still inspect complaints."""
        assert self.proc and self.proc.stderr
        try:
            while True:
                line = await self.proc.stderr.readline()
                if not line:
                    break
                log.debug("mcp-host[%s]: %s", self.mcp_id, line.decode(errors="replace").rstrip())
        except asyncio.CancelledError:
            pass
        except Exception:
            pass


# ── Singleton registry ─────────────────────────────────────────────────────

_clients: dict[str, _MCPClient] = {}
_janitor_task: asyncio.Task | None = None


async def _janitor() -> None:
    """Periodically stop servers that have been idle too long."""
    while True:
        try:
            await asyncio.sleep(60.0)
            now = time.monotonic()
            stale = [
                c for c in list(_clients.values())
                if c.proc and c.proc.returncode is None
                and (now - c._last_used_at) > IDLE_TIMEOUT_S
            ]
            for c in stale:
                log.info("mcp-host: stopping idle %s", c.mcp_id)
                await c.stop()
        except asyncio.CancelledError:
            return
        except Exception as e:
            log.warning("mcp-host: janitor tick error %s", e)


def _ensure_janitor() -> None:
    global _janitor_task
    if _janitor_task is None or _janitor_task.done():
        try:
            _janitor_task = asyncio.create_task(_janitor())
        except RuntimeError:
            # No running loop yet (import-time) — fine, will set up on first use.
            pass


def _get_or_create(mcp_id: str) -> _MCPClient:
    """Look up the installed entry for mcp_id and return (creating if missing)
    the long-lived client. Raises MCPError when the mcp is not installed."""
    import mcps as _mcps  # import inside fn so tests can patch easily
    entries = _mcps.list_installed()
    entry = next((e for e in entries if e.get("id") == mcp_id), None)
    if not entry:
        raise MCPError(f"mcp not installed: {mcp_id}")

    existing = _clients.get(mcp_id)
    # Re-create if the stored command/args changed (e.g. user reconfigured)
    if existing and (
        existing.command != entry.get("command", "")
        or existing.args != list(entry.get("args", []))
        or existing.env != dict(entry.get("env", {}))
    ):
        # Best-effort stop; caller will retry.
        asyncio.get_event_loop().create_task(existing.stop())
        existing = None
        _clients.pop(mcp_id, None)

    if not existing:
        existing = _MCPClient(
            mcp_id=mcp_id,
            name=entry.get("name", mcp_id),
            command=entry.get("command", ""),
            args=list(entry.get("args", [])),
            env=dict(entry.get("env", {})),
        )
        _clients[mcp_id] = existing
    return existing


async def list_tools(mcp_id: str, force: bool = False) -> list[dict]:
    _ensure_janitor()
    client = _get_or_create(mcp_id)
    return await client.list_tools(force=force)


async def call_tool(mcp_id: str, tool_name: str, arguments: dict) -> dict:
    _ensure_janitor()
    client = _get_or_create(mcp_id)
    return await client.call_tool(tool_name, arguments)


async def stop(mcp_id: str) -> bool:
    client = _clients.pop(mcp_id, None)
    if not client:
        return False
    await client.stop()
    return True


async def stop_all() -> None:
    for mcp_id in list(_clients.keys()):
        await stop(mcp_id)


def status() -> list[dict]:
    """Per-MCP process state — running/stopped + last-used timestamp."""
    now = time.monotonic()
    out: list[dict] = []
    for mcp_id, c in _clients.items():
        running = bool(c.proc and c.proc.returncode is None)
        out.append({
            "mcp_id": mcp_id,
            "running": running,
            "idle_seconds": round(now - c._last_used_at, 1) if running else None,
            "tools_cached": len(c._tools_cache or []),
        })
    return out
