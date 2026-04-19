import asyncio
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from config import load_config
from db.database import init_db
from model_params import get_params
from registry import ModelRegistry
from routers import (
    admin,
    agents,
    api_keys,
    arena,
    backup,
    badges,
    batch_inference,
    bench_presets,
    bench_scheduler,
    benchmark,
    chat,
    chat_history,
    chat_reactions,
    chat_templates,
    cost,
    cron,
    dashboard,
    dflash,
    dflash_bench,
    diff,
    downloads,
    export,
    global_search,
    groups,
    health,
    heatmap,
    finetune,
    humaneval,
    metrics_ws,
    model_changelog,
    model_leaderboard,
    model_size,
    models,
    notes,
    notifications,
    optimizer,
    outputs,
    mem_plan,
    params,
    perf_trends,
    perplexity,
    plugins,
    profiler_api,
    proxy,
    rag,
    recommender_api,
    response_cache,
    rss,
    schedules,
    settings,
    smart_router_api,
    status,
    structured_output,
    telemetry as telemetry_router,
    system_prompts,
    templates,
    token_analytics,
    token_counter,
    uptime,
    webhooks,
    webhook_templates,
    hf_updates as hf_updates_router,
    zlab as zlab_router,
)
from scheduler import run_scheduler

log = logging.getLogger(__name__)

# Tracks last chat/load activity time for TTL enforcement
_last_activity: float = time.monotonic()


def record_activity() -> None:
    global _last_activity
    _last_activity = time.monotonic()


async def _ttl_watcher(app: FastAPI) -> None:
    """Background task: auto-unload the active model when its TTL expires."""
    while True:
        await asyncio.sleep(30)
        adapter = app.state.active_adapter
        if not adapter or not adapter.is_loaded():
            continue
        model_id = adapter.model_id
        if not model_id:
            continue
        p = get_params(model_id)
        ttl = p.get("ttl_minutes")
        if not ttl or ttl <= 0:
            continue
        idle_seconds = time.monotonic() - _last_activity
        if idle_seconds >= ttl * 60:
            log.info(
                "TTL expired for %s (idle %.0fs) — unloading", model_id, idle_seconds
            )
            try:
                await adapter.stop()
            except Exception as e:
                log.warning("TTL stop failed: %s", e)
            app.state.active_adapter = None
            from clients import sync_opencode

            sync_opencode(None)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    app.state.config = load_config()

    # Clear any orphaned subprocess ports before starting
    from adapters.port_utils import kill_port

    cfg = app.state.config
    for port in {cfg.mlx_port, cfg.llama_port, cfg.llama_compare_port}:
        await kill_port(port)

    await init_db()
    from hf_downloader import download_manager
    download_manager.load_persisted()
    resumed = download_manager.resume_interrupted()
    if resumed:
        log.info("Auto-resumed %d interrupted download(s)", resumed)
    app.state.registry = ModelRegistry(app.state.config)
    await app.state.registry.refresh()

    # Seed origin_repo from completed hf_downloader jobs, then kick off a
    # non-blocking upstream check for all tracked models.
    import hf_updates
    hf_updates.seed_from_downloads(download_manager.list_jobs())
    async def _initial_update_check():
        try:
            # One-shot backfill for "Model update available" notifs that pre-
            # date the structured meta field — so the Update button renders
            # on entries pushed before today's refactor.
            from routers.hf_updates import _backfill_update_meta
            try:
                filled = _backfill_update_meta(app.state.registry)
                if filled:
                    log.info("backfilled %d legacy update notifications with meta", filled)
            except Exception as e:
                log.warning("update meta backfill failed: %s", e)

            ids = [m.id for m in app.state.registry.all() if m.node == "local"]
            newly = await hf_updates.check_models(ids)
            if newly:
                from routers import notifications as notif
                for mid, info in newly.items():
                    m = app.state.registry.get(mid)
                    name = m.name if m else mid
                    notif.push(
                        title="Model update available",
                        message=f"{name} has a new version on {info['origin_repo']}",
                        type="info",
                        link="/models",
                        meta={"kind": "model_update",
                              "model_id": mid,
                              "model_kind": (m.kind if m else "mlx"),
                              "repo_id": info["origin_repo"]},
                    )
        except Exception as e:
            log.warning("initial hf update check failed: %s", e)
    asyncio.create_task(_initial_update_check())

    app.state.active_adapter = None
    app.state.compare_adapter = None
    app.state.record_activity = record_activity

    ttl_task = asyncio.create_task(_ttl_watcher(app))
    scheduler_task = asyncio.create_task(run_scheduler(app))
    yield
    # Shutdown
    ttl_task.cancel()
    scheduler_task.cancel()
    if app.state.active_adapter:
        await app.state.active_adapter.stop()
    if app.state.compare_adapter:
        await app.state.compare_adapter.stop()


