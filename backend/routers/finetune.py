"""Fine-tune launcher endpoints."""
import json
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import asyncio

import finetune as ft

router = APIRouter()


class CreateJobRequest(BaseModel):
    model_id: str
    data_path: str
    output_dir: str
    num_iters: int = 1000
    learning_rate: float = 1e-4
    lora_rank: int = 8
    batch_size: int = 4
    grad_checkpoint: bool = True


@router.get("/finetune/jobs")
def list_jobs() -> list[dict]:
    return ft.list_jobs()


@router.post("/finetune/jobs", status_code=201)
def create_job(body: CreateJobRequest) -> dict:
    job = ft.create_job(
        model_id=body.model_id,
        data_path=body.data_path,
        output_dir=body.output_dir,
        num_iters=body.num_iters,
        learning_rate=body.learning_rate,
        lora_rank=body.lora_rank,
        batch_size=body.batch_size,
        grad_checkpoint=body.grad_checkpoint,
    )
    return ft._job_to_dict(job)


@router.post("/finetune/jobs/{job_id}/run")
async def run_job(job_id: str, request: Request) -> StreamingResponse:
    job = ft.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    app_config = request.app.state.config
    mlx_python = app_config.mlx_python or "python"

    async def _stream():
        async for evt in ft.run_job(job_id, mlx_python=mlx_python):
            event_type = evt.pop("event", "log")
            yield f"data: {json.dumps({'event': event_type, **evt})}\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream")


@router.post("/finetune/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict:
    if not ft.cancel_job(job_id):
        raise HTTPException(404, "Job not found")
    return {"status": "cancelled"}


@router.delete("/finetune/jobs/{job_id}")
def delete_job(job_id: str) -> dict:
    job = ft.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.status == "running":
        ft.cancel_job(job_id)
    ft._jobs.pop(job_id, None)
    ft._save_jobs()
    return {"status": "deleted"}


@router.get("/finetune/jobs/{job_id}/stream")
async def stream_job(job_id: str, request: Request) -> StreamingResponse:
    """Stream an already-queued job."""
    return await run_job(job_id, request)
