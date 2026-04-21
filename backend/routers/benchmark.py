import json
import time
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse

from adapters.mlx_lm import MLXAdapter
from adapters.omlx import OMLXAdapter
from adapters.llama_cpp import LlamaCppAdapter
from adapters.ollama import OllamaAdapter
from adapters.external import ExternalAdapter, ManagedExternalAdapter
from adapters.remote_node import RemoteNodeAdapter
from benchmark.engine import run_benchmark
from benchmark.prompts import BUILTIN_PROMPTS, PRESETS
from db.database import DB_PATH
from models.schemas import BenchmarkConfig

router = APIRouter()


async def _regression_flags(db) -> dict[str, bool]:
    """Return {run_id: has_regression} for all runs in one query."""
    sql = """
    WITH run_tps AS (
      SELECT run_id, model_id,
             AVG(json_extract(metrics_json, '$.throughput_tps')) AS avg_tps
      FROM benchmark_results
      WHERE json_extract(metrics_json, '$.throughput_tps') IS NOT NULL
      GROUP BY run_id, model_id
    ),
    model_history AS (
      SELECT rt.run_id, rt.model_id, rt.avg_tps AS current_tps,
             AVG(prior.avg_tps) AS baseline_tps,
             COUNT(prior.run_id) AS prior_count
      FROM run_tps rt
      LEFT JOIN run_tps prior ON prior.model_id = rt.model_id
        AND (SELECT created_at FROM benchmark_runs WHERE id = prior.run_id)
          < (SELECT created_at FROM benchmark_runs WHERE id = rt.run_id)
      GROUP BY rt.run_id, rt.model_id
    ),
    run_flags AS (
      SELECT run_id,
             MAX(CASE WHEN prior_count > 0
                       AND baseline_tps > 0
                       AND (baseline_tps - current_tps) / baseline_tps > 0.10
                  THEN 1 ELSE 0 END) AS has_regression
      FROM model_history
      GROUP BY run_id
    )
    SELECT run_id, has_regression FROM run_flags
    """
    flags: dict[str, bool] = {}
    async with db.execute(sql) as cur:
        async for row in cur:
            flags[row[0]] = bool(row[1])
    return flags


async def _regression_detail(db, run_id: str) -> dict[str, dict]:
    """Return per-model regression detail for a specific run."""
    sql = """
    WITH prior AS (
      SELECT br.model_id,
             AVG(json_extract(br.metrics_json, '$.throughput_tps')) AS baseline_tps,
             COUNT(DISTINCT br.run_id) AS run_count
      FROM benchmark_results br
      JOIN benchmark_runs r ON br.run_id = r.id
      WHERE json_extract(br.metrics_json, '$.throughput_tps') IS NOT NULL
        AND r.created_at < (SELECT created_at FROM benchmark_runs WHERE id = ?)
        AND br.model_id IN (
          SELECT DISTINCT model_id FROM benchmark_results WHERE run_id = ?
        )
      GROUP BY br.model_id
    ),
    current AS (
      SELECT model_id,
             AVG(json_extract(metrics_json, '$.throughput_tps')) AS current_tps
      FROM benchmark_results
      WHERE run_id = ?
        AND json_extract(metrics_json, '$.throughput_tps') IS NOT NULL
      GROUP BY model_id
    )
    SELECT c.model_id, c.current_tps,
           p.baseline_tps, p.run_count
    FROM current c
    LEFT JOIN prior p ON c.model_id = p.model_id
    """
    result: dict[str, dict] = {}
    async with db.execute(sql, (run_id, run_id, run_id)) as cur:
        async for row in cur:
            model_id, current_tps, baseline_tps, run_count = row
            is_reg = (
                baseline_tps is not None
                and baseline_tps > 0
                and (baseline_tps - current_tps) / baseline_tps > 0.10
            )
            delta_pct = (
                (current_tps - baseline_tps) / baseline_tps * 100
                if baseline_tps and baseline_tps > 0
                else None
            )
            result[model_id] = {
                "current_avg_tps": round(current_tps, 2),
                "baseline_avg_tps": round(baseline_tps, 2) if baseline_tps else None,
                "baseline_run_count": run_count or 0,
                "delta_pct": round(delta_pct, 1) if delta_pct is not None else None,
                "is_regression": is_reg,
            }
    return result


