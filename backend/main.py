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
    arena,
    benchmark,
    chat,
    dflash,
    dflash_bench,
    downloads,
    finetune,
    humaneval,
    metrics_ws,
    models,
    notes,
    params,
    proxy,
    rag,
    schedules,
    settings,
    status,
    templates,
    webhooks,
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
    app.state.registry = ModelRegistry(app.state.config)
    await app.state.registry.refresh()
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
app.include_router(downloads.router, prefix="/api")
app.include_router(notes.router, prefix="/api")
app.include_router(schedules.router, prefix="/api")
app.include_router(models.router, prefix="/api")
app.include_router(params.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(benchmark.router, prefix="/api")
app.include_router(humaneval.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(status.router, prefix="/api")
app.include_router(arena.router, prefix="/api")
app.include_router(dflash.router, prefix="/api")
app.include_router(dflash_bench.router, prefix="/api")
app.include_router(webhooks.router, prefix="/api")
app.include_router(templates.router, prefix="/api")
app.include_router(finetune.router, prefix="/api")
app.include_router(rag.router, prefix="/api")
app.include_router(metrics_ws.router)


@app.get("/")
async def root():
    return {"app": "Crucible", "version": "0.2.0"}
