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
import logging
import time
from pathlib import Path

log = logging.getLogger(__name__)
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from omlx_admin import OMLXAdminClient
import zlab
from hf_downloader import download_manager

router = APIRouter()

PROMPT_PRESETS: dict[str, dict] = {
    "quick": {
        "label": "Quick",
        "description": "3 short prompts for a fast sanity check",
        "max_tokens": 256,
        "prompts": [
            "Explain the concept of gradient descent in machine learning.",
            "Write a Python function to find the longest common subsequence of two strings.",
            "What are the key differences between TCP and UDP? Give examples of when to use each.",
        ],
    },
    "agentic_coding": {
        "label": "Agentic Coding",
        "description": "Tasks that mimic real coding-agent workloads — refactors, debugging, tool use, long outputs. DFlash typically shines here.",
        "max_tokens": 1024,
        "prompts": [
            "You are a coding agent. Implement a rate-limited async HTTP client in Python with exponential backoff, connection pooling, and typed response parsing. Include full type hints, docstrings, and a small usage example.",
            "Given this buggy Python function, identify and fix the bugs. Explain each fix before showing the corrected code:\n```python\ndef flatten(xs):\n    result = []\n    for x in xs:\n        if isinstance(x, list):\n            result.extend(flatten(x))\n        else:\n            result.append(x)\n    return result\n\ndef dedup(xs):\n    seen = set()\n    return [x for x in xs if x not in seen and (seen.add(x) or True)]\n\ndef chunks(xs, n):\n    for i in range(0, len(xs), n):\n        yield xs[i:i+n+1]\n```",
            "Refactor this React component to use hooks instead of a class, extract the fetch logic into a custom useUser hook, add proper loading/error states, and use AbortController for cancellation:\n```jsx\nclass UserProfile extends React.Component {\n  state = { user: null, loading: true };\n  componentDidMount() {\n    fetch(`/api/user/${this.props.id}`).then(r => r.json()).then(u => this.setState({user: u, loading: false}));\n  }\n  render() {\n    if (this.state.loading) return <div>Loading</div>;\n    return <div>{this.state.user.name}</div>;\n  }\n}\n```",
            "Write a complete TypeScript implementation of a binary search tree with insert, search, delete, in-order traversal, and a method to balance the tree. Include JSDoc comments and a usage example demonstrating all operations.",
            "Review this SQL query for a PostgreSQL 15 database, identify N+1 issues and missing indexes, then rewrite it for better performance. Explain each change:\n```sql\nSELECT u.name, (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) as order_count, (SELECT SUM(amount) FROM orders o WHERE o.user_id = u.id AND o.status = 'completed') as total_spent FROM users u WHERE u.created_at > '2024-01-01' ORDER BY total_spent DESC LIMIT 100;\n```",
        ],
    },
    "long_form": {
        "label": "Long-form Generation",
        "description": "Single longer prompts — DFlash gains more as output length grows",
        "max_tokens": 2048,
        "prompts": [
            "Write a detailed technical post-mortem for a hypothetical outage where a Redis cluster failover caused cascading failures in a payments microservice. Include timeline, root cause analysis, contributing factors, customer impact, and remediation items.",
            "Explain the architecture of a modern LLM inference server (prefill/decode separation, KV cache, paged attention, speculative decoding) in depth, with diagrams described in ASCII and concrete examples of how each optimization affects throughput and latency.",
        ],
    },
}


class DFlashBenchRequest(BaseModel):
    model_id: str
    max_tokens: int = 512
    temperature: float = 0.7
    prompts: list[str] | None = None
    preset: str | None = None  # "quick" | "agentic_coding" | "long_form" (overrides prompts/max_tokens)