MARKETPLACE_URL = "https://raw.githubusercontent.com/Buckeyes1995/crucible/main/marketplace/prompts.json"
_marketplace_cache: dict = {"data": None, "fetched_at": 0.0}
_CACHE_TTL = 300  # 5 minutes


def _builtin_as_marketplace() -> dict:
    """Return built-in prompts in marketplace format as a fallback."""
    return {
        "version": 1,
        "updated": "built-in",
        "prompts": [
            {**p, "author": "crucible", "tags": [p["category"].lower()]}
            for p in BUILTIN_PROMPTS
        ],
    }


@router.get("/benchmark/marketplace")
async def get_marketplace() -> dict:
    """Fetch community prompts from the GitHub-hosted marketplace JSON (cached 5 min)."""
    import httpx
    now = time.time()
    if _marketplace_cache["data"] and now - _marketplace_cache["fetched_at"] < _CACHE_TTL:
        return _marketplace_cache["data"]
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(MARKETPLACE_URL)
            r.raise_for_status()
            data = r.json()
            _marketplace_cache["data"] = data
            _marketplace_cache["fetched_at"] = now
            return data
    except Exception:
        # Return cached stale data if available, else fall back to built-ins
        if _marketplace_cache["data"]:
            return _marketplace_cache["data"]
        return _builtin_as_marketplace()


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

        if model.node != "local":
            meta = model.backend_meta or {}
            adapter = RemoteNodeAdapter(
                node_url=meta["_remote_url"],
                remote_model_id=meta["_remote_model_id"],
                api_key=meta.get("_remote_api_key", ""),
            )
        elif model.kind == "mlx":
            if app_config.mlx_external_url:
                adapter = ExternalAdapter(base_url=app_config.mlx_external_url)
            else:
                # Use OMLXAdapter (shared with the load router) so benchmarks reuse
                # oMLX's already-running server instead of spawning a second mlx_lm.server.
                adapter = OMLXAdapter(
                    base_url="http://127.0.0.1:8000",
                    model_dir=app_config.mlx_dir,
                    api_key=app_config.omlx_api_key,
                )
        elif model.kind == "gguf":
            adapter = LlamaCppAdapter(
                server_path=app_config.llama_server,
                port=app_config.llama_port,
            )
        elif model.kind == "mlx_studio":
            if not app_config.mlx_studio_url:
                yield {"event": "error", "message": "MLX Studio URL not configured in Settings"}
                return
            adapter = ManagedExternalAdapter(base_url=app_config.mlx_studio_url)
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

    # 2KB of padding per event (comment line, ignored by clients) so
    # Cloudflare tunnels flush each chunk instead of buffering to ~4KB.
    _PAD = ":" + (" " * 2048) + "\n"

    async def _stream():
        async for evt in run_benchmark(
            config,
            registry,
            _get_adapter_for_model,
            str(DB_PATH),
        ):
            event_type = evt.get("event", "progress")
            data = {k: v for k, v in evt.items() if k not in ("event", "_adapter")}
            yield _PAD + f"data: {json.dumps({'event': event_type, **data})}\n\n"

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/benchmark/history")
async def list_history(request: Request) -> list[dict]:
    import aiosqlite
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, created_at, name, summary_json FROM benchmark_runs ORDER BY created_at DESC"
        ) as cur:
            raw = [(row["id"], row["created_at"], row["name"], row["summary_json"])
                   async for row in cur]

        # Compute regression flags in one pass
        db.row_factory = None
        flags = await _regression_flags(db)

    rows = []
    for run_id, created_at, name, summary_json in raw:
        summary = json.loads(summary_json or "{}")
        rows.append({
            "run_id": run_id,
            "created_at": created_at,
            "name": name,
            "has_regression": flags.get(run_id, False),
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

        db.row_factory = None
        regression = await _regression_detail(db, run_id)

    return {
        "run_id": run_row["id"],
        "created_at": run_row["created_at"],
        "name": run_row["name"],
        "config": json.loads(run_row["config_json"]),
        "summary": json.loads(run_row["summary_json"] or "{}"),
        "results": results,
        "regression": regression,
    }


@router.get("/benchmark/run/{run_id}/csv")
async def get_run_csv(run_id: str):
    """Stream benchmark results as CSV for spreadsheet / pandas use."""
    import aiosqlite
    import csv
    import io
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT name FROM benchmark_runs WHERE id = ?", (run_id,)
        ) as cur:
            run_row = await cur.fetchone()
        if not run_row:
            raise HTTPException(status_code=404, detail="Run not found")
        rows = []
        async with db.execute(
            "SELECT model_id, model_name, backend_kind, prompt_id, rep, metrics_json "
            "FROM benchmark_results WHERE run_id = ? ORDER BY id",
            (run_id,),
        ) as cur:
            async for row in cur:
                m = json.loads(row["metrics_json"] or "{}")
                rows.append({
                    "model_id": row["model_id"],
                    "model_name": row["model_name"],
                    "backend_kind": row["backend_kind"],
                    "prompt_id": row["prompt_id"],
                    "rep": row["rep"],
                    "ttft_ms": m.get("ttft_ms"),
                    "tps": m.get("throughput_tps"),
                    "prompt_tokens": m.get("prompt_tokens"),
                    "output_tokens": m.get("output_tokens"),
                    "total_ms": m.get("total_ms"),
                    "error": m.get("error"),
                })

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=[
        "model_id", "model_name", "backend_kind", "prompt_id", "rep",
        "ttft_ms", "tps", "prompt_tokens", "output_tokens", "total_ms", "error",
    ])
    writer.writeheader()
    for r in rows:
        writer.writerow(r)
    safe_name = (run_row["name"] or run_id).replace("/", "_").replace(" ", "_")
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="bench_{safe_name}.csv"'},
    )


