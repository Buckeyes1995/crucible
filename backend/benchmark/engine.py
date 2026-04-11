"""Benchmark engine — orchestrates multi-model, multi-prompt runs."""
import asyncio
import json
import time
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator, Any

import aiosqlite

from adapters.base import BaseAdapter
from benchmark.metrics import (
    get_memory_pressure,
    get_thermal_state,
    compute_percentiles,
    compute_tps_from_timestamps,
)
from benchmark.prompts import get_prompts_for_run
from models.schemas import BenchmarkConfig, MetricsResult, ChatMessage


async def _run_single(
    adapter: BaseAdapter,
    prompt_text: str,
    max_tokens: int,
    temperature: float,
) -> tuple["MetricsResult", str]:
    """Run one inference and collect all metrics. Returns (metrics, response_text)."""
    mem_start = get_memory_pressure()
    mem_peak = mem_start
    thermal = get_thermal_state()

    t_start = time.monotonic()
    t_first_token: float | None = None
    token_timestamps: list[float] = []
    output_tokens = 0
    response_parts: list[str] = []

    messages = [ChatMessage(role="user", content=prompt_text)]

    async for chunk in adapter.chat(messages, temperature=temperature, max_tokens=max_tokens):
        if chunk.get("done"):
            break
        token = chunk.get("token", "")
        if not token:
            continue
        now = time.monotonic()
        if t_first_token is None:
            t_first_token = now
        token_timestamps.append(now)
        output_tokens += 1
        response_parts.append(token)

        # Update peak memory every 10 tokens
        if output_tokens % 10 == 0:
            m = get_memory_pressure()
            if m is not None and (mem_peak is None or m > mem_peak):
                mem_peak = m

    t_end = time.monotonic()
    total_ms = (t_end - t_start) * 1000
    ttft_ms = (t_first_token - t_start) * 1000 if t_first_token else None

    generation_time = t_end - (t_first_token or t_start)
    throughput_tps = output_tokens / generation_time if generation_time > 0 and output_tokens > 0 else None

    tps_series = compute_tps_from_timestamps(token_timestamps)
    percentiles = compute_percentiles(tps_series)

    response_text = "".join(response_parts)

    return MetricsResult(
        ttft_ms=round(ttft_ms, 2) if ttft_ms else None,
        throughput_tps=round(throughput_tps, 2) if throughput_tps else None,
        prompt_eval_tps=None,  # would need server-side timing
        p50_tps=percentiles["p50"],
        p90_tps=percentiles["p90"],
        p99_tps=percentiles["p99"],
        total_ms=round(total_ms, 2),
        output_tokens=output_tokens,
        memory_pressure_start=mem_start,
        memory_pressure_peak=mem_peak,
        thermal_state=thermal,
        token_timestamps=[round(t - t_start, 4) for t in token_timestamps],
    ), response_text


async def run_benchmark(
    config: BenchmarkConfig,
    registry: Any,
    get_adapter_for_model: Any,
    db_path: str,
) -> AsyncGenerator[dict, None]:
    """
    Main benchmark runner. Yields SSE-style dicts.
    get_adapter_for_model: async callable(ModelEntry) -> AsyncGenerator (load events)
    """
    run_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    prompts = get_prompts_for_run(config)

    if not prompts:
        yield {"event": "error", "message": "No prompts selected"}
        return

    total_steps = len(config.model_ids) * len(prompts) * config.reps
    yield {"event": "start", "run_id": run_id, "total_steps": total_steps}

    # Save run record
    async with aiosqlite.connect(db_path) as db:
        await db.execute(
            "INSERT INTO benchmark_runs (id, created_at, name, config_json) VALUES (?, ?, ?, ?)",
            (run_id, created_at, config.name, config.model_dump_json()),
        )
        await db.commit()

    step = 0
    all_tps: list[float] = []

    for model_id in config.model_ids:
        model = registry.get(model_id)
        if not model:
            yield {"event": "error", "message": f"Model not found: {model_id}"}
            continue

        # Load model
        yield {"event": "progress", "step": step, "model_id": model_id, "status": "loading", "message": f"Loading {model.name}…"}

        adapter: BaseAdapter | None = None
        load_ok = False
        async for evt in get_adapter_for_model(model):
            yield evt
            if evt.get("event") == "done":
                adapter = evt.get("_adapter")  # injected by caller
                load_ok = True
            elif evt.get("event") == "error":
                break

        if not load_ok or adapter is None:
            yield {"event": "error", "message": f"Skipping {model.name} — failed to load"}
            continue

        # Warmup reps
        for _ in range(config.warmup_reps):
            try:
                async for _ in adapter.chat(
                    [ChatMessage(role="user", content="hi")],
                    temperature=0.0,
                    max_tokens=4,
                ):
                    pass
            except Exception:
                pass

        # Benchmark reps
        for prompt in prompts:
            for rep in range(1, config.reps + 1):
                step += 1
                yield {"event": "progress", "step": step, "model_id": model_id, "prompt_id": prompt["id"], "rep": rep, "status": "running"}

                try:
                    metrics, response_text = await _run_single(
                        adapter,
                        prompt["text"],
                        config.max_tokens,
                        config.temperature,
                    )
                except Exception as e:
                    yield {"event": "error", "step": step, "model_id": model_id, "message": str(e)}
                    continue

                if metrics.throughput_tps is not None:
                    all_tps.append(metrics.throughput_tps)
                    registry.update_stats(
                        model_id,
                        round(metrics.throughput_tps, 2),
                        datetime.now(timezone.utc).isoformat(),
                    )

                result_dict = metrics.model_dump()
                yield {
                    "event": "result",
                    "step": step,
                    "model_id": model_id,
                    "prompt_id": prompt["id"],
                    "rep": rep,
                    "metrics": result_dict,
                    "response_text": response_text,
                }

                # Persist result
                async with aiosqlite.connect(db_path) as db:
                    await db.execute(
                        """INSERT INTO benchmark_results
                           (run_id, model_id, model_name, backend_kind, prompt_id, prompt_text, rep, metrics_json, response_text)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            run_id,
                            model_id,
                            model.name,
                            model.kind,
                            prompt["id"],
                            prompt["text"],
                            rep,
                            json.dumps(result_dict),
                            response_text,
                        ),
                    )
                    await db.commit()

    # Compute summary
    best_tps = max(all_tps) if all_tps else None
    summary = {
        "model_ids": config.model_ids,
        "prompt_count": len(prompts),
        "total_reps": step,
        "best_tps": best_tps,
    }

    async with aiosqlite.connect(db_path) as db:
        await db.execute(
            "UPDATE benchmark_runs SET summary_json = ? WHERE id = ?",
            (json.dumps(summary), run_id),
        )
        await db.commit()

    yield {"event": "done", "run_id": run_id, "summary": summary}
    import webhooks as wh
    asyncio.create_task(wh.fire("benchmark.done", {"run_id": run_id, "summary": summary}))