@router.get("/dflash/presets")
async def list_presets() -> dict:
    """Return available prompt presets for the DFlash bench."""
    return {
        k: {"label": v["label"], "description": v["description"], "max_tokens": v["max_tokens"], "count": len(v["prompts"])}
        for k, v in PROMPT_PRESETS.items()
    }


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
            if resp.status_code != 200:
                body = await resp.aread()
                raise RuntimeError(f"HTTP {resp.status_code}: {body.decode('utf-8', errors='replace')[:300]}")
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
    if total_tokens == 0:
        raise RuntimeError("Chat completion returned 0 tokens — model may not be ready or prompt rejected")
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
    # Resolve prompts + max_tokens from preset if provided, else explicit body, else quick default
    if body.preset and body.preset in PROMPT_PRESETS:
        preset = PROMPT_PRESETS[body.preset]
        prompts = preset["prompts"]
        effective_max_tokens = preset["max_tokens"]
    else:
        prompts = body.prompts or PROMPT_PRESETS["quick"]["prompts"]
        effective_max_tokens = body.max_tokens
    omlx = OMLXAdminClient(base_url=base_url, api_key=cfg.omlx_api_key)

    async def _restore_previous(previously_loaded: list[str]):
        """Background task: reload models that were loaded before the bench. Run after the stream closes."""
        for mid in previously_loaded:
            if mid == omlx_model_name:
                continue  # bench already reloaded (or reset) the target
            try:
                await omlx.warmup(mid)
            except Exception as e:
                log.warning("Failed to restore %s: %s", mid, e)

    async def _stream():
        nonlocal model
        previously_loaded: list[str] = []

        try:
            yield _sse("start", model=model.name, prompts_count=len(prompts))

            # ── Pre-flight: refuse architectures known to crash dflash_mlx ───
            # Qwen3-Next uses Qwen3NextGatedDeltaNet attention. dflash_mlx's
            # speculative_call expects standard attributes (sharding_group,
            # in_proj_qkv) that this layer class doesn't have — oMLX crashes
            # on the DFlash-enabled reload. Fail fast with a clear message
            # instead of running Phase 1 for 2 minutes and crashing Phase 2.
            try:
                import json as _json
                cfg_path = Path(model.path) / "config.json" if model.path else None
                if cfg_path and cfg_path.exists():
                    arch_cfg = _json.loads(cfg_path.read_text())
                    mtype = arch_cfg.get("model_type", "")
                    if mtype == "qwen3_next":
                        yield _sse(
                            "error",
                            message=(
                                f"{model.name} uses the qwen3_next architecture (GatedDeltaNet attention), "
                                "which is not yet supported by dflash_mlx. The z-lab draft exists but oMLX "
                                "will crash on DFlash reload. Try Qwen3-Coder-30B-A3B or other standard-Qwen3 "
                                "models instead. (Upstream: bstnxbt/dflash-mlx needs GatedDeltaNet support.)"
                            ),
                        )
                        return
            except Exception as e:
                log.warning("DFlash compat precheck failed: %s", e)

            # ── Phase -1: Clear memory. Record what's loaded, unload all. ─
            yield _sse("stage", stage="clearing_memory", message="Recording currently loaded models…")
            previously_loaded = await omlx.list_loaded_models()
            if previously_loaded:
                yield _sse("stage", stage="clearing_memory", message=f"Unloading {len(previously_loaded)} model(s): {', '.join(previously_loaded)}")
                for mid in previously_loaded:
                    await omlx.unload(mid)
                await asyncio.sleep(2.0)

            # ── Phase 0: ensure we have a draft ─────────────────────────
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
                yield _sse("stage", stage="rescanning", message="Re-scanning model registry…")
                await registry.refresh()
                model = registry.get(body.model_id)
                if not model or not model.dflash_draft:
                    yield _sse("error", message="Draft downloaded but not linked to base model — registry rescan did not find a match.")
                    return
                yield _sse("stage", stage="draft_ready", message=f"Draft ready: {Path(model.dflash_draft).name}")

            results_normal: list[dict] = []
            results_dflash: list[dict] = []

            _last_reload_err = ""

            async def _reload_and_warmup(label: str) -> bool:
                nonlocal _last_reload_err
                await omlx.unload(omlx_model_name)
                await asyncio.sleep(0.5)
                w = await omlx.warmup(omlx_model_name)
                if w["ok"]:
                    return True
                err1 = w.get("error") or f"HTTP {w.get('status')}"
                await asyncio.sleep(3.0)
                w = await omlx.warmup(omlx_model_name)
                if w["ok"]:
                    return True
                err2 = w.get("error") or f"HTTP {w.get('status')}"
                _last_reload_err = f"{label}: first attempt: {err1[:200]}  |  retry: {err2[:200]}"
                return False

            # ── Phase 1: DFlash OFF ─────────────────────────────────────
            yield _sse("phase", phase="normal", message="Configuring DFlash=off…")
            r = await omlx.set_dflash(omlx_model_name, enabled=False)
            if not r["ok"]:
                yield _sse("error", message=f"Failed to disable DFlash: {r.get('error')}")
                return

            yield _sse("stage", stage="warming", message="Loading model for Normal phase…")
            w = await omlx.warmup(omlx_model_name)
            if not w["ok"]:
                yield _sse("error", message=f"Model warmup failed: {w.get('error')}")
                return

            for i, prompt in enumerate(prompts):
                yield _sse("progress", phase="normal", prompt_index=i)
                try:
                    m = await _run_one(omlx_model_name, prompt, base_url, cfg.omlx_api_key, body.temperature, effective_max_tokens)
                    results_normal.append(m)
                    yield _sse("result", phase="normal", prompt_index=i, **m)
                except Exception as e:
                    yield _sse("error", message=f"Normal run failed: {e}")
                    return

            # ── Phase 2: DFlash ON ──────────────────────────────────────
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

            status = await omlx.get_dflash_status(omlx_model_name)
            if not status.get("enabled"):
                yield _sse("error", message=f"DFlash toggle did not apply after reload (oMLX reports enabled={status.get('enabled')}). Aborting.")
                await omlx.set_dflash(omlx_model_name, enabled=False)
                return

            for i, prompt in enumerate(prompts):
                yield _sse("progress", phase="dflash", prompt_index=i)
                try:
                    m = await _run_one(omlx_model_name, prompt, base_url, cfg.omlx_api_key, body.temperature, effective_max_tokens)
                    results_dflash.append(m)
                    yield _sse("result", phase="dflash", prompt_index=i, **m)
                except Exception as e:
                    yield _sse("error", message=f"DFlash run failed: {e}")
                    return

            await omlx.set_dflash(omlx_model_name, enabled=False)

            # ── Summary ─────────────────────────────────────────────────
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
        finally:
            # Schedule cleanup as a background task so it survives stream cancellation.
            async def _cleanup():
                try:
                    await omlx.set_dflash(omlx_model_name, enabled=False)
                    await omlx.unload(omlx_model_name)
                except Exception as e:
                    log.warning("DFlash bench cleanup failed: %s", e)
                await _restore_previous(previously_loaded)
            asyncio.create_task(_cleanup())

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
