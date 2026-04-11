"""Scheduled model switching — time-based rules."""
import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

SCHEDULES_FILE = Path.home() / ".config" / "crucible" / "schedules.json"


def load_schedules() -> list[dict]:
    if not SCHEDULES_FILE.exists():
        return []
    try:
        return json.loads(SCHEDULES_FILE.read_text())
    except Exception as e:
        log.warning("scheduler: failed to read schedules: %s", e)
        return []


def save_schedules(schedules: list[dict]) -> None:
    SCHEDULES_FILE.parent.mkdir(parents=True, exist_ok=True)
    SCHEDULES_FILE.write_text(json.dumps(schedules, indent=2))


def _matches_now(rule: dict) -> bool:
    """
    Check if rule matches current time.
    rule = {
        "id": str,
        "model_id": str,
        "days": [0..6] (0=Mon, 6=Sun; empty = all),
        "hour": int (0-23),
        "minute": int (0-59),
        "enabled": bool,
    }
    """
    if not rule.get("enabled", True):
        return False
    now = datetime.now()
    days = rule.get("days", [])
    if days and now.weekday() not in days:
        return False
    return now.hour == rule.get("hour", 0) and now.minute == rule.get("minute", 0)


async def run_scheduler(app) -> None:
    """Background task — check schedules every 60s and switch model if matched."""
    # Track last-fired minute to avoid double-firing within the same minute
    last_fired: Optional[str] = None

    while True:
        await asyncio.sleep(30)
        try:
            now_key = datetime.now().strftime("%Y%m%d%H%M")
            if now_key == last_fired:
                continue

            schedules = load_schedules()
            for rule in schedules:
                if _matches_now(rule):
                    model_id = rule.get("model_id")
                    if not model_id:
                        continue
                    log.info("scheduler: switching to %s", model_id)
                    last_fired = now_key
                    await _switch_model(app, model_id)
                    break  # only one switch per minute
        except asyncio.CancelledError:
            return
        except Exception as e:
            log.exception("scheduler error: %s", e)


async def _switch_model(app, model_id: str) -> None:
    """Load model_id using the models router logic."""
    registry = app.state.registry
    config = app.state.config
    model = registry.get(model_id)
    if not model:
        log.warning("scheduler: model not found: %s", model_id)
        return

    from adapters.mlx_lm import MLXAdapter
    from adapters.llama_cpp import LlamaCppAdapter
    from adapters.ollama import OllamaAdapter
    from adapters.external import ExternalAdapter
    from clients import sync_opencode

    current = app.state.active_adapter
    if current and current.model_id == model_id and current.is_loaded():
        log.info("scheduler: %s already loaded", model_id)
        return

    if current and current.is_loaded():
        await current.stop()
        app.state.active_adapter = None

    if model.kind == "mlx":
        if config.mlx_external_url:
            adapter = ExternalAdapter(base_url=config.mlx_external_url)
        else:
            adapter = MLXAdapter(port=config.mlx_port, python=config.mlx_python)
    elif model.kind == "gguf":
        adapter = LlamaCppAdapter(server_path=config.llama_server, port=config.llama_port)
    elif model.kind == "ollama":
        adapter = OllamaAdapter(host=config.ollama_host)
    else:
        log.warning("scheduler: unknown kind %s", model.kind)
        return

    async for evt in adapter.load(model):
        if evt.get("event") == "done":
            app.state.active_adapter = adapter
            sync_opencode(model_id, base_url="http://127.0.0.1:7777/v1")
            log.info("scheduler: switched to %s", model_id)
        elif evt.get("event") == "error":
            log.error("scheduler: load failed for %s: %s", model_id, evt)
            return
