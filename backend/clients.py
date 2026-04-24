"""Sync active model state to external coding agent configs."""
import json
import logging
from pathlib import Path
from typing import Optional

OPENCODE_CONFIG = Path.home() / ".config" / "opencode" / "opencode.json"
AIDER_CONFIG = Path.home() / ".aider.conf.yml"
ZED_SETTINGS = Path.home() / "Library" / "Application Support" / "Zed" / "settings.json"

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


def sync_aider(model_id: Optional[str], base_url: str = "http://127.0.0.1:7777/v1") -> None:
    """
    Update ~/.aider.conf.yml to use the currently loaded model via Crucible's proxy.
    Only writes if the file already exists (user opted into aider).
    """
    if not AIDER_CONFIG.exists():
        return
    try:
        import re
        text = AIDER_CONFIG.read_text()
        model_key = _model_key_from_crucible_id(model_id) if model_id else ""

        def _set(key: str, value: str, text: str) -> str:
            pattern = rf"^{key}:.*$"
            replacement = f"{key}: {value}"
            if re.search(pattern, text, re.MULTILINE):
                return re.sub(pattern, replacement, text, flags=re.MULTILINE)
            return text + f"\n{replacement}"

        text = _set("openai-api-base", base_url, text)
        text = _set("openai-api-key", "crucible", text)
        if model_key:
            text = _set("model", f"openai/{model_key}", text)
        AIDER_CONFIG.write_text(text)
        log.info("sync_aider: model=%s base=%s", model_key, base_url)
    except Exception as e:
        log.warning("sync_aider: failed: %s", e)


def sync_zed(model_id: Optional[str], base_url: str = "http://127.0.0.1:7777/v1") -> None:
    """
    Update Zed settings.json to use the currently loaded model via Crucible's proxy.
    Only writes if the file already exists.
    """
    if not ZED_SETTINGS.exists():
        return
    try:
        cfg = json.loads(ZED_SETTINGS.read_text())
        model_key = _model_key_from_crucible_id(model_id) if model_id else ""

        # Zed uses language_models.openai section for custom OpenAI-compatible endpoints
        lm = cfg.setdefault("language_models", {})
        openai = lm.setdefault("openai", {})
        openai["api_url"] = base_url
        if model_key:
            # Set as default model for assistant panel
            cfg.setdefault("assistant", {})["default_model"] = {
                "provider": "openai",
                "model": model_key,
            }
        ZED_SETTINGS.write_text(json.dumps(cfg, indent=2))
        log.info("sync_zed: model=%s base=%s", model_key, base_url)
    except Exception as e:
        log.warning("sync_zed: failed: %s", e)


def sync_all_clients(model_id: Optional[str], base_url: str = "http://127.0.0.1:7777/v1") -> None:
    """Sync all configured external clients. Called on model load/unload."""
    sync_opencode(model_id, base_url=base_url)
    sync_aider(model_id, base_url=base_url)
    sync_zed(model_id, base_url=base_url)


# ── Full model-block regeneration (config-as-a-view) ──────────────────────
# Rather than only syncing the "active model" pointer, these rebuild the
# full provider.crucible.models block from Crucible's registry + per-model
# params. They preserve any user-authored `parameters: {...}` sampling
# tweaks — only the name + limit.context + limit.output get regenerated.

PI_MODELS = Path.home() / ".pi" / "agent" / "models.json"


def _humanize_size(bytes_: Optional[int]) -> str:
    if not bytes_:
        return ""
    gb = bytes_ / (1024 ** 3)
    if gb >= 1:
        return f"{gb:.0f}GB"
    return f"{bytes_ / (1024 ** 2):.0f}MB"


