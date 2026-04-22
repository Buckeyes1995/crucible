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


@router.get("/store/rails")
async def get_rails(request: Request) -> dict[str, Any]:
    """Return the store homepage as a list of themed rails (shelves).
    Phase 1 shipped static rails; Phase 3 layers on personalized rails:
    - Fits your ⟨RAM⟩ GB (filtered by psutil-reported total memory)
    - Because you benchmarked ⟨model⟩ (same-family / shared-tag picks)
    - Recently updated (origin HF repo has a newer lastModified than
      our local downloaded_at)."""
    cat = await store.get_catalog()

    def _wrap(kind: str, items: list[dict]) -> list[dict]:
        out = []
        for it in items:
            out.append({
                "kind": kind,
                "id": it.get("id"),
                "name": it.get("name"),
                "description": it.get("description"),
                "tags": it.get("tags") or [],
                "featured": bool(it.get("featured")),
                # kind-specific extras — the frontend ignores what it doesn't use
                "repo_id": it.get("repo_id"),
                "size_gb": it.get("size_gb"),
                "agent": it.get("agent"),
                "runtime": it.get("runtime"),
                "content": it.get("content"),
                "template": it.get("template"),
                "config_params": it.get("config_params") or [],
                "command": it.get("command"),
                "args": it.get("args") or [],
                "repo": it.get("repo"),
            })
        return out

    models = _wrap("models", cat.get("models", []))
    prompts = _wrap("prompts", cat.get("prompts", []))
    workflows = _wrap("workflows", cat.get("workflows", []))
    system_prompts = _wrap("system_prompts", cat.get("system_prompts", []))
    mcps_ = _wrap("mcps", cat.get("mcps", []))

    featured_mixed = [x for x in (models + prompts + workflows + system_prompts + mcps_) if x["featured"]]

    def _tagged(items: list[dict], needle: str) -> list[dict]:
        n = needle.lower()
        return [x for x in items if any(n in (t or "").lower() for t in x.get("tags", []))]

    def _tier(lo: float, hi: float, items: list[dict]) -> list[dict]:
        return [x for x in items if x.get("size_gb") is not None and lo <= float(x["size_gb"]) < hi]

    rails: list[dict] = []
    if featured_mixed:
        rails.append({
            "id": "featured",
            "title": "Featured this week",
            "subtitle": "Hand-picked across models, prompts, workflows, and MCPs",
            "items": featured_mixed,
        })

    # ── Personalized rails (Phase 3) ──────────────────────────────────────
    # Fits your RAM: ≤ 75% of total unified memory so we leave headroom
    # for the rest of the stack. Total bytes via psutil; fail-quiet on
    # unexpected platforms.
    ram_gb: float | None = None
    try:
        import psutil
        ram_gb = psutil.virtual_memory().total / (1024 ** 3)
    except Exception:
        pass
    if ram_gb is not None:
        budget_gb = ram_gb * 0.75
        fits = [
            x for x in models
            if x.get("size_gb") is not None and float(x["size_gb"]) <= budget_gb
        ]
        if fits:
            rails.append({
                "id": "fits_your_ram",
                "title": f"Fits your {int(round(ram_gb))} GB",
                "subtitle": f"Models under {int(round(budget_gb))} GB — leave headroom for other apps",
                "items": fits,
            })

    # Because you benchmarked X: read benchmark_runs to find the
    # most-benchmarked model id, then recommend catalog models that share
    # at least one tag with it and aren't the anchor itself.
    try:
        import aiosqlite
        from db.database import DB_PATH
        anchor_id: str | None = None
        anchor_tags: set[str] = set()
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                "SELECT model_id, model_name, COUNT(DISTINCT run_id) as n "
                "FROM benchmark_results GROUP BY model_id "
                "ORDER BY n DESC LIMIT 1"
            ) as cur:
                row = await cur.fetchone()
                if row:
                    anchor_id = row[0]
        if anchor_id:
            for m in cat.get("models", []):
                candidate_repo = (m.get("repo_id") or "").lower()
                if anchor_id.lower().endswith(candidate_repo.split("/")[-1]) or \
                   candidate_repo.split("/")[-1] in anchor_id.lower():
                    anchor_tags = set((t or "").lower() for t in (m.get("tags") or []))
                    break
        if anchor_id and anchor_tags:
            picks = []
            for x in models:
                xid = x.get("id")
                if not xid:
                    continue
                # skip the anchor itself (match on repo_id suffix)
                xrepo = (x.get("repo_id") or "").lower()
                anchor_leaf = anchor_id.lower().rsplit("/", 1)[-1]
                if xrepo and xrepo.endswith(anchor_leaf):
                    continue
                xtags = set((t or "").lower() for t in (x.get("tags") or []))
                if xtags & anchor_tags:
                    picks.append(x)
            if picks:
                anchor_name = anchor_id.replace("mlx:", "").rsplit("/", 1)[-1]
                rails.append({
                    "id": "because_you_benchmarked",
                    "title": f"Because you benchmarked {anchor_name}",
                    "subtitle": "Catalog picks that share capability tags with your most-tested model",
                    "items": picks,
                })
    except Exception:
        pass

    # Recently updated: installed models whose origin HF repo has a newer
    # lastModified than our local downloaded_at.
    try:
        import hf_updates
        upd_state = hf_updates.all_state()
        flagged_ids = {mid for mid, e in upd_state.items() if e.get("update_available")}
        if flagged_ids:
            # Map local model id → matching catalog entry (by repo_id leaf)
            def _leaf(s: str) -> str:
                return (s or "").rsplit("/", 1)[-1].lower()
            updated_items: list[dict] = []
            for mid in flagged_ids:
                origin = upd_state[mid].get("origin_repo") or ""
                leaf = _leaf(origin)
                match = next(
                    (m for m in models if _leaf(m.get("repo_id") or m.get("id") or "") == leaf),
                    None,
                )
                if match:
                    updated_items.append(match)
                else:
                    # synthesize a minimal rail item from the tracked model id
                    updated_items.append({
                        "kind": "models", "id": mid, "name": mid.replace("mlx:", ""),
                        "description": f"New version on HuggingFace: {origin}",
                        "tags": [], "featured": False, "repo_id": origin,
                        "size_gb": None, "agent": None, "runtime": None,
                        "content": None, "template": None, "config_params": [],
                        "command": None, "args": [], "repo": f"https://huggingface.co/{origin}" if origin else None,
                    })
            if updated_items:
                rails.append({
                    "id": "recently_updated",
                    "title": "Upstream updates available",
                    "subtitle": "These HF repos have been updated since you downloaded",
                    "items": updated_items,
                })
    except Exception:
        pass

    small = _tier(0, 10, models)
    if small:
        rails.append({
            "id": "tier_small",
            "title": "Under 10 GB",
            "subtitle": "Fast to download, easy on memory",
            "items": small,
        })

    mid = _tier(10, 30, models)
    if mid:
        rails.append({
            "id": "tier_mid",
            "title": "10–30 GB",
            "subtitle": "Mid-size workhorses",
            "items": mid,
        })

    big = _tier(30, 1000, models)
    if big:
        rails.append({
            "id": "tier_large",
            "title": "30 GB and up",
            "subtitle": "Flagship models — plenty of headroom required",
            "items": big,
        })

    coding = _tagged(models, "code")
    if coding:
        rails.append({
            "id": "cat_coding",
            "title": "For coding",
            "subtitle": "Models tagged for code generation",
            "items": coding,
        })

    vision = _tagged(models, "vision")
    if vision:
        rails.append({
            "id": "cat_vision",
            "title": "Vision-capable",
            "subtitle": "Accept images alongside text",
            "items": vision,
        })

    if prompts:
        rails.append({
            "id": "prompts",
            "title": "Prompts",
            "subtitle": "Drop-in chat templates",
            "items": prompts,
        })

    if system_prompts:
        rails.append({
            "id": "system_prompts",
            "title": "System prompts",
            "subtitle": "Personas, roles, guardrails",
            "items": system_prompts,
        })

    if workflows:
        rails.append({
            "id": "workflows",
            "title": "Workflows",
            "subtitle": "Multi-step agent recipes",
            "items": workflows,
        })

    if mcps_:
        rails.append({
            "id": "mcps",
            "title": "MCP servers",
            "subtitle": "Tools and integrations via Model Context Protocol",
            "items": mcps_,
        })

    return {"rails": rails}


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
