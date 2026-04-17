"""Per-model parameter storage — ~/.config/crucible/model_params.json."""
import json
import logging
from pathlib import Path
from typing import Any

PARAMS_FILE = Path.home() / ".config" / "crucible" / "model_params.json"
DEFAULTS_KEY = "__defaults__"

# Baseline params applied under global defaults and per-model settings.
# Override by setting the key in global defaults or per-model params.
_BASELINE: dict[str, Any] = {
    "enable_thinking": False,  # skip Qwen3.5/3.6 <think> reasoning blocks by default
}

log = logging.getLogger(__name__)


def load_all() -> dict[str, dict]:
    if not PARAMS_FILE.exists():
        return {}
    try:
        return json.loads(PARAMS_FILE.read_text())
    except Exception as e:
        log.warning("model_params: failed to read: %s", e)
        return {}


def _save(data: dict) -> None:
    PARAMS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PARAMS_FILE.write_text(json.dumps(data, indent=2))


def get_defaults() -> dict[str, Any]:
    return load_all().get(DEFAULTS_KEY, {})


def set_defaults(params: dict[str, Any]) -> dict[str, Any]:
    all_params = load_all()
    all_params[DEFAULTS_KEY] = params
    _save(all_params)
    return params


def get_params(model_id: str) -> dict[str, Any]:
    """Return merged params: baseline < global defaults < model-specific."""
    all_params = load_all()
    defaults = all_params.get(DEFAULTS_KEY, {})
    model = all_params.get(model_id, {})
    return {**_BASELINE, **defaults, **model}


def get_params_raw(model_id: str) -> dict[str, Any]:
    """Return only model-specific params (no defaults merged)."""
    return load_all().get(model_id, {})


def set_params(model_id: str, params: dict[str, Any]) -> dict[str, Any]:
    all_params = load_all()
    all_params[model_id] = params
    _save(all_params)
    return params


def delete_params(model_id: str) -> None:
    all_params = load_all()
    all_params.pop(model_id, None)
    _save(all_params)
