"""HTTP endpoints for the structured eval suite."""
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

import eval_suite

router = APIRouter()


class EvalStart(BaseModel):
    model_id: str


def _omlx_name(model_id: str, registry) -> str:
    m = registry.get(model_id) if registry else None
    if m and getattr(m, "path", None):
        return Path(m.path).name
    return model_id.split(":", 1)[-1] if ":" in model_id else model_id


@router.post("/eval-suite/start")
async def start(body: EvalStart, request: Request) -> dict:
    cfg = request.app.state.config
    base_url = cfg.mlx_external_url or "http://127.0.0.1:8000"
    api_key = cfg.omlx_api_key
    omlx_name = _omlx_name(body.model_id, request.app.state.registry)
    job = eval_suite.start(body.model_id, omlx_name, base_url, api_key)
    return {"job_id": job.id, "total_items": len(eval_suite.EVAL_ITEMS)}


@router.get("/eval-suite/items")
async def items() -> dict:
    return {
        "items": [
            {"id": i.id, "category": i.category, "prompt": i.prompt}
            for i in eval_suite.EVAL_ITEMS
        ],
        "categories": sorted({i.category for i in eval_suite.EVAL_ITEMS}),
    }


@router.get("/eval-suite")
async def list_jobs() -> list[dict]:
    out = []
    for j in eval_suite.list_jobs():
        summary = eval_suite.summarize(j)
        out.append({
            "id": j.id, "model_id": j.model_id, "status": j.status,
            "started_at": j.started_at, "finished_at": j.finished_at,
            "completed": len(j.results),
            "summary": summary,
        })
    return out


@router.get("/eval-suite/{job_id}")
async def get_job(job_id: str) -> dict:
    j = eval_suite.get(job_id)
    if not j:
        raise HTTPException(404, "Eval job not found")
    return {
        "id": j.id, "model_id": j.model_id, "status": j.status,
        "started_at": j.started_at, "finished_at": j.finished_at,
        "results": [r.__dict__ for r in j.results],
        "summary": eval_suite.summarize(j),
    }
