"""DFlash benchmark — compare tok/s with and without DFlash for eligible models.

Key correctness requirements (see git history — earlier version silently reported
bogus speedups):
- oMLX requires a model *reload* for DFlash toggle changes to take effect. The
  bench MUST unload + warmup between phases.
- If the model has no local DFlash draft but z-lab publishes a matching draft,
  auto-download it first.
- set_dflash returns {ok, reload_required, error} — any failure aborts.
"""

import asyncio
import json
import time
from pathlib import Path
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from omlx_admin import OMLXAdminClient
import zlab
from hf_downloader import download_manager

router = APIRouter()

BENCH_PROMPTS = [
    "Explain the concept of gradient descent in machine learning.",
    "Write a Python function to find the longest common subsequence of two strings.",
    "What are the key differences between TCP and UDP? Give examples of when to use each.",
]


class DFlashBenchRequest(BaseModel):
    model_id: str
    max_tokens: int = 512
    temperature: float = 0.7
    prompts: list[str] | None = None


def _sse(event: str, **data) -> str:
    return f"data: {json.dumps({'event': event, **data})}\n\n"


async def _run_one(
    model_name: str,
    prompt: str,
    base_url: str,
    api_key: str,
    temperature: float,
    max_tokens: int,
) -> dict:
    """Run a single chat completion and return timing metrics."""
    import httpx
    payload = {
        "model": model_name,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    t0 = time.monotonic()
    first_token_time = None
    total_tokens = 0

    async with httpx.AsyncClient(timeout=300.0) as client:
        async with client.stream("POST", f"{base_url}/v1/chat/completions", json=payload, headers=headers) as resp:
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                chunk = line[6:]
                if chunk.strip() == "[DONE]":
                    break
                try:
                    data = json.loads(chunk)
                    delta = data["choices"][0]["delta"]
                    content = delta.get("content") or delta.get("reasoning") or ""
                    if content:
                        if first_token_time is None:
                            first_token_time = time.monotonic()
                        total_tokens += 1
                except Exception:
                    continue

    t1 = time.monotonic()
    ttft_ms = round((first_token_time - t0) * 1000, 2) if first_token_time else None
    gen_time = (t1 - first_token_time) if first_token_time else (t1 - t0)
    tps = round(total_tokens / gen_time, 2) if gen_time > 0 and total_tokens > 0 else None

    return {
        "tps": tps,
        "ttft_ms": ttft_ms,
        "output_tokens": total_tokens,
        "total_ms": round((t1 - t0) * 1000, 1),
    }


async def _wait_for_download(job_id: str, timeout_s: float = 3600.0):
    """Poll the download manager until the job finishes. Yields progress SSE dicts."""
    t0 = time.monotonic()
    last_progress = -1.0
    while time.monotonic() - t0 < timeout_s:
        job = download_manager.get_job(job_id)
        if not job:
            yield {"event": "error", "message": f"Download job {job_id} disappeared"}
            return
        status = job.status
        progress = round(job.progress, 3)
        if progress != last_progress:
            yield {"event": "download_progress", "job_id": job_id, "progress": progress, "status": status, "message": job.message}
            last_progress = progress
        if status == "done":
            yield {"event": "download_done", "job_id": job_id, "local_dir": job.local_dir}
            return
        if status in ("error", "cancelled"):
            yield {"event": "error", "message": f"Download {status}: {job.error or job.message}"}
            return
        await asyncio.sleep(1.0)
    yield {"event": "error", "message": "Download timed out"}


@router.post("/dflash/benchmark")
async def run_dflash_benchmark(body: DFlashBenchRequest, request: Request) -> StreamingResponse:
    """Run benchmark with DFlash on vs off. Auto-downloads z-lab draft if missing."""
    registry = request.app.state.registry
    model = registry.get(body.model_id)
    if not model:
        raise HTTPException(404, "Model not found")

    cfg = request.app.state.config
    base_url = cfg.mlx_external_url or "http://127.0.0.1:8000"
    omlx_model_name = model.name
    prompts = body.prompts or BENCH_PROMPTS
    omlx = OMLXAdminClient(base_url=base_url, api_key=cfg.omlx_api_key)

    async def _stream():
        nonlocal model

        yield _sse("start", model=model.name, prompts_count=len(prompts))

        # ── Phase 0: ensure we have a draft ──────────────────────────────
        if not model.dflash_draft:
            yield _sse("stage", stage="resolving_draft", message="No local DFlash draft — checking z-lab…")
            repos = await zlab.fetch_repos(force=False)
            match = zlab.match_draft_for(model.name, repos)
            if not match:
                yield _sse("error", message=f"No DFlash draft available for {model.name} (not found on z-lab). Bench aborted.")
                return
            yield _sse("stage", stage="downloading_draft", message=f"Downloading {match} from HuggingFace…", repo_id=match)
            job_id = download_manager.start_download(repo_id=match, dest_dir=cfg.mlx_dir, kind="mlx")
            async for evt in _wait_for_download(job_id):
                yield _sse(evt.pop("event"), **evt)
                if evt.get("event") == "error":
                    return
            # Re-scan the registry and refetch our model so dflash_draft is populated
            yield _sse("stage", stage="rescanning", message="Re-scanning model registry…")
            await registry.refresh()
            model = registry.get(body.model_id)
            if not model or not model.dflash_draft:
                yield _sse("error", message="Draft downloaded but not linked to base model — registry rescan did not find a match.")
                return
            yield _sse("stage", stage="draft_ready", message=f"Draft ready: {Path(model.dflash_draft).name}")

        results_normal: list[dict] = []
        results_dflash: list[dict] = []

        async def _reload_and_warmup(label: str) -> bool:
            """Unload + warmup with one retry on transient failure. Yields via nonlocal events list; returns True on success."""
            # First attempt
            await omlx.unload(omlx_model_name)
            await asyncio.sleep(0.5)
            w = await omlx.warmup(omlx_model_name)
            if w["ok"]:
                return True
            # Retry once — oMLX "settle barrier" timeouts are often transient while memory frees
            err1 = w.get("error") or f"HTTP {w.get('status')}"
            await asyncio.sleep(3.0)
            w = await omlx.warmup(omlx_model_name)
            if w["ok"]:
                return True
            err2 = w.get("error") or f"HTTP {w.get('status')}"
            nonlocal _last_reload_err
            _last_reload_err = f"{label}: first attempt: {err1[:200]}  |  retry: {err2[:200]}"
            return False

        _last_reload_err = ""

        # ── Phase 1: DFlash OFF ──────────────────────────────────────────
        # Check current state — if already loaded with DFlash off, skip the reload
        initial_status = await omlx.get_dflash_status(omlx_model_name)
        need_reload_off = initial_status.get("enabled", False) is True

        yield _sse("phase", phase="normal", message="Configuring DFlash=off…")
        r = await omlx.set_dflash(omlx_model_name, enabled=False)
        if not r["ok"]:
            yield _sse("error", message=f"Failed to disable DFlash: {r.get('error')}")
            return

        if need_reload_off:
            yield _sse("stage", stage="reloading", message="Reloading model without DFlash…")
            if not await _reload_and_warmup("phase=normal"):
                yield _sse("error", message=f"Model warmup failed after DFlash=off reload — {_last_reload_err}")
                return
        else:
            yield _sse("stage", stage="warming", message="Model already DFlash-off; warming up…")
            w = await omlx.warmup(omlx_model_name)
            if not w["ok"]:
                yield _sse("error", message=f"Model warmup failed: {w.get('error')}")
                return

        for i, prompt in enumerate(prompts):
            yield _sse("progress", phase="normal", prompt_index=i)
            try:
                m = await _run_one(omlx_model_name, prompt, base_url, cfg.omlx_api_key, body.temperature, body.max_tokens)
                results_normal.append(m)
                yield _sse("result", phase="normal", prompt_index=i, **m)
            except Exception as e:
                yield _sse("error", message=f"Normal run failed: {e}")
                return

        # ── Phase 2: DFlash ON, reload, run ──────────────────────────────
        yield _sse("phase", phase="dflash", message="Configuring DFlash=on…", draft=Path(model.dflash_draft).name)
        r = await omlx.set_dflash(
            omlx_model_name,
            enabled=True,
            draft_model=model.dflash_draft,
            draft_quant_bits=4,
        )
        if not r["ok"]:
            yield _sse("error", message=f"Failed to enable DFlash: {r.get('error')}")
            return
        yield _sse("stage", stage="reloading", message="Reloading model with DFlash enabled…")
        if not await _reload_and_warmup("phase=dflash"):
            yield _sse("error", message=f"Model warmup failed after DFlash=on reload — {_last_reload_err}. Draft may be incompatible, or oMLX couldn't free enough memory.")
            await omlx.set_dflash(omlx_model_name, enabled=False)
            return

        # Verify DFlash actually took effect
        status = await omlx.get_dflash_status(omlx_model_name)
        if not status.get("enabled"):
            yield _sse("error", message=f"DFlash toggle did not apply after reload (oMLX reports enabled={status.get('enabled')}). Aborting.")
            await omlx.set_dflash(omlx_model_name, enabled=False)
            return

        for i, prompt in enumerate(prompts):
            yield _sse("progress", phase="dflash", prompt_index=i)
            try:
                m = await _run_one(omlx_model_name, prompt, base_url, cfg.omlx_api_key, body.temperature, body.max_tokens)
                results_dflash.append(m)
                yield _sse("result", phase="dflash", prompt_index=i, **m)
            except Exception as e:
                yield _sse("error", message=f"DFlash run failed: {e}")
                return

        # Reset DFlash off after bench
        await omlx.set_dflash(omlx_model_name, enabled=False)

        # ── Summary ─────────────────────────────────────────────────────
        def _avg(xs: list[float | None]) -> float:
            vs = [x for x in xs if x]
            return round(sum(vs) / len(vs), 2) if vs else 0.0

        avg_normal = _avg([r["tps"] for r in results_normal])
        avg_dflash = _avg([r["tps"] for r in results_dflash])
        avg_normal_ttft = _avg([r["ttft_ms"] for r in results_normal])
        avg_dflash_ttft = _avg([r["ttft_ms"] for r in results_dflash])
        speedup = round(avg_dflash / avg_normal, 2) if avg_normal > 0 else 0

        yield _sse(
            "done",
            model=model.name,
            prompts_count=len(prompts),
            normal={"avg_tps": avg_normal, "avg_ttft_ms": avg_normal_ttft, "results": results_normal},
            dflash={"avg_tps": avg_dflash, "avg_ttft_ms": avg_dflash_ttft, "results": results_dflash},
            speedup=speedup,
            draft_used=Path(model.dflash_draft).name,
        )

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
