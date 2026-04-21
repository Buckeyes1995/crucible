"""MCP installer registry.

Crucible's MCP support right now is installer-only: it knows how to capture
the command/args/env you'd hand to an MCP-capable client (Claude Code, Claude
Desktop, a future Crucible-as-host) and saves them in a local registry.

It does NOT spawn MCP processes itself. Upgrading to a full host is a
separate job; the registry format here is designed to be compatible with
that future work by storing the raw command/args shape verbatim.
"""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

REGISTRY_FILE = Path.home() / ".config" / "crucible" / "mcps.json"


def _load() -> list[dict[str, Any]]:
    if not REGISTRY_FILE.exists():
        return []
    try:
        return json.loads(REGISTRY_FILE.read_text())
    except Exception as e:
        log.warning("mcps: unreadable registry (%s)", e)
        return []


def _save(entries: list[dict[str, Any]]) -> None:
    REGISTRY_FILE.parent.mkdir(parents=True, exist_ok=True)
    REGISTRY_FILE.write_text(json.dumps(entries, indent=2))


def list_installed() -> list[dict[str, Any]]:
    return _load()


def install(mcp_id: str, name: str, command: str, args: list[str],
            env: dict[str, str], source: str = "crucible-store",
            values: dict[str, str] | None = None) -> dict:
    """Add or replace a registry entry. Idempotent by mcp_id — installing
    the same id twice replaces the previous config (useful for re-entering
    an API key).

    `values` is the raw user-supplied config param dict ({root_dir: ...,
    github_token: ...}) — kept alongside the rendered args so the UI can
    pre-fill the reconfigure dialog with whatever the user entered last
    time, rather than falling back to catalog defaults."""
    entries = _load()
    entries = [e for e in entries if e.get("id") != mcp_id]
    entry = {
        "id": mcp_id,
        "name": name,
        "command": command,
        "args": list(args),
        "env": dict(env),
        "values": dict(values or {}),
        "source": source,
        "installed_at": time.time(),
    }
    entries.append(entry)
    _save(entries)
    return entry


def uninstall(mcp_id: str) -> bool:
    entries = _load()
    new = [e for e in entries if e.get("id") != mcp_id]
    if len(new) == len(entries):
        return False
    _save(new)
    return True


def render_args(template_args: list[str], values: dict[str, str]) -> list[str]:
    """Substitute {name} placeholders in an args template using user-supplied
    values. Also expands ~ in path-like values (common case: filesystem MCP's
    root_dir). Missing placeholders are left as-is so the client can spot them."""
    out: list[str] = []
    for a in template_args:
        rendered = a
        for k, v in values.items():
            rendered = rendered.replace("{" + k + "}", os.path.expanduser(v or ""))
        out.append(rendered)
    return out


def render_env(template_env: dict[str, str], values: dict[str, str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in template_env.items():
        rendered = v
        for vk, vv in values.items():
            rendered = rendered.replace("{" + vk + "}", vv or "")
        out[k] = rendered
    return out
