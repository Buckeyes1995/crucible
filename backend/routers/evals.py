"""Evals harness (Roadmap v4 #5 MVP) — unified landing surface on top of
existing per-suite runners. V1 ships GSM8K + surfaces the existing
HumanEval runner. V2 layers on MMLU + ARC + TruthfulQA + published
baseline comparisons."""
from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from evals import gsm8k

router = APIRouter()


class GSM8KRunRequest(BaseModel):
    limit: int = 50
    seed: int = 0


@router.post("/evals/gsm8k/run")
async def run_gsm8k(body: GSM8KRunRequest, request: Request) -> StreamingResponse:
    adapter = request.app.state.active_adapter
    model_id = adapter.model_id if adapter and adapter.is_loaded() else None

    async def _stream():
        async for evt in gsm8k.run(model_id=model_id, limit=max(5, min(body.limit, 500)), seed=body.seed):
            yield f"data: {json.dumps(evt, default=str)}\n\n".encode()

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/evals/gsm8k/history")
async def gsm8k_history() -> list[dict[str, Any]]:
    return gsm8k.load_history()


@router.get("/evals/suites")
async def list_suites() -> list[dict[str, Any]]:
    """Registry of eval suites the UI can surface. HumanEval is in
    routers/humaneval.py; we describe it here so the /evals page can
    deep-link without re-implementing."""
    return [
        {
            "id": "gsm8k",
            "name": "GSM8K",
            "description": "Grade-school math word problems. Tests step-by-step arithmetic reasoning.",
            "size_available": 100,
            "size_default": 50,
            "run_endpoint": "/api/evals/gsm8k/run",
            "history_endpoint": "/api/evals/gsm8k/history",
            "docs_url": "https://github.com/openai/grade-school-math",
        },
        {
            "id": "humaneval",
            "name": "HumanEval",
            "description": "164 Python function-completion problems scored by pass@1. Ships with the existing runner.",
            "size_available": 164,
            "size_default": 20,
            "run_endpoint": "/api/humaneval/run",
            "history_endpoint": "/api/humaneval/history",
            "route": "/humaneval",
            "docs_url": "https://github.com/openai/human-eval",
        },
    ]
