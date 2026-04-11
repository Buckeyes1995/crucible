"""Sync active model state to external coding agent configs."""
import json
import logging
from pathlib import Path
from typing import Optional

OPENCODE_CONFIG = Path.home() / ".config" / "opencode" / "opencode.json"

log = logging.getLogger(__name__)


def _model_key_from_crucible_id(model_id: str) -> str:
    """
    Derive the bare model name from a Crucible model ID.
    e.g. 'mlx:Qwen3-Coder-Next-MLX-6bit'       → 'Qwen3-Coder-Next-MLX-6bit'
         'gguf:qwen/Qwen3.5-9B-GGUF/Qwen3.5-9B-Q4_K_M' → 'Qwen3.5-9B-Q4_K_M'
    """
    name = model_id.split(":", 1)[-1]   # strip 'mlx:' / 'gguf:' prefix
    return Path(name).name               # take the last path component


def _find_in_providers(cfg: dict, model_key: str) -> Optional[str]:
    """
    Search all providers for a model whose key matches or contains model_key.
    Returns 'provider_id/model_key' or None.
    """
    providers = cfg.get("provider", {})
    for provider_id, provider in providers.items():
        models = provider.get("models", {})
        # Exact match first
        if model_key in models:
            return f"{provider_id}/{model_key}"
        # Substring match (handles cases where file extension was included, etc.)
        for key in models:
            if model_key in key or key in model_key:
                return f"{provider_id}/{key}"
    return None


def _add_to_provider(cfg: dict, provider_id: str, model_key: str) -> str:
    """Add a minimal model entry to a provider and return the model ref."""
    providers = cfg.setdefault("provider", {})
    if provider_id not in providers:
        return f"{provider_id}/{model_key}"
    providers[provider_id].setdefault("models", {})[model_key] = {
        "name": model_key,
        "limit": {"context": 32768, "output": 8192},
    }
    return f"{provider_id}/{model_key}"


def sync_opencode(model_id: Optional[str], base_url: Optional[str] = None) -> None:
    """
    Update ~/.config/opencode/opencode.json to reflect the currently loaded model.
    Also updates the omlx provider baseURL to match Crucible's server if base_url is given.
    Pass model_id=None to clear (set model to empty string).
    """
    if not OPENCODE_CONFIG.exists():
        return

    try:
        cfg = json.loads(OPENCODE_CONFIG.read_text())
    except Exception as e:
        log.warning("sync_opencode: failed to read config: %s", e)
        return

    # Always sync the provider baseURL when we know where Crucible is serving
    if base_url:
        providers = cfg.get("provider", {})
        for provider in providers.values():
            opts = provider.get("options", {})
            current = opts.get("baseURL", "")
            # Only update providers pointing at a local inference server
            if "127.0.0.1" in current or "localhost" in current:
                opts["baseURL"] = base_url
                log.info("sync_opencode: updated baseURL → %s", base_url)

    if model_id is None:
        cfg["model"] = ""
        OPENCODE_CONFIG.write_text(json.dumps(cfg, indent=2))
        return

    model_key = _model_key_from_crucible_id(model_id)

    # Try to find the model in existing providers
    ref = _find_in_providers(cfg, model_key)

    if ref is None:
        # Not registered — add it to the first provider that matches the kind,
        # defaulting to 'omlx' which is the primary local provider.
        kind = model_id.split(":", 1)[0]
        provider_id = "omlx" if kind in ("mlx", "gguf") else "omlx"
        if provider_id not in cfg.get("provider", {}):
            providers = cfg.get("provider", {})
            provider_id = next(iter(providers), "omlx")
        ref = _add_to_provider(cfg, provider_id, model_key)
        log.info("sync_opencode: added %s to provider %s", model_key, provider_id)

    cfg["model"] = ref
    OPENCODE_CONFIG.write_text(json.dumps(cfg, indent=2))
    log.info("sync_opencode: set model → %s", ref)
