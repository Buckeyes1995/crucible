"""Crucible Store — marketplace-style install flow for catalog entries.

Per-kind install endpoints let the /store page install a catalog entry with
a single click. Models route through the existing hf_downloader (we just
translate the catalog's repo_id + kind into a StartDownloadRequest).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

import store
import mcps
import prompt_templates
import workflows_store as _wf  # shim module defined below

router = APIRouter()


# ── Catalog ────────────────────────────────────────────────────────────────

@router.get("/store/catalog")
async def get_catalog() -> dict[str, Any]:
    return await store.get_catalog()


@router.post("/store/refresh")
async def refresh_catalog() -> dict[str, Any]:
    return await store.get_catalog(force=True)


@router.get("/store/installed")
async def list_installed(request: Request) -> dict[str, list[str]]:
    """IDs (catalog.id, not content id) of entries the user already installed.
    The frontend uses this to toggle Install buttons into Installed state.
    Only tracked for things we can cleanly dedupe: MCPs by catalog id,
    prompts/workflows/system_prompts by name match against the installed list.
    Models are checked separately via the registry."""
    catalog = await store.get_catalog()
    installed: dict[str, list[str]] = {
        "mcps": [e["id"] for e in mcps.list_installed()],
        "prompts": [],
        "workflows": [],
        "system_prompts": [],
        "models": [],
    }

    # Prompts — match by name (prompt_templates has no catalog id concept)
    existing_prompt_names = {p.get("name") for p in prompt_templates.list_templates()}
    for entry in catalog.get("prompts", []):
        if entry.get("name") in existing_prompt_names:
            installed["prompts"].append(entry["id"])

    # Workflows — match by name
    existing_wf_names = {w.get("name") for w in _wf.list_workflows()}
    for entry in catalog.get("workflows", []):
        if entry.get("name") in existing_wf_names:
            installed["workflows"].append(entry["id"])

    # System prompts — match by name
    from routers import system_prompts as sp
    existing_sp_names = {p.get("name") for p in sp._load()}
    for entry in catalog.get("system_prompts", []):
        if entry.get("name") in existing_sp_names:
            installed["system_prompts"].append(entry["id"])

    # Models — installed = registry has a model whose path basename matches
    # the catalog repo_id basename. Best-effort dedupe.
    registry = getattr(request.app.state, "registry", None)
    if registry is not None:
        installed_names = {m.name for m in registry.all()}
        for entry in catalog.get("models", []):
            repo_basename = (entry.get("repo_id") or "").split("/")[-1]
            if repo_basename in installed_names:
                installed["models"].append(entry["id"])

    return installed


# ── Install: prompts ───────────────────────────────────────────────────────

class InstallIdRequest(BaseModel):
    id: str  # catalog entry id


@router.post("/store/install/prompt")
async def install_prompt(body: InstallIdRequest) -> dict[str, Any]:
    catalog = await store.get_catalog()
    entry = store.find_entry(catalog, "prompts", body.id)
    if not entry:
        raise HTTPException(404, f"prompt not in catalog: {body.id}")
    template = prompt_templates.add_template(
        name=entry["name"],
        content=entry.get("content", ""),
        description=entry.get("description", ""),
    )
    return {"status": "installed", "template": template}


# ── Install: workflows ─────────────────────────────────────────────────────

@router.post("/store/install/workflow")
async def install_workflow(body: InstallIdRequest) -> dict[str, Any]:
    catalog = await store.get_catalog()
    entry = store.find_entry(catalog, "workflows", body.id)
    if not entry:
        raise HTTPException(404, f"workflow not in catalog: {body.id}")
    wf = _wf.add_workflow(
        name=entry["name"],
        agent=entry.get("agent", "hermes"),
        template=entry.get("template", ""),
        description=entry.get("description", ""),
        skills=entry.get("skills", []),
        max_turns=int(entry.get("max_turns", 30)),
    )
    return {"status": "installed", "workflow": wf}


# ── Install: system prompts ────────────────────────────────────────────────

@router.post("/store/install/system-prompt")
async def install_system_prompt(body: InstallIdRequest) -> dict[str, Any]:
    from routers import system_prompts as sp
    catalog = await store.get_catalog()
    entry = store.find_entry(catalog, "system_prompts", body.id)
    if not entry:
        raise HTTPException(404, f"system prompt not in catalog: {body.id}")
    custom = [p for p in sp._load() if not p.get("builtin")]
    import uuid as _uuid
    new_p = {
        "id": str(_uuid.uuid4()),
        "name": entry["name"],
        "category": entry.get("category", "custom"),
        "content": entry.get("content", ""),
        "builtin": False,
    }
    custom.append(new_p)
    sp._save(custom)
    return {"status": "installed", "system_prompt": new_p}


# ── Install: MCPs ──────────────────────────────────────────────────────────

class InstallMcpRequest(BaseModel):
    id: str
    # Per-param values the user filled in (e.g. {"github_token": "ghp_..."})
    values: dict[str, str] = {}


@router.post("/store/install/mcp")
async def install_mcp(body: InstallMcpRequest) -> dict[str, Any]:
    catalog = await store.get_catalog()
    entry = store.find_entry(catalog, "mcps", body.id)
    if not entry:
        raise HTTPException(404, f"mcp not in catalog: {body.id}")

    # Validate required params are present.
    for p in entry.get("config_params", []):
        if p.get("required") and not body.values.get(p["name"]):
            raise HTTPException(400, f"missing required param: {p['name']}")

    rendered_args = mcps.render_args(entry.get("args", []), body.values)
    rendered_env = mcps.render_env(entry.get("env", {}), body.values)
    installed = mcps.install(
        mcp_id=entry["id"],
        name=entry["name"],
        command=entry.get("command", ""),
        args=rendered_args,
        env=rendered_env,
    )
    return {"status": "installed", "mcp": installed}


@router.delete("/store/install/mcp/{mcp_id:path}")
async def uninstall_mcp(mcp_id: str) -> dict[str, str]:
    if not mcps.uninstall(mcp_id):
        raise HTTPException(404, "mcp not installed")
    return {"status": "uninstalled"}


@router.get("/store/mcps/installed")
async def mcps_installed() -> list[dict]:
    return mcps.list_installed()


# ── Install: models ────────────────────────────────────────────────────────

class InstallModelRequest(BaseModel):
    id: str


@router.post("/store/install/model")
async def install_model(body: InstallModelRequest, request: Request) -> dict[str, Any]:
    """Route through the existing hf_downloader. Returns a download job id
    the frontend can poll for progress — same contract as /hf/download."""
    catalog = await store.get_catalog()
    entry = store.find_entry(catalog, "models", body.id)
    if not entry:
        raise HTTPException(404, f"model not in catalog: {body.id}")

    from hf_downloader import download_manager
    cfg = request.app.state.config
    kind = entry.get("kind", "mlx")
    dest = cfg.mlx_dir if kind == "mlx" else cfg.gguf_dir
    job_id = download_manager.start_download(
        repo_id=entry["repo_id"],
        dest_dir=dest,
        kind=kind,
    )
    return {"status": "downloading", "job_id": job_id, "repo_id": entry["repo_id"]}
