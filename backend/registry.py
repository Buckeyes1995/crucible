"""Model registry — scans MLX, GGUF, and Ollama backends."""
import json
import re
from pathlib import Path
from typing import Optional

import httpx

from config import CrucibleConfig
from models.schemas import ModelEntry

STATS_FILE = Path.home() / ".config" / "crucible" / "model_stats.json"


def _load_stats() -> dict:
    if not STATS_FILE.exists():
        return {}
    try:
        return json.loads(STATS_FILE.read_text())
    except Exception:
        return {}


def _save_stats(stats: dict) -> None:
    STATS_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATS_FILE.write_text(json.dumps(stats, indent=2))


def _parse_quant_from_name(name: str) -> Optional[str]:
    """Extract quantization string from a model name/path."""
    patterns = [
        r"\b(Q\d+_K_[MS]|Q\d+_\d|Q\d+|MXFP\d+|[48]bit|fp16|bf16|f16|f32)\b",
        r"(\d+bit)",
        r"-(q\d+)-",
    ]
    for pat in patterns:
        m = re.search(pat, name, re.IGNORECASE)
        if m:
            return m.group(1)
    return None


def _parse_context_from_mlx_config(config_path: Path) -> Optional[int]:
    try:
        data = json.loads(config_path.read_text())
        # Check top-level and nested text_config (VL models)
        candidates = [data, data.get("text_config", {})]
        for d in candidates:
            for key in ("max_position_embeddings", "max_seq_len", "model_max_length"):
                if key in d:
                    return int(d[key])
    except Exception:
        pass
    return None


def _dir_size(path: Path) -> int:
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())


def scan_mlx(mlx_dir: str) -> list[ModelEntry]:
    models = []
    root = Path(mlx_dir).expanduser()
    if not root.exists():
        return models

    for entry in sorted(root.iterdir()):
        if not entry.is_dir():
            continue
        config_file = entry / "config.json"
        if not config_file.exists():
            continue

        name = entry.name
        model_id = f"mlx:{name}"
        quant = _parse_quant_from_name(name)
        ctx = _parse_context_from_mlx_config(config_file)
        size = _dir_size(entry)

        try:
            meta = json.loads(config_file.read_text())
            arch = meta.get("model_type", "")
        except Exception:
            arch = ""

        models.append(ModelEntry(
            id=model_id,
            name=name,
            kind="mlx",
            path=str(entry),
            size_bytes=size,
            context_window=ctx,
            quant=quant,
            backend_meta={"arch": arch},
        ))

    return models


def scan_gguf(gguf_dir: str) -> list[ModelEntry]:
    """
    Recursively find all .gguf files. Each file becomes its own ModelEntry so
    every quant variant is independently selectable for benchmarking.
    Skips mmproj-* files (vision projectors, not standalone models).
    """
    root = Path(gguf_dir).expanduser()
    if not root.exists():
        return []

    models = []
    seen: set[str] = set()

    for f in sorted(root.rglob("*.gguf")):
        # Skip vision projector companions and non-first split parts
        if f.name.startswith("mmproj-"):
            continue
        if re.search(r"-\d{5}-of-(\d{5})\.gguf$", f.name):
            # Only keep the first shard; skip 00002-of-00003, etc.
            if not re.search(r"-00001-of-\d{5}\.gguf$", f.name):
                continue

        name = f.stem
        # Use path relative to root as a stable unique key
        rel = f.relative_to(root)
        model_id = f"gguf:{rel.with_suffix('')}"

        if model_id in seen:
            continue
        seen.add(model_id)

        # Friendly display name: stem of file, but prefix with parent dir
        # if the parent isn't the root (to disambiguate same-named quants)
        parent = f.parent
        if parent == root:
            display_name = name
        else:
            rel_parent = parent.relative_to(root)
            display_name = f"{rel_parent}/{name}"

        models.append(ModelEntry(
            id=model_id,
            name=display_name,
            kind="gguf",
            path=str(f),
            size_bytes=f.stat().st_size,
            quant=_parse_quant_from_name(name),
        ))

    return models