app = FastAPI(title="Crucible", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # LAN serving — tightened via auth middleware if api_key set
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """Enforce API key if configured. Always allow localhost."""
    api_key = app.state.config.api_key if hasattr(app.state, "config") else ""
    if api_key:
        client_host = request.client.host if request.client else "127.0.0.1"
        is_local = client_host in ("127.0.0.1", "::1", "localhost")
        if not is_local:
            provided = (
                request.headers.get("X-API-Key")
                or request.headers.get("Authorization", "").removeprefix("Bearer ")
            ).strip()
            if provided != api_key:
                return Response("Unauthorized", status_code=401)
    return await call_next(request)


app.include_router(proxy.router)  # OpenAI-compatible proxy at /v1/*
app.include_router(admin.router, prefix="/api")
app.include_router(agents.router, prefix="/api")
app.include_router(downloads.router, prefix="/api")
app.include_router(notes.router, prefix="/api")
app.include_router(schedules.router, prefix="/api")
app.include_router(models.router, prefix="/api")
app.include_router(params.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(chat_history.router, prefix="/api")
app.include_router(benchmark.router, prefix="/api")
app.include_router(humaneval.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(status.router, prefix="/api")
app.include_router(arena.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(smart_router_api.router, prefix="/api")
app.include_router(profiler_api.router, prefix="/api")
app.include_router(recommender_api.router, prefix="/api")
app.include_router(dflash.router, prefix="/api")
app.include_router(dflash_bench.router, prefix="/api")
app.include_router(cost.router, prefix="/api")
app.include_router(diff.router, prefix="/api")
app.include_router(export.router, prefix="/api")
app.include_router(groups.router, prefix="/api")
app.include_router(heatmap.router, prefix="/api")
app.include_router(optimizer.router, prefix="/api")
app.include_router(outputs.router, prefix="/api")
app.include_router(mem_plan.router, prefix="/api")
app.include_router(telemetry_router.router, prefix="/api")
app.include_router(webhooks.router, prefix="/api")
app.include_router(webhook_templates.router, prefix="/api")
app.include_router(templates.router, prefix="/api")
app.include_router(finetune.router, prefix="/api")
app.include_router(rag.router, prefix="/api")
app.include_router(api_keys.router, prefix="/api")
app.include_router(backup.router, prefix="/api")
app.include_router(badges.router, prefix="/api")
app.include_router(batch_inference.router, prefix="/api")
app.include_router(bench_presets.router, prefix="/api")
app.include_router(bench_scheduler.router, prefix="/api")
app.include_router(chat_reactions.router, prefix="/api")
app.include_router(chat_templates.router, prefix="/api")
app.include_router(cron.router, prefix="/api")
app.include_router(global_search.router, prefix="/api")
app.include_router(health.router, prefix="/api")
app.include_router(model_changelog.router, prefix="/api")
app.include_router(model_leaderboard.router, prefix="/api")
app.include_router(model_size.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")
app.include_router(perf_trends.router, prefix="/api")
app.include_router(perplexity.router, prefix="/api")
app.include_router(plugins.router, prefix="/api")
app.include_router(response_cache.router, prefix="/api")
app.include_router(rss.router, prefix="/api")
app.include_router(structured_output.router, prefix="/api")
app.include_router(system_prompts.router, prefix="/api")
app.include_router(token_analytics.router, prefix="/api")
app.include_router(token_counter.router, prefix="/api")
app.include_router(uptime.router, prefix="/api")
app.include_router(zlab_router.router, prefix="/api")
app.include_router(hf_updates_router.router, prefix="/api")
app.include_router(metrics_ws.router)


@app.get("/")
async def root():
    return {"app": "Crucible", "version": "0.2.0"}
