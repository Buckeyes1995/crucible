"""ComfyUI HTTP client.

Crucible doesn't manage the ComfyUI lifecycle — it runs as a launchd service
(com.jim.comfyui) on port 8188. This module is just a thin client for queueing
prompts, listening to progress, and pulling images.
"""
from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import AsyncGenerator

import httpx
import websockets

COMFY_URL = os.environ.get("COMFY_URL", "http://localhost:8188")
COMFY_WS = COMFY_URL.replace("http", "ws", 1)
OUTPUT_DIR = Path(os.path.expanduser("~/.config/crucible/images"))


async def status() -> dict:
    """Return ComfyUI system stats, or {'up': False} if unreachable."""
    try:
        async with httpx.AsyncClient(timeout=2) as cx:
            r = await cx.get(f"{COMFY_URL}/system_stats")
            r.raise_for_status()
            return {"up": True, **r.json()}
    except Exception as e:
        return {"up": False, "error": str(e)}


async def list_checkpoints() -> list[str]:
    """Return checkpoint filenames known to ComfyUI."""
    async with httpx.AsyncClient(timeout=10) as cx:
        r = await cx.get(f"{COMFY_URL}/object_info/CheckpointLoaderSimple")
        r.raise_for_status()
        info = r.json()
    try:
        return info["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"][0]
    except (KeyError, IndexError):
        return []


async def list_samplers() -> list[str]:
    async with httpx.AsyncClient(timeout=10) as cx:
        r = await cx.get(f"{COMFY_URL}/object_info/KSampler")
        r.raise_for_status()
        info = r.json()
    try:
        return info["KSampler"]["input"]["required"]["sampler_name"][0]
    except (KeyError, IndexError):
        return []


def build_txt2img_workflow(
    *,
    checkpoint: str,
    positive: str,
    negative: str,
    width: int = 1024,
    height: int = 1024,
    steps: int = 25,
    cfg: float = 7.0,
    sampler: str = "dpmpp_2m",
    scheduler: str = "karras",
    seed: int = 0,
) -> dict:
    """Build a baked-in txt2img workflow graph (SDXL-shaped)."""
    return {
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": sampler,
                "scheduler": scheduler,
                "denoise": 1.0,
                "model": ["4", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0],
            },
        },
        "4": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": checkpoint},
        },
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": width, "height": height, "batch_size": 1},
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": positive, "clip": ["4", 1]},
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": negative, "clip": ["4", 1]},
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["3", 0], "vae": ["4", 2]},
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {"filename_prefix": "crucible", "images": ["8", 0]},
        },
    }


async def queue_prompt(workflow: dict, client_id: str) -> str:
    """Submit a workflow. Returns the prompt_id."""
    async with httpx.AsyncClient(timeout=30) as cx:
        r = await cx.post(
            f"{COMFY_URL}/prompt",
            json={"prompt": workflow, "client_id": client_id},
        )
        r.raise_for_status()
        data = r.json()
    return data["prompt_id"]


async def get_history(prompt_id: str) -> dict:
    async with httpx.AsyncClient(timeout=10) as cx:
        r = await cx.get(f"{COMFY_URL}/history/{prompt_id}")
        r.raise_for_status()
    return r.json().get(prompt_id, {})


