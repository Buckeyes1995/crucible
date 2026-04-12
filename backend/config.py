from pathlib import Path
import json
from pydantic import BaseModel

CONFIG_PATH = Path.home() / ".config" / "crucible" / "config.json"


class CrucibleConfig(BaseModel):
    mlx_dir: str = "/Volumes/DataNVME/models/mlx"
    gguf_dir: str = "/Volumes/DataNVME/models/gguf"
    llama_server: str = "~/.local/bin/llama-server"
    llama_port: int = 8080
    llama_compare_port: int = 8081
    mlx_port: int = 8010
    mlx_python: str = "~/.venvs/mlx/bin/python"
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
