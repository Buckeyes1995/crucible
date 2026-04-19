"""HTTP endpoints for the NIAH (needle-in-haystack) context-length test."""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

import niah

router = APIRouter()


class NIAHStart(BaseModel):
    model_id: str
    lengths: list[int] = [2000, 8000, 16000, 32000]
    max_tokens: int = 128
    seed: int = 1


@router.post("/niah/start")
async def start(body: NIAHStart, request: Request) -> dict:
    cfg = request.app.state.config
    base_url = cfg.mlx_external_url or "http://127.0.0.1:8000"
    api_key = cfg.omlx_api_key
    job = niah.start(body.model_id, body.lengths, base_url, api_key,
                     max_tokens=body.max_tokens, seed=body.seed)
    return {"job_id": job.id}


@router.get("/niah")
async def list_jobs() -> list[dict]:
    return [
        {
            "id": j.id, "model_id": j.model_id,
            "lengths": j.lengths, "status": j.status,
            "started_at": j.started_at, "finished_at": j.finished_at,
            "done": len(j.results),
        }
        for j in niah.list_jobs()
    ]


@router.get("/niah/{job_id}")
async def get_job(job_id: str) -> dict:
    j = niah.get(job_id)
    if not j:
        raise HTTPException(404, "NIAH job not found")
    return {
        "id": j.id, "model_id": j.model_id, "lengths": j.lengths,
        "status": j.status, "started_at": j.started_at, "finished_at": j.finished_at,
        "results": [r.__dict__ for r in j.results],
    }