async def generate(
    *,
    checkpoint: str,
    positive: str,
    negative: str = "",
    width: int = 1024,
    height: int = 1024,
    steps: int = 25,
    cfg: float = 7.0,
    sampler: str = "dpmpp_2m",
    scheduler: str = "karras",
    seed: int = 0,
) -> AsyncGenerator[dict, None]:
    """Run a txt2img workflow end-to-end. Yields SSE-shaped dicts:
        {event: "queued",   prompt_id: str}
        {event: "progress", value: int, max: int}
        {event: "done",     images: [{filename, subfolder, type}]}
        {event: "error",    error: str}
    """
    client_id = uuid.uuid4().hex
    workflow = build_txt2img_workflow(
        checkpoint=checkpoint, positive=positive, negative=negative,
        width=width, height=height, steps=steps, cfg=cfg,
        sampler=sampler, scheduler=scheduler, seed=seed,
    )

    try:
        async with websockets.connect(
            f"{COMFY_WS}/ws?clientId={client_id}",
            max_size=2**24,
            ping_interval=20,
        ) as ws:
            try:
                prompt_id = await queue_prompt(workflow, client_id)
            except httpx.HTTPStatusError as e:
                detail = e.response.text[:400] if e.response is not None else str(e)
                yield {"event": "error", "error": f"queue failed: {detail}"}
                return
            yield {"event": "queued", "prompt_id": prompt_id}

            done = False
            while not done:
                msg = await ws.recv()
                if isinstance(msg, bytes):
                    continue
                payload = json.loads(msg)
                kind = payload.get("type")
                data = payload.get("data", {})
                if kind == "progress" and data.get("prompt_id") == prompt_id:
                    yield {
                        "event": "progress",
                        "value": data.get("value", 0),
                        "max": data.get("max", 1),
                    }
                elif kind == "executing" and data.get("prompt_id") == prompt_id:
                    node_id = data.get("node")
                    if node_id is None:
                        done = True
                    else:
                        cls = workflow.get(str(node_id), {}).get("class_type", "")
                        yield {"event": "stage", "node": node_id, "class": cls}
                elif kind == "execution_error" and data.get("prompt_id") == prompt_id:
                    yield {"event": "error", "error": data.get("exception_message", "unknown")}
                    return

        history = await get_history(prompt_id)
        images = []
        for node_out in (history.get("outputs") or {}).values():
            for img in node_out.get("images", []) or []:
                images.append({
                    "filename": img.get("filename"),
                    "subfolder": img.get("subfolder", ""),
                    "type": img.get("type", "output"),
                })
        yield {"event": "done", "prompt_id": prompt_id, "images": images}
    except Exception as e:
        yield {"event": "error", "error": f"comfy: {e}"}


def list_outputs(limit: int = 100, extensions: tuple[str, ...] = (".png",)) -> list[dict]:
    """List recent files written to OUTPUT_DIR (newest first)."""
    if not OUTPUT_DIR.exists():
        return []
    entries = []
    for p in OUTPUT_DIR.rglob("*"):
        if not p.is_file() or p.suffix.lower() not in extensions:
            continue
        try:
            entries.append({
                "filename": p.name,
                "subfolder": str(p.parent.relative_to(OUTPUT_DIR)) if p.parent != OUTPUT_DIR else "",
                "size": p.stat().st_size,
                "mtime": p.stat().st_mtime,
            })
        except Exception:
            continue
    entries.sort(key=lambda e: e["mtime"], reverse=True)
    return entries[:limit]


async def list_text_encoders() -> list[str]:
    """Return text-encoder filenames known to ComfyUI."""
    async with httpx.AsyncClient(timeout=10) as cx:
        r = await cx.get(f"{COMFY_URL}/object_info/CLIPLoader")
        r.raise_for_status()
        info = r.json()
    try:
        return info["CLIPLoader"]["input"]["required"]["clip_name"][0]
    except (KeyError, IndexError):
        return []


def build_ltxv_t2v_workflow(
    *,
    checkpoint: str,
    text_encoder: str,
    positive: str,
    negative: str,
    width: int = 768,
    height: int = 512,
    length: int = 97,
    frame_rate: int = 24,
    steps: int = 8,
    cfg: float = 1.0,
    sampler: str = "euler",
    seed: int = 0,
) -> dict:
    """Baked-in LTX-Video text-to-video workflow (distilled-friendly defaults)."""
    return {
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": checkpoint},
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": text_encoder, "type": "ltxv"},
        },
        "3": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": positive, "clip": ["2", 0]},
        },
        "4": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": negative, "clip": ["2", 0]},
        },
        "5": {
            "class_type": "EmptyLTXVLatentVideo",
            "inputs": {"width": width, "height": height, "length": length, "batch_size": 1},
        },
        "6": {
            "class_type": "LTXVConditioning",
            "inputs": {"positive": ["3", 0], "negative": ["4", 0], "frame_rate": float(frame_rate)},
        },
        "7": {
            "class_type": "ModelSamplingLTXV",
            "inputs": {"model": ["1", 0], "max_shift": 2.05, "base_shift": 0.95},
        },
        "8": {
            "class_type": "LTXVScheduler",
            "inputs": {"steps": steps, "max_shift": 2.05, "base_shift": 0.95, "stretch": True, "terminal": 0.1},
        },
        "9": {
            "class_type": "KSamplerSelect",
            "inputs": {"sampler_name": sampler},
        },
        "10": {
            "class_type": "SamplerCustom",
            "inputs": {
                "model": ["7", 0],
                "add_noise": True,
                "noise_seed": seed,
                "cfg": cfg,
                "positive": ["6", 0],
                "negative": ["6", 1],
                "sampler": ["9", 0],
                "sigmas": ["8", 0],
                "latent_image": ["5", 0],
            },
        },
        "11": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["10", 0], "vae": ["1", 2]},
        },
        "12": {
            "class_type": "SaveAnimatedWEBP",
            "inputs": {
                "images": ["11", 0],
                "filename_prefix": "crucible_video",
                "fps": float(frame_rate),
                "lossless": False,
                "quality": 90,
                "method": "default",
            },
        },
    }