@router.delete("/benchmark/run/{run_id}")
async def delete_run(run_id: str) -> dict:
    import aiosqlite
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        await db.execute("DELETE FROM benchmark_runs WHERE id = ?", (run_id,))
        await db.commit()
    return {"status": "deleted"}


@router.delete("/benchmark/history")
async def delete_all_runs() -> dict:
    """Nuke the entire benchmark history. Returns the number of runs removed."""
    import aiosqlite
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        async with db.execute("SELECT COUNT(*) FROM benchmark_runs") as cur:
            row = await cur.fetchone()
            n = row[0] if row else 0
        await db.execute("DELETE FROM benchmark_runs")
        await db.commit()
    return {"status": "deleted", "count": n}


@router.get("/benchmark/diff")
async def benchmark_diff(a: str, b: str) -> dict:
    """Compare two benchmark runs by model + prompt. Returns per-cell
    deltas so the frontend can render a colored matrix."""
    import aiosqlite
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        rows_by_run: dict[str, list[dict]] = {a: [], b: []}
        for run_id in (a, b):
            async with db.execute(
                "SELECT model_id, model_name, prompt_id, metrics_json "
                "FROM benchmark_results WHERE run_id = ?",
                (run_id,),
            ) as cur:
                async for row in cur:
                    m = json.loads(row["metrics_json"] or "{}")
                    rows_by_run[run_id].append({
                        "model_id": row["model_id"],
                        "model_name": row["model_name"],
                        "prompt_id": row["prompt_id"],
                        "tps": m.get("throughput_tps"),
                        "ttft_ms": m.get("ttft_ms"),
                    })
        async with db.execute(
            "SELECT id, created_at, name FROM benchmark_runs WHERE id IN (?, ?)",
            (a, b),
        ) as cur:
            meta = {row["id"]: dict(row) async for row in cur}

    # average per (model, prompt) in each run
    def agg(rows: list[dict]) -> dict[tuple[str, str], dict]:
        out: dict[tuple[str, str], dict] = {}
        for r in rows:
            key = (r["model_id"], r["prompt_id"])
            slot = out.setdefault(key, {"tps": [], "ttft_ms": [], "model_name": r["model_name"]})
            if r["tps"] is not None:
                slot["tps"].append(r["tps"])
            if r["ttft_ms"] is not None:
                slot["ttft_ms"].append(r["ttft_ms"])
        return out

    agg_a = agg(rows_by_run[a])
    agg_b = agg(rows_by_run[b])
    all_keys = sorted(set(agg_a.keys()) | set(agg_b.keys()))

    def avg(xs: list[float]) -> float | None:
        return round(sum(xs) / len(xs), 2) if xs else None

    cells = []
    for (model_id, prompt_id) in all_keys:
        ra = agg_a.get((model_id, prompt_id), {"tps": [], "ttft_ms": [], "model_name": model_id})
        rb = agg_b.get((model_id, prompt_id), {"tps": [], "ttft_ms": [], "model_name": model_id})
        tps_a = avg(ra["tps"])
        tps_b = avg(rb["tps"])
        ttft_a = avg(ra["ttft_ms"])
        ttft_b = avg(rb["ttft_ms"])
        cells.append({
            "model_id": model_id,
            "model_name": ra.get("model_name") or rb.get("model_name") or model_id,
            "prompt_id": prompt_id,
            "a": {"tps": tps_a, "ttft_ms": ttft_a},
            "b": {"tps": tps_b, "ttft_ms": ttft_b},
            "delta_tps_pct": (
                round(((tps_b - tps_a) / tps_a) * 100, 1)
                if tps_a and tps_b else None
            ),
            "delta_ttft_pct": (
                round(((ttft_b - ttft_a) / ttft_a) * 100, 1)
                if ttft_a and ttft_b else None
            ),
        })
    return {
        "a": meta.get(a, {"id": a}),
        "b": meta.get(b, {"id": b}),
        "cells": cells,
    }


