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
import mcp_host
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


@router.get("/store/installed-detail")
async def installed_detail(request: Request) -> dict[str, Any]:
    """Full content of everything installed, grouped by kind — what the
    Installed tab renders. Unlike /installed, this includes items the user
    added manually outside the catalog (e.g. a locally-written prompt)."""
    from routers import system_prompts as sp

    # Prompts
    prompts = [
        {"id": p.get("id"), "name": p.get("name"), "description": p.get("description"),
         "content": p.get("content"), "created_at": p.get("created_at")}
        for p in prompt_templates.list_templates()
    ]

    # Workflows
    wfs = [
        {"id": w.get("id"), "name": w.get("name"), "description": w.get("description"),
         "agent": w.get("agent"), "template": w.get("template"),
         "skills": w.get("skills", []), "placeholders": w.get("placeholders", []),
         "run_count": w.get("run_count", 0), "created_at": w.get("created_at")}
        for w in _wf.list_workflows()
    ]

    # System prompts — custom only (built-ins are not user-owned)
    sys_prompts = [
        {"id": p.get("id"), "name": p.get("name"), "category": p.get("category"),
         "content": p.get("content")}
        for p in sp._load() if not p.get("builtin")
    ]

    # MCPs — everything in the registry (whether from catalog or not)
    installed_mcps = mcps.list_installed()

    # Models — from the live registry. Mark origin = "local" or "remote" and
    # include the path so the Installed tab can offer delete-from-disk.
    registry = getattr(request.app.state, "registry", None)
    models = []
    if registry is not None:
        for m in registry.all():
            if m.node == "local":
                models.append({
                    "id": m.id, "name": m.name, "kind": m.kind,
                    "path": m.path, "size_bytes": m.size_bytes,
                    "avg_tps": m.avg_tps, "last_loaded": m.last_loaded,
                })

    return {
        "prompts": prompts,
        "workflows": wfs,
        "system_prompts": sys_prompts,
        "mcps": installed_mcps,
        "models": models,
    }


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
        values=body.values,
    )
    return {"status": "installed", "mcp": installed}


@router.delete("/store/install/mcp/{mcp_id:path}")
async def uninstall_mcp(mcp_id: str) -> dict[str, str]:
    if not mcps.uninstall(mcp_id):
        raise HTTPException(404, "mcp not installed")
    return {"status": "uninstalled"}


@router.delete("/store/install/prompt/{template_id}")
async def uninstall_prompt(template_id: str) -> dict[str, str]:
    if not prompt_templates.delete_template(template_id):
        raise HTTPException(404, "prompt not found")
    return {"status": "uninstalled"}


@router.delete("/store/install/workflow/{wf_id}")
async def uninstall_workflow(wf_id: str) -> dict[str, str]:
    items = _wf._load()
    new = [w for w in items if w.get("id") != wf_id]
    if len(new) == len(items):
        raise HTTPException(404, "workflow not found")
    _wf._save(new)
    return {"status": "uninstalled"}


@router.delete("/store/install/system-prompt/{prompt_id}")
async def uninstall_system_prompt(prompt_id: str) -> dict[str, str]:
    from routers import system_prompts as sp
    custom = [p for p in sp._load() if not p.get("builtin")]
    new = [p for p in custom if p.get("id") != prompt_id]
    if len(new) == len(custom):
        raise HTTPException(404, "system prompt not found")
    sp._save(new)
    return {"status": "uninstalled"}


@router.get("/store/mcps/installed")
async def mcps_installed() -> list[dict]:
    return mcps.list_installed()


# ── MCP host: live subprocess per installed MCP ────────────────────────────

@router.get("/mcp/{mcp_id}/tools")
async def mcp_tools(mcp_id: str, force: bool = False) -> dict[str, Any]:
    try:
        tools = await mcp_host.list_tools(mcp_id, force=force)
    except mcp_host.MCPError as e:
        raise HTTPException(400, str(e))
    return {"tools": tools}


class McpCallRequest(BaseModel):
    tool: str
    arguments: dict[str, Any] = {}


@router.post("/mcp/{mcp_id}/call")
async def mcp_call(mcp_id: str, body: McpCallRequest) -> dict[str, Any]:
    try:
        result = await mcp_host.call_tool(mcp_id, body.tool, body.arguments)
    except mcp_host.MCPError as e:
        raise HTTPException(400, str(e))
    return {"result": result}


@router.post("/mcp/{mcp_id}/stop")
async def mcp_stop(mcp_id: str) -> dict[str, Any]:
    stopped = await mcp_host.stop(mcp_id)
    return {"stopped": stopped}


@router.get("/mcp/status")
async def mcp_status() -> list[dict]:
    return mcp_host.status()


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