async def generate_video(
    *,
    checkpoint: str,
    text_encoder: str,
    positive: str,
    negative: str = "",
    width: int = 768,
    height: int = 512,
    length: int = 97,
    frame_rate: int = 24,
    steps: int = 8,
    cfg: float = 1.0,
    sampler: str = "euler",
    seed: int = 0,
) -> AsyncGenerator[dict, None]:
    """Run an LTX text-to-video workflow end-to-end. Yields the same SSE shape as generate()."""
    client_id = uuid.uuid4().hex
    workflow = build_ltxv_t2v_workflow(
        checkpoint=checkpoint, text_encoder=text_encoder,
        positive=positive, negative=negative,
        width=width, height=height, length=length, frame_rate=frame_rate,
        steps=steps, cfg=cfg, sampler=sampler, seed=seed,
    )
    try:
        async with websockets.connect(
            f"{COMFY_WS}/ws?clientId={client_id}",
            max_size=2**24,
            ping_interval=20,
        ) as ws:
            try:
                prompt_id = await queue_prompt(workflow, client_id)
            except httpx.HTTPStatusError as e:
                detail = e.response.text[:400] if e.response is not None else str(e)
                yield {"event": "error", "error": f"queue failed: {detail}"}
                return
            yield {"event": "queued", "prompt_id": prompt_id}

            done = False
            while not done:
                msg = await ws.recv()
                if isinstance(msg, bytes):
                    continue
                payload = json.loads(msg)
                kind = payload.get("type")
                data = payload.get("data", {})
                if kind == "progress" and data.get("prompt_id") == prompt_id:
                    yield {
                        "event": "progress",
                        "value": data.get("value", 0),
                        "max": data.get("max", 1),
                    }
                elif kind == "executing" and data.get("prompt_id") == prompt_id:
                    node_id = data.get("node")
                    if node_id is None:
                        done = True
                    else:
                        cls = workflow.get(str(node_id), {}).get("class_type", "")
                        yield {"event": "stage", "node": node_id, "class": cls}
                elif kind == "execution_error" and data.get("prompt_id") == prompt_id:
                    yield {"event": "error", "error": data.get("exception_message", "unknown")}
                    return

        history = await get_history(prompt_id)
        videos = []
        for node_out in (history.get("outputs") or {}).values():
            for clip in node_out.get("images", []) or []:
                videos.append({
                    "filename": clip.get("filename"),
                    "subfolder": clip.get("subfolder", ""),
                    "type": clip.get("type", "output"),
                })
        yield {"event": "done", "prompt_id": prompt_id, "videos": videos}
    except Exception as e:
        yield {"event": "error", "error": f"comfy: {e}"}


def output_path(filename: str, subfolder: str = "") -> Path | None:
    """Resolve an output filename to an absolute path, blocking traversal."""
    base = OUTPUT_DIR / subfolder if subfolder else OUTPUT_DIR
    try:
        base = base.resolve()
        OUTPUT_DIR.resolve().relative_to(OUTPUT_DIR.resolve())  # noop sanity
    except Exception:
        return None
    p = (base / filename).resolve()
    try:
        p.relative_to(OUTPUT_DIR.resolve())
    except ValueError:
        return None
    return p if p.exists() else None