def _gather_models_from_registry(registry, get_params) -> list[dict]:
    """Return a list of flat dicts for every non-hidden local model, with
    its current context + output limits resolved from per-model params or
    sensible fallbacks. Registry is expected to have an `.all()` iterable
    of ModelEntry-shaped items."""
    try:
        from model_notes import all_hidden
        hidden_map = all_hidden() or {}
    except Exception:
        hidden_map = {}

    out: list[dict] = []
    for m in registry.all():
        if getattr(m, "node", "local") != "local":
            # Remote-node models are reachable via the remote node's Crucible
            # instance — syncing them to local opencode/pi doesn't make sense.
            continue
        if hidden_map.get(m.id):
            continue
        bare = m.id.split(":", 1)[-1]
        params = get_params(m.id) or {}
        ctx = params.get("context_window") or m.context_window or 32768
        out_tok = params.get("max_tokens") or 16384
        size_label = _humanize_size(m.size_bytes)
        display = f"{m.name}"
        if size_label:
            display += f" ({size_label})"
        out.append({
            "id": bare,
            "crucible_id": m.id,
            "name": display,
            "context": int(ctx),
            "output": int(out_tok),
            "kind": m.kind,
            "caps": m.capabilities or [],
        })
    return out


def regenerate_opencode_models(registry, get_params, base_url: str = "http://127.0.0.1:7777/v1") -> int:
    """Rebuild provider.crucible.models to match the registry. Returns the
    number of entries written. Existing per-model `parameters:` blocks and
    the provider's top-level fields are preserved."""
    models = _gather_models_from_registry(registry, get_params)
    if not OPENCODE_CONFIG.exists():
        OPENCODE_CONFIG.parent.mkdir(parents=True, exist_ok=True)
        OPENCODE_CONFIG.write_text("{}")
    try:
        cfg = json.loads(OPENCODE_CONFIG.read_text())
    except Exception:
        cfg = {}

    # Make sure the crucible provider exists.
    provider = cfg.setdefault("provider", {}).setdefault("crucible", {})
    provider.setdefault("npm", "@ai-sdk/openai-compatible")
    provider.setdefault("name", "Crucible (local)")
    provider.setdefault("options", {}).update({
        "baseURL": base_url,
        "apiKey": provider.get("options", {}).get("apiKey") or "dummy",
    })
    existing = provider.get("models") or {}
    new_models: dict[str, dict] = {}
    for m in models:
        prev = existing.get(m["id"]) or {}
        # Preserve user-authored parameters block + anything else we don't own.
        merged = {**prev}
        merged["name"] = m["name"]
        merged["limit"] = {"context": m["context"], "output": m["output"]}
        new_models[m["id"]] = merged
    provider["models"] = new_models

    OPENCODE_CONFIG.write_text(json.dumps(cfg, indent=2) + "\n")
    log.info("clients: regenerated opencode models block (%d entries)", len(new_models))
    return len(new_models)


def regenerate_pi_models(registry, get_params, base_url: str = "http://127.0.0.1:7777/v1") -> int:
    """Rebuild ~/.pi/agent/models.json to list every non-hidden local model
    under the `crucible` provider. Preserves the provider-level api /
    apiKey / compat config; overwrites only the `models` list."""
    models = _gather_models_from_registry(registry, get_params)
    if not PI_MODELS.exists():
        PI_MODELS.parent.mkdir(parents=True, exist_ok=True)
        PI_MODELS.write_text("{}")
    try:
        cfg = json.loads(PI_MODELS.read_text())
    except Exception:
        cfg = {}

    provider = cfg.setdefault("providers", {}).setdefault("crucible", {})
    provider["baseUrl"] = base_url
    provider.setdefault("api", "openai-completions")
    provider.setdefault("apiKey", provider.get("apiKey") or "crucible")
    provider.setdefault("compat", {
        "supportsDeveloperRole": False,
        "supportsReasoningEffort": False,
    })
    provider["models"] = [
        {
            "id": m["id"],
            "reasoning": "reasoning" in (m.get("caps") or []) or "thinking" in (m.get("caps") or []),
            # Pi defaults contextWindow to 128000 when absent; auto-compaction
            # uses this as the ceiling. Set explicitly so it matches oMLX's
            # cap and /compact kicks in at the right time.
            "contextWindow": int(m["context"]),
            "maxTokens": int(m["output"]),
        }
        for m in models
    ]

    PI_MODELS.write_text(json.dumps(cfg, indent=2) + "\n")
    log.info("clients: regenerated pi models.json (%d entries)", len(models))
    return len(models)
