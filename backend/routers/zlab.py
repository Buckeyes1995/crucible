"""z-lab HuggingFace tracker — DFlash draft model availability."""
from fastapi import APIRouter, Request
from pydantic import BaseModel

import zlab
from hf_downloader import download_manager

router = APIRouter()


class DownloadDraftPayload(BaseModel):
    repo_id: str


@router.get("/zlab/drafts")
async def list_drafts() -> dict:
    """Return z-lab draft repos and cache metadata (uses cache; call refresh to re-fetch)."""
    repos = await zlab.fetch_repos(force=False)
    drafts = zlab._draft_repos(repos)
    return {
        "cache": zlab.cache_info(),
        "drafts": drafts,
        "all_repos": repos,
    }


@router.post("/zlab/drafts/refresh")
async def refresh_drafts(request: Request) -> dict:
    """Force-refetch z-lab repos and re-annotate available_draft_repo across models."""
    repos = await zlab.fetch_repos(force=True)
    # Touch the registry so next list_models() call sees fresh matches
    # (annotation runs per-request anyway, so nothing to do here besides returning).
    return {
        "cache": zlab.cache_info(),
        "draft_count": len(zlab._draft_repos(repos)),
    }


@router.post("/zlab/drafts/download")
async def download_draft(payload: DownloadDraftPayload, request: Request) -> dict:
    """Trigger a download of a z-lab draft into the MLX dir so find_dflash_draft picks it up."""
    config = request.app.state.config
    job_id = download_manager.start_download(
        repo_id=payload.repo_id,
        dest_dir=config.mlx_dir,
        kind="mlx",
    )
    return {"job_id": job_id, "repo_id": payload.repo_id}
