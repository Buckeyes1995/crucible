from pathlib import Path
import json
from pydantic import BaseModel

CONFIG_PATH = Path.home() / ".config" / "crucible" / "config.json"


class NodeConfig(BaseModel):
    name: str           # e.g. "mac-mini"
    url: str            # e.g. "http://192.168.1.50:7777"
    api_key: str = ""   # optional, for remote auth


class AgentConfig(BaseModel):
    """A remote agent (e.g. hermes-control) that Crucible observes + controls."""
    name: str                     # display name, also used as URL slug
    url: str                      # base URL to the sidecar, e.g. http://192.168.1.50:7879
    api_key: str = ""             # bearer token sent on every call
    kind: str = "hermes"          # future: "frigate", "servarr", etc. — for UI hints


class CrucibleConfig(BaseModel):
    mlx_dir: str = "/Volumes/DataNVME/models/mlx"
    gguf_dir: str = "/Volumes/DataNVME/models/gguf"
    # ComfyUI checkpoints dir — image/video models from /api/hf/download with
    # kind="image"/"video" land here. Defaults match a stock ComfyUI install.
    image_dir: str = "/Volumes/DataNVME/models/comfy/checkpoints"
    video_dir: str = "/Volumes/DataNVME/models/comfy/checkpoints"
    llama_server: str = "~/.local/bin/llama-server"
    llama_port: int = 8080
    llama_compare_port: int = 8081
    mlx_port: int = 8010
    mlx_python: str = "~/.venvs/mlx/bin/python"
    vllm_dir: str = "/Volumes/DataNVME/models/vllm"
    vllm_bin: str = "~/.venv-vllm-metal/bin/vllm"
    vllm_port: int = 8020
    vllm_compare_port: int = 8021
    # If set, Crucible uses this existing OpenAI-compatible server for MLX models
    # instead of spawning its own mlx_lm.server process.
    mlx_external_url: str = ""
    ollama_host: str = "http://localhost:11434"
    default_model: str = ""
    # LAN serving
    bind_host: str = "127.0.0.1"  # set to "0.0.0.0" for LAN access
    api_key: str = ""              # if set, require X-API-Key or Bearer token
    omlx_api_key: str = "123456"   # API key for the oMLX subprocess
    mlx_studio_url: str = ""       # e.g. "http://localhost:8090" — leave blank to disable
    nodes: list[NodeConfig] = []   # remote Crucible peers
    agents: list[AgentConfig] = [] # remote agents (hermes-control, etc.)
    # Default engine picker for MLX models when the user hasn't set a per-model
    # preference. If empty, falls back to the first entry in ENGINES_BY_KIND[kind].
    default_mlx_engine: str = ""


def load_config() -> CrucibleConfig:
    if CONFIG_PATH.exists():
        try:
            data = json.loads(CONFIG_PATH.read_text())
            return CrucibleConfig(**data)
        except Exception:
            pass
    cfg = CrucibleConfig()
    save_config(cfg)
    return cfg


def save_config(cfg: CrucibleConfig) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(cfg.model_dump_json(indent=2))
