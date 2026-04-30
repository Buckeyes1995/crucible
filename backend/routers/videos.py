"""Video generation endpoints — LTX-Video via the local ComfyUI daemon."""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

import comfy_client

router = APIRouter()

VIDEO_EXTS = (".webp", ".mp4", ".gif")


class GenerateVideoRequest(BaseModel):
    checkpoint: str
    text_encoder: str
    positive: str
    negative: str = ""
    width: int = 768
    height: int = 512
    length: int = 97
    frame_rate: int = 24
    steps: int = 8
    cfg: float = 1.0
    sampler: str = "euler"
    seed: int = 0


@router.get("/videos/status")
async def status() -> dict:
    return await comfy_client.status()


@router.get("/videos/checkpoints")
async def checkpoints() -> dict:
    """Returns ComfyUI's full checkpoint list — frontend filters for video models."""
    try:
        return {"checkpoints": await comfy_client.list_checkpoints()}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"comfy unreachable: {e}")


@router.get("/videos/text_encoders")
async def text_encoders() -> dict:
    try:
        return {"text_encoders": await comfy_client.list_text_encoders()}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"comfy unreachable: {e}")


@router.post("/videos/generate")
async def generate(body: GenerateVideoRequest) -> StreamingResponse:
    async def _stream():
        async for evt in comfy_client.generate_video(
            checkpoint=body.checkpoint,
            text_encoder=body.text_encoder,
            positive=body.positive,
            negative=body.negative,
            width=body.width,
            height=body.height,
            length=body.length,
            frame_rate=body.frame_rate,
            steps=body.steps,
            cfg=body.cfg,
            sampler=body.sampler,
            seed=body.seed,
        ):
            yield f"data: {json.dumps(evt)}\n\n"

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/videos/gallery")
async def gallery(limit: int = 100) -> dict:
    return {"videos": comfy_client.list_outputs(limit=limit, extensions=VIDEO_EXTS)}


@router.get("/videos/file/{filename:path}")
async def file(filename: str, subfolder: str = ""):
    p = comfy_client.output_path(filename, subfolder)
    if not p:
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(str(p))


@router.delete("/videos/file/{filename:path}")
async def delete_file(filename: str, subfolder: str = "") -> dict:
    p = comfy_client.output_path(filename, subfolder)
    if not p:
        raise HTTPException(status_code=404, detail="not found")
    try:
        Path(p).unlink()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"deleted": filename}