@router.get("/benchmark/model/{model_id:path}/history")
async def model_benchmark_history(model_id: str, limit: int = 50) -> list[dict]:
    """Per-run avg tok/s for a model, ordered by run date. Powers the tok/s over time chart."""
    import aiosqlite
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            """
            SELECT r.id AS run_id,
                   r.created_at,
                   r.name AS run_name,
                   AVG(json_extract(br.metrics_json, '$.throughput_tps')) AS avg_tps,
                   AVG(json_extract(br.metrics_json, '$.ttft_ms')) AS avg_ttft_ms,
                   COUNT(*) AS sample_count
            FROM benchmark_results br
            JOIN benchmark_runs r ON br.run_id = r.id
            WHERE br.model_id = ?
              AND json_extract(br.metrics_json, '$.throughput_tps') IS NOT NULL
            GROUP BY br.run_id
            ORDER BY r.created_at ASC
            LIMIT ?
            """,
            (model_id, limit),
        ) as cur:
            rows = []
            async for row in cur:
                run_id, created_at, run_name, avg_tps, avg_ttft_ms, sample_count = row
                rows.append({
                    "run_id": run_id,
                    "created_at": created_at,
                    "run_name": run_name,
                    "avg_tps": round(avg_tps, 2) if avg_tps else None,
                    "avg_ttft_ms": round(avg_ttft_ms, 1) if avg_ttft_ms else None,
                    "sample_count": sample_count,
                })
    return rows
