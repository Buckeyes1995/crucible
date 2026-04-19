"""End-to-end fine-tuning scaffold — one-click: curator export JSONL ->
finetune job -> registered LoRA adapter on completion.

Wraps the existing /finetune infrastructure (backend/finetune.py) with:
  * a helper that creates a job from a curator export filename
  * a post-completion hook that tags the output dir with metadata the
    registry can pick up as a loadable model

For the actual trainer command we rely on whatever backend/finetune.py
already invokes (mlx_lm lora or similar). If no trainer is configured,
jobs will error with a clear message rather than silently hang.
"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

import finetune as ft

router = APIRouter()

CURATOR_EXPORT_DIR = Path.home() / ".config" / "crucible" / "curator_exports"
DEFAULT_OUTPUT_BASE = Path.home() / ".config" / "crucible" / "finetune_output"


class PipelineStart(BaseModel):
    base_model_id: str
    curator_export: str          # filename inside curator_exports/
    run_name: str | None = None
    num_iters: int = 1000
    learning_rate: float = 1e-4
    lora_rank: int = 8
    batch_size: int = 4


@router.post("/finetune-pipeline/start")
async def start(body: PipelineStart, request: Request) -> dict:
    """Create a finetune job wired to a curator JSONL. Returns the job dict
    so the caller can poll /finetune/jobs/{id}/stream for live logs."""
    dataset = CURATOR_EXPORT_DIR / body.curator_export
    if not dataset.exists():
        raise HTTPException(404, f"curator export not found: {body.curator_export}")

    name = body.run_name or dataset.stem
    output_dir = DEFAULT_OUTPUT_BASE / name
    output_dir.mkdir(parents=True, exist_ok=True)

    job = ft.create_job(
        model_id=body.base_model_id,
        data_path=str(dataset),
        output_dir=str(output_dir),
        num_iters=body.num_iters,
        learning_rate=body.learning_rate,
        lora_rank=body.lora_rank,
        batch_size=body.batch_size,
        grad_checkpoint=True,
    )
    # Tag the output dir with provenance so the registry (or a post-hook) can
    # pick it up later as a loadable adapter.
    try:
        (output_dir / "crucible.json").write_text(json.dumps({
            "source": "curator",
            "curator_export": body.curator_export,
            "base_model_id": body.base_model_id,
            "job_id": job.id,
            "name": name,
        }, indent=2))
    except Exception:
        pass
    return ft._job_to_dict(job)


@router.get("/finetune-pipeline/outputs")
async def list_outputs() -> list[dict]:
    """Show previously completed pipeline runs that left a crucible.json tag."""
    out = []
    if not DEFAULT_OUTPUT_BASE.exists():
        return out
    for d in sorted(DEFAULT_OUTPUT_BASE.iterdir()):
        if not d.is_dir():
            continue
        tag = d / "crucible.json"
        if not tag.exists():
            continue
        try:
            meta = json.loads(tag.read_text())
        except Exception:
            continue
        # Rough completion signal: presence of adapter weight files
        has_weights = any(d.glob("**/adapter*.safetensors")) or any(d.glob("**/adapters*.safetensors"))
        out.append({
            **meta,
            "path": str(d),
            "completed": has_weights,
        })
    return out
