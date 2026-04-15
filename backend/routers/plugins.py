"""Plugin System — loadable plugin hooks for custom extensions."""
import json, importlib, sys
from pathlib import Path
from fastapi import APIRouter

router = APIRouter()
PLUGINS_DIR = Path.home() / ".config" / "crucible" / "plugins"
PLUGINS_MANIFEST = PLUGINS_DIR / "manifest.json"

def _load_manifest():
    if PLUGINS_MANIFEST.exists():
        try: return json.loads(PLUGINS_MANIFEST.read_text())
        except: pass
    return {"plugins": []}

def _save_manifest(data):
    PLUGINS_DIR.mkdir(parents=True, exist_ok=True)
    PLUGINS_MANIFEST.write_text(json.dumps(data, indent=2))

@router.get("/plugins")
async def list_plugins():
    """List registered plugins and their status."""
    manifest = _load_manifest()
    results = []
    for p in manifest.get("plugins", []):
        info = {**p, "loaded": False}
        # Check if plugin module exists
        plugin_file = PLUGINS_DIR / p.get("module", "")
        info["exists"] = plugin_file.exists()
        results.append(info)
    return results

@router.post("/plugins/register")
async def register_plugin(body: dict):
    """Register a plugin by name and module path."""
    manifest = _load_manifest()
    manifest["plugins"].append({
        "name": body.get("name", "unnamed"),
        "module": body.get("module", ""),
        "description": body.get("description", ""),
        "hooks": body.get("hooks", []),  # e.g. ["on_model_load", "on_chat_complete"]
        "enabled": True,
    })
    _save_manifest(manifest)
    return {"status": "registered"}

@router.delete("/plugins/{plugin_name}")
async def unregister_plugin(plugin_name: str):
    manifest = _load_manifest()
    manifest["plugins"] = [p for p in manifest["plugins"] if p["name"] != plugin_name]
    _save_manifest(manifest)
    return {"status": "removed"}

@router.get("/plugins/hooks")
async def available_hooks():
    """List all available plugin hook points."""
    return {
        "hooks": [
            {"name": "on_model_load", "description": "Called after a model finishes loading", "args": ["model_id", "elapsed_ms"]},
            {"name": "on_model_unload", "description": "Called after a model is unloaded", "args": ["model_id"]},
            {"name": "on_chat_complete", "description": "Called after a chat response completes", "args": ["model_id", "tps", "output_tokens"]},
            {"name": "on_benchmark_done", "description": "Called after a benchmark run", "args": ["run_id", "summary"]},
            {"name": "on_download_done", "description": "Called after a model download completes", "args": ["repo_id", "kind"]},
            {"name": "on_arena_vote", "description": "Called after an arena vote", "args": ["battle_id", "winner", "model_a", "model_b"]},
        ]
    }