async def scan_mlx_studio(url: str) -> list[ModelEntry]:
    """Query a running MLX Studio server for its available models."""
    models = []
    if not url:
        return models
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{url.rstrip('/')}/v1/models")
            if resp.status_code != 200:
                return models
            data = resp.json()
            for m in data.get("data", []):
                server_id = m.get("id", "")
                if not server_id:
                    continue
                name = server_id.split("/")[-1] if "/" in server_id else server_id
                models.append(ModelEntry(
                    id=f"mlx_studio:{server_id}",
                    name=name,
                    kind="mlx_studio",
                    path=server_id,  # ExternalAdapter uses path as the model ID sent to the server
                    backend_meta={"server_model_id": server_id},
                ))
    except Exception:
        pass
    return models


async def scan_ollama(ollama_host: str) -> list[ModelEntry]:
    models = []
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{ollama_host}/api/tags")
            if resp.status_code != 200:
                return models
            data = resp.json()
            for m in data.get("models", []):
                tag = m.get("name", "")
                model_id = f"ollama:{tag}"
                size = m.get("size", None)
                details = m.get("details", {})
                models.append(ModelEntry(
                    id=model_id,
                    name=tag,
                    kind="ollama",
                    size_bytes=size,
                    quant=details.get("quantization_level"),
                    context_window=None,
                    backend_meta=details,
                ))
    except Exception:
        pass
    return models


async def scan_remote_node(node_name: str, node_url: str, api_key: str = "") -> list[ModelEntry]:
    """Query a remote Crucible instance for its local models."""
    models = []
    headers = {}
    if api_key:
        headers["X-API-Key"] = api_key
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{node_url.rstrip('/')}/api/models", headers=headers)
            if resp.status_code != 200:
                return models
            data = resp.json()
            for m in data:
                # Skip models that are themselves remote (no recursive proxying)
                if m.get("node", "local") != "local":
                    continue
                remote_id = f"@{node_name}/{m['id']}"
                models.append(ModelEntry(
                    id=remote_id,
                    name=m.get("name", ""),
                    kind=m.get("kind", "mlx"),
                    path=m.get("path"),
                    size_bytes=m.get("size_bytes"),
                    context_window=m.get("context_window"),
                    quant=m.get("quant"),
                    backend_meta={
                        **(m.get("backend_meta") or {}),
                        "_remote_url": node_url,
                        "_remote_api_key": api_key,
                        "_remote_model_id": m["id"],
                    },
                    node=node_name,
                ))
    except Exception:
        pass
    return models


class ModelRegistry:
    def __init__(self, config: CrucibleConfig):
        self.config = config
        self._models: dict[str, ModelEntry] = {}

    async def refresh(self) -> None:
        models: list[ModelEntry] = []
        models.extend(scan_mlx(self.config.mlx_dir))
        models.extend(scan_gguf(self.config.gguf_dir))
        models.extend(await scan_ollama(self.config.ollama_host))
        models.extend(await scan_mlx_studio(self.config.mlx_studio_url))
        if self.config.nodes:
            import asyncio
            node_results = await asyncio.gather(
                *(scan_remote_node(n.name, n.url, n.api_key) for n in self.config.nodes)
            )
            for result in node_results:
                models.extend(result)
        stats = _load_stats()
        for m in models:
            if m.id in stats:
                m = m.model_copy(update=stats[m.id])
            self._models[m.id] = m

    def all(self) -> list[ModelEntry]:
        return list(self._models.values())

    def get(self, model_id: str) -> Optional[ModelEntry]:
        return self._models.get(model_id)

    def update_stats(self, model_id: str, avg_tps: float, last_loaded: str) -> None:
        if model_id in self._models:
            update = {"avg_tps": avg_tps, "last_loaded": last_loaded}
            self._models[model_id] = self._models[model_id].model_copy(update=update)
            stats = _load_stats()
            stats[model_id] = update
            _save_stats(stats)
