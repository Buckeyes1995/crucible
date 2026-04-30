"""Image generation endpoints — proxies a local ComfyUI daemon."""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

import comfy_client

router = APIRouter()


class GenerateRequest(BaseModel):
    checkpoint: str
    positive: str
    negative: str = ""
    width: int = 1024
    height: int = 1024
    steps: int = 25
    cfg: float = 7.0
    sampler: str = "dpmpp_2m"
    scheduler: str = "karras"
    seed: int = 0


@router.get("/images/status")
async def status() -> dict:
    return await comfy_client.status()


@router.get("/images/checkpoints")
async def checkpoints() -> dict:
    try:
        return {"checkpoints": await comfy_client.list_checkpoints()}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"comfy unreachable: {e}")


@router.get("/images/samplers")
async def samplers() -> dict:
    try:
        return {"samplers": await comfy_client.list_samplers()}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"comfy unreachable: {e}")


@router.post("/images/generate")
async def generate(body: GenerateRequest) -> StreamingResponse:
    async def _stream():
        async for evt in comfy_client.generate(
            checkpoint=body.checkpoint,
            positive=body.positive,
            negative=body.negative,
            width=body.width,
            height=body.height,
            steps=body.steps,
            cfg=body.cfg,
            sampler=body.sampler,
            scheduler=body.scheduler,
            seed=body.seed,
        ):
            yield f"data: {json.dumps(evt)}\n\n"

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/images/gallery")
async def gallery(limit: int = 100) -> dict:
    return {"images": comfy_client.list_outputs(limit=limit)}


@router.get("/images/file/{filename:path}")
async def file(filename: str, subfolder: str = ""):
    p = comfy_client.output_path(filename, subfolder)
    if not p:
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(str(p))


@router.delete("/images/file/{filename:path}")
async def delete_file(filename: str, subfolder: str = "") -> dict:
    p = comfy_client.output_path(filename, subfolder)
    if not p:
        raise HTTPException(status_code=404, detail="not found")
    try:
        Path(p).unlink()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"deleted": filename}
