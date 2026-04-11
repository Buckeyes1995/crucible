import json
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse

from adapters.mlx_lm import MLXAdapter
from adapters.llama_cpp import LlamaCppAdapter
from adapters.ollama import OllamaAdapter
from adapters.external import ExternalAdapter
from benchmark.engine import run_benchmark
from benchmark.prompts import BUILTIN_PROMPTS, PRESETS
from db.database import DB_PATH
from models.schemas import BenchmarkConfig

router = APIRouter()


@router.get("/benchmark/prompts")
async def list_prompts() -> list[dict]:
    return BUILTIN_PROMPTS


@router.get("/benchmark/presets")
async def list_presets() -> dict:
    return PRESETS


@router.post("/benchmark/run")
async def start_benchmark(config: BenchmarkConfig, request: Request) -> StreamingResponse:
    registry = request.app.state.registry
    app_config = request.app.state.config

    async def _get_adapter_for_model(model):
        """Load model and inject adapter reference into the done event.
        Reuses the active adapter if the correct model is already loaded."""
        active = request.app.state.active_adapter
        if active and active.model_id == model.id and active.is_loaded():
            yield {"event": "stage", "message": f"Using already-loaded {model.name}"}
            yield {"event": "done", "model_id": model.id, "elapsed_ms": 0, "_adapter": active}
            return

        if model.kind == "mlx":
            if app_config.mlx_external_url:
                adapter = ExternalAdapter(base_url=app_config.mlx_external_url)
            else:
                adapter = MLXAdapter(port=app_config.mlx_port, python=app_config.mlx_python)
        elif model.kind == "gguf":
            adapter = LlamaCppAdapter(
                server_path=app_config.llama_server,
                port=app_config.llama_port,
            )
        elif model.kind == "ollama":
            adapter = OllamaAdapter(host=app_config.ollama_host)
        else:
            yield {"event": "error", "message": f"Unknown kind: {model.kind}"}
            return

        async for evt in adapter.load(model):
            if evt.get("event") == "done":
                evt["_adapter"] = adapter
                request.app.state.active_adapter = adapter
            yield evt

    async def _stream():
        async for evt in run_benchmark(
            config,
            registry,
            _get_adapter_for_model,
            str(DB_PATH),
        ):
            event_type = evt.get("event", "progress")
            data = {k: v for k, v in evt.items() if k not in ("event", "_adapter")}
            yield f"data: {json.dumps({'event': event_type, **data})}\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream")


@router.get("/benchmark/history")
async def list_history(request: Request) -> list[dict]:
    import aiosqlite
    rows = []
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, created_at, name, summary_json FROM benchmark_runs ORDER BY created_at DESC"
        ) as cur:
            async for row in cur:
                summary = json.loads(row["summary_json"] or "{}")
                rows.append({
                    "run_id": row["id"],
                    "created_at": row["created_at"],
                    "name": row["name"],
                    **summary,
                })
    return rows


@router.get("/benchmark/run/{run_id}")
async def get_run(run_id: str) -> dict:
    import aiosqlite
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM benchmark_runs WHERE id = ?", (run_id,)
        ) as cur:
            run_row = await cur.fetchone()
        if not run_row:
            raise HTTPException(status_code=404, detail="Run not found")
        results = []
        async with db.execute(
            "SELECT * FROM benchmark_results WHERE run_id = ? ORDER BY id",
            (run_id,),
        ) as cur:
            async for row in cur:
                results.append({
                    "model_id": row["model_id"],
                    "model_name": row["model_name"],
                    "backend_kind": row["backend_kind"],
                    "prompt_id": row["prompt_id"],
                    "prompt_text": row["prompt_text"],
                    "rep": row["rep"],
                    "metrics": json.loads(row["metrics_json"]),
                    "response_text": row["response_text"] or "",
                })
    return {
        "run_id": run_row["id"],
        "created_at": run_row["created_at"],
        "name": run_row["name"],
        "config": json.loads(run_row["config_json"]),
        "summary": json.loads(run_row["summary_json"] or "{}"),
        "results": results,
    }


@router.delete("/benchmark/run/{run_id}")
async def delete_run(run_id: str) -> dict:
    import aiosqlite
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        await db.execute("DELETE FROM benchmark_runs WHERE id = ?", (run_id,))
        await db.commit()
    return {"status": "deleted"}
