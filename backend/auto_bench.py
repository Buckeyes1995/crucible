"""Auto-benchmark — run a quick benchmark when a new model is downloaded."""

import asyncio
import json
import logging
import time
from pathlib import Path

from omlx_admin import find_dflash_draft

log = logging.getLogger(__name__)

RESULTS_FILE = Path.home() / ".config" / "crucible" / "auto_bench_results.json"

# Quick benchmark prompts (short, fast)
QUICK_PROMPTS = [
    "What is the capital of France?",
    "Write a Python function that reverses a string.",
    "Explain TCP in one paragraph.",
]


def _load_results() -> list[dict]:
    if RESULTS_FILE.exists():
        try:
            return json.loads(RESULTS_FILE.read_text())
        except Exception:
            pass
    return []


def _save_results(results: list[dict]):
    RESULTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    RESULTS_FILE.write_text(json.dumps(results, indent=2))


async def on_download_complete(job) -> None:
    """Called when an HF download finishes. Runs a quick benchmark."""
    if job.kind != "mlx":
        return  # Only auto-bench MLX models

    model_name = Path(job.dest_dir).name if job.dest_dir else Path(job.repo_id).name
    log.info("Auto-benchmark starting for newly downloaded: %s", model_name)

    # Wait a moment for the filesystem to settle
    await asyncio.sleep(2)

    # Check DFlash eligibility
    mlx_dir = str(Path(job.dest_dir).parent) if job.dest_dir else ""
    dflash_draft = find_dflash_draft(job.dest_dir, mlx_dir)

    # Run quick inference test via oMLX
    import httpx
    base_url = "http://127.0.0.1:8000"
    headers = {"Authorization": "Bearer 123456"}
    results = []

    for prompt in QUICK_PROMPTS:
        t0 = time.monotonic()
        first_token = None
        token_count = 0

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream("POST", f"{base_url}/v1/chat/completions",
                    json={"model": model_name, "messages": [{"role": "user", "content": prompt}],
                          "max_tokens": 256, "temperature": 0.7, "stream": True},
                    headers=headers) as resp:
                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        chunk = line[6:]
                        if chunk.strip() == "[DONE]":
                            break
                        try:
                            data = json.loads(chunk)
                            delta = data["choices"][0]["delta"]
                            if delta.get("content") or delta.get("reasoning"):
                                if first_token is None:
                                    first_token = time.monotonic()
                                token_count += 1
                        except Exception:
                            continue
        except Exception as e:
            log.warning("Auto-bench prompt failed for %s: %s", model_name, e)
            continue

        t1 = time.monotonic()
        ttft_ms = round((first_token - t0) * 1000, 2) if first_token else None
        gen_time = (t1 - first_token) if first_token else (t1 - t0)
        tps = round(token_count / gen_time, 2) if gen_time > 0 and token_count > 0 else None
        results.append({"tps": tps, "ttft_ms": ttft_ms, "tokens": token_count})

    # Compute summary
    tps_vals = [r["tps"] for r in results if r["tps"]]
    avg_tps = round(sum(tps_vals) / len(tps_vals), 2) if tps_vals else None

    entry = {
        "model_name": model_name,
        "repo_id": job.repo_id,
        "kind": job.kind,
        "timestamp": time.time(),
        "results": results,
        "avg_tps": avg_tps,
        "dflash_eligible": dflash_draft is not None,
        "dflash_draft": dflash_draft,
    }

    # Persist
    all_results = _load_results()
    all_results.insert(0, entry)
    all_results = all_results[:100]  # Keep last 100
    _save_results(all_results)

    log.info("Auto-benchmark complete for %s: avg %.1f tok/s, DFlash: %s",
             model_name, avg_tps or 0, "eligible" if dflash_draft else "no")

    # Fire webhook
    import webhooks as wh
    await wh.fire("benchmark.done", {
        "model_name": model_name,
        "avg_tps": avg_tps,
        "auto_bench": True,
        "dflash_eligible": dflash_draft is not None,
    })
