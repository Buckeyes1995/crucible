"""HuggingFace download endpoints."""
import asyncio
import json
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from hf_downloader import download_manager

router = APIRouter()

_DTYPE_BYTES = {
    "F32": 4, "F16": 2, "BF16": 2, "F64": 8,
    "I64": 8, "I32": 4, "I16": 2, "I8": 1,
    "U64": 8, "U32": 4, "U16": 2, "U8": 1, "BOOL": 1,
}


def _size_from_safetensors(m) -> int | None:
    sf = getattr(m, "safetensors", None)
    if sf and getattr(sf, "parameters", None):
        return sum(count * _DTYPE_BYTES.get(dt, 4) for dt, count in sf.parameters.items())
    return None


def _gguf_repo_size(repo_id: str) -> int | None:
    """Sum .gguf file sizes via list_repo_tree (blocking, run in executor)."""
    try:
        from huggingface_hub import list_repo_tree
        total = 0
        for item in list_repo_tree(repo_id, recursive=True):
            size = getattr(item, "size", None)
            path = getattr(item, "path", "")
            if size and path.endswith(".gguf"):
                total += size
        return total if total > 0 else None
    except Exception:
        return None


class StartDownloadRequest(BaseModel):
    repo_id: str
    kind: str = "mlx"  # "mlx" | "gguf"
    dest_dir: str | None = None  # defaults from config


def _model_to_dict(m) -> dict:
    size_bytes = _size_from_safetensors(m)
    return {
        "repo_id": m.id,
        "name": m.id.split("/")[-1],
        "author": getattr(m, "author", None) or "",
        "downloads": getattr(m, "downloads", 0) or 0,
        "likes": getattr(m, "likes", 0) or 0,
        "last_modified": str(getattr(m, "last_modified", "")),
        "tags": list(getattr(m, "tags", []) or [])[:10],
        "pipeline_tag": getattr(m, "pipeline_tag", "") or "",
        "size_bytes": size_bytes,
    }


@router.get("/hf/search")
async def search_models(q: str, limit: int = 20, request: Request = None) -> list[dict]:
    """Search HuggingFace for models matching query."""
    try:
        from huggingface_hub import HfApi
        hf = HfApi()
        loop = asyncio.get_event_loop()

        results: list[dict] = []
        seen_ids: set[str] = set()

        # If the query looks like an exact repo ID (contains /), try direct lookup first
        q_stripped = q.strip()
        if "/" in q_stripped:
            # Strip any trailing kind suffix (e.g. "JANGQ-AI/Model mlx" → "JANGQ-AI/Model")
            candidate = q_stripped.split()[0]
            if "/" in candidate:
                try:
                    info = await loop.run_in_executor(
                        None,
                        lambda: hf.model_info(candidate, expand=["downloads", "likes", "safetensors"]),
                    )
                    d = _model_to_dict(info)
                    results.append(d)
                    seen_ids.add(info.id)
                except Exception:
                    pass

        models = await loop.run_in_executor(
            None,
            lambda: list(hf.list_models(
                search=q,
                limit=limit,
                sort="downloads",
                expand=["downloads", "likes", "safetensors"],
            ))
        )

        gguf_indices: list[int] = []
        for m in models:
            if m.id in seen_ids:
                continue
            d = _model_to_dict(m)
            results.append(d)
            seen_ids.add(m.id)
            if d["size_bytes"] is None:
                gguf_indices.append(len(results) - 1)

        # Fetch GGUF sizes in parallel (cap at 10 to avoid hammering HF)
        if gguf_indices:
            async def _fetch_size(idx: int):
                repo_id = results[idx]["repo_id"]
                size = await loop.run_in_executor(None, _gguf_repo_size, repo_id)
                results[idx]["size_bytes"] = size

            await asyncio.gather(*[_fetch_size(i) for i in gguf_indices[:10]])

        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/hf/download")
async def start_download(body: StartDownloadRequest, request: Request) -> dict:
    config = request.app.state.config
    if not body.dest_dir:
        dest = config.mlx_dir if body.kind == "mlx" else config.gguf_dir
    else:
        dest = body.dest_dir

    job_id = download_manager.start_download(
        repo_id=body.repo_id,
        dest_dir=dest,
        kind=body.kind,
    )
    return {"job_id": job_id, "status": "queued"}


@router.get("/hf/downloads")
async def list_downloads() -> list[dict]:
    return download_manager.list_jobs()


@router.get("/hf/download/{job_id}")
async def get_download(job_id: str) -> dict:
    job = download_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return download_manager._job_dict(job)


@router.get("/hf/download/{job_id}/stream")
async def stream_download(job_id: str) -> StreamingResponse:
    async def _gen():
        async for evt in download_manager.stream_job(job_id):
            yield f"data: {json.dumps(evt)}\n\n"

    return StreamingResponse(_gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/hf/download/{job_id}/resume")
async def resume_download(job_id: str) -> dict:
    ok = download_manager.resume_job(job_id)
    if not ok:
        raise HTTPException(status_code=400, detail="Job not found or not resumable (must be cancelled or errored)")
    return {"job_id": job_id, "status": "queued"}


@router.get("/hf/partial")
async def list_partial(request: Request) -> list[dict]:
    """Scan model directories for partial/incomplete downloads."""
    config = request.app.state.config
    return download_manager.scan_partial(config.mlx_dir, config.gguf_dir)


@router.delete("/hf/download/{job_id}")
async def cancel_download(job_id: str) -> dict:
    ok = download_manager.cancel_job(job_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Job not found or already done")
    return {"status": "cancelled"}
