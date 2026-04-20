"""Thin helper around ~/.config/crucible/workflows.json.

The existing /workflows router manages these via its own load/save helpers
inside routers/workflows.py. We duplicate the shape here so other code
paths (notably the Store router) can add workflows without reaching into
a router module.
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

STORE = Path.home() / ".config" / "crucible" / "workflows.json"
_PLACEHOLDER = re.compile(r"\{([A-Za-z_][A-Za-z_0-9]*)\}")


def _load() -> list[dict]:
    if not STORE.exists():
        return []
    try:
        return json.loads(STORE.read_text())
    except Exception:
        return []


def _save(items: list[dict]) -> None:
    STORE.parent.mkdir(parents=True, exist_ok=True)
    STORE.write_text(json.dumps(items, indent=2))


def list_workflows() -> list[dict]:
    return _load()


def add_workflow(name: str, agent: str, template: str,
                 description: str = "", skills: list[str] | None = None,
                 max_turns: int = 30) -> dict:
    items = _load()
    wf = {
        "id": uuid.uuid4().hex[:12],
        "name": name,
        "agent": agent,
        "template": template,
        "description": description,
        "skills": list(skills or []),
        "max_turns": max_turns,
        "placeholders": sorted(set(_PLACEHOLDER.findall(template))),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "run_count": 0,
    }
    items.append(wf)
    _save(items)
    return wf
