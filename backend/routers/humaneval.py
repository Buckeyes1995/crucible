"""HumanEval benchmark endpoints."""
import json
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from benchmark.humaneval import (
    HUMANEVAL_PROBLEMS, get_run, list_runs, start_run, stream_run
)

router = APIRouter()


class StartHumanEvalRequest(BaseModel):
    problem_ids: list[str] | None = None   # None = all 164
    temperature: float = 0.0
    max_tokens: int = 1024


@router.get("/humaneval/problems")
async def get_problems() -> list[dict]:
    """Return all 164 problems (prompt + metadata, no canonical solution)."""
    return [
        {
            "task_id": p["task_id"],
            "entry_point": p["entry_point"],
            "prompt": p["prompt"],
        }
        for p in HUMANEVAL_PROBLEMS
    ]


@router.post("/humaneval/run")
async def run_humaneval(body: StartHumanEvalRequest, request: Request) -> dict:
    adapter = request.app.state.active_adapter
    if not adapter or not adapter.is_loaded():
        raise HTTPException(status_code=400, detail="No model loaded")

    model_id = adapter.model_id or "unknown"
    run_id = await start_run(
        adapter=adapter,
        model_id=model_id,
        problem_ids=body.problem_ids,
        temperature=body.temperature,
        max_tokens=body.max_tokens,
    )
    return {"run_id": run_id, "status": "started"}


@router.get("/humaneval/runs")
async def get_runs() -> list[dict]:
    return list_runs()


@router.get("/humaneval/run/{run_id}")
async def get_run_detail(run_id: str) -> dict:
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return {
        **run.summary(),
        "results": [
            {
                "task_id": r.task_id,
                "entry_point": r.entry_point,
                "category": r.category,
                "passed": r.passed,
                "error": r.error,
                "completion": r.completion,
                "elapsed_ms": r.elapsed_ms,
            }
            for r in run.results
        ],
    }


@router.get("/humaneval/run/{run_id}/stream")
async def stream_run_endpoint(run_id: str) -> StreamingResponse:
    async def _gen():
        async for evt in stream_run(run_id):
            yield f"data: {json.dumps(evt)}\n\n"

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
