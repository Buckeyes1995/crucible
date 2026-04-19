# Crucible Architecture

## Backend structure

```
backend/
  main.py                       uvicorn entry point; mounts all routers
  config.py                     load/save ~/.config/crucible/config.json
  session_persist.py            fcntl-locked "clean shutdown" marker (recovery)
  launchd_start.sh              production entry via launchd (run.sh delegates)

  db/                           SQLite schema + aiosqlite helpers
    schema.sql
    connection.py
    benchmark.py

  adapters/                     one per inference backend
    base.py                     AbstractAdapter protocol
    llama_cpp.py                llama-server subprocess
    mlx_lm.py                   mlx_lm.server subprocess
    omlx.py                     oMLX (HTTP + admin API, managed via launchd)
    vllm.py                     vllm serve subprocess (vLLM metal fork)
    ollama.py                   Ollama daemon HTTP API
    external.py                 generic OpenAI-compat external server
    remote_node.py              proxy to another Crucible instance
    mlx_studio.py               MLX Studio external HTTP

  registry.py                   scan_mlx / scan_vllm / scan_gguf / scan_ollama /
                                scan_remote_node + model_stats.json persistence
  model_notes.py                notes / tags / hidden / preferred_engine store
  model_params.py               per-model + global default sampling params

  benchmark/                    bench engine, metrics, prompt library
    engine.py
    metrics.py                  macOS vm_stat + thermal sampling
    prompts.py
  auto_bench.py                 post-download 3-prompt auto-bench

  arena.py                      live A/B battle state + ELO persistence
  arena_autobattle.py           overnight batch queue + pending vote store

  eval_suite.py                 structured multi-category scorer
  niah.py                       needle-in-a-haystack runner
  finetune.py                   LoRA training scaffolder

  hf_downloader.py              HuggingFace download manager with auto-resume
  hf_updates.py                 per-model origin repo + upstream lastModified watcher
  zlab.py                       z-lab DFlash draft tracker (6h cache)

  omlx_admin.py                 oMLX admin API client (DFlash toggle + settings)
  smart_router.py               prompt-pattern → model routing rules
  recommender.py                data-driven model ranking (joins arena + bench + chat)
  profiler.py                   per-request ttft/tps/token-delta capture
  rag.py                        chunk + retrieve helper for chat sessions
  powermetrics.py               wraps `powermetrics` for wattage (best-effort)
  scheduler.py                  cron + power-aware gating for scheduled switches
  webhooks.py                   outbound notifications

  prompt_templates.py           shared template store (chat/arena/diff/visualizer)

  routers/                      FastAPI routers — one file per feature area
    arena.py                    battle + autobattle + review endpoints
    benchmark.py                run + history
    chat.py, chat_history.py, chat_reactions.py, chat_templates.py
    curator.py                  ShareGPT export from chat history
    finetune.py, finetune_pipeline.py
    batch_pipeline.py           one-off prompt pipeline + CSV export
    ensemble.py                 multi-model fan-out + judge rerank
    eval_suite_api.py, niah_api.py, humaneval.py
    dflash.py, dflash_bench.py
    diff.py
    disk.py                     per-model usage + bulk reclaim
    downloads.py                HF search + start + SSE progress
    hf_updates.py
    logprobs.py                 per-token logprobs + alt-distribution
    mem_plan.py                 memory planner
    models.py                   model CRUD + load/stop
    notes.py, params.py
    notifications.py
    optimizer.py                sampling-param exploration
    outputs.py                  saved code block management
    profiler_api.py
    proxy.py                    /v1 OpenAI-compat proxy
    recommender_api.py, recommender_v2.py
    recovery.py
    router_replay.py
    schedules.py, bench_scheduler.py, bench_presets.py
    settings.py, status.py
    smart_router_api.py
    system_prompts.py, templates.py
    telemetry.py, metrics_ws.py  WebSocket /ws/metrics for sidebar
    warmth.py
    workflows.py                parameterized hermes macros
    zlab.py
    …plus smaller feature routers (backup, badges, cost, plugins, etc.)

  tests/
    test_model_parse.py         pinned parser behavior
    test_openai_compat.py       OpenAI SDK drop-in smoke test
```

## Frontend structure

```
frontend/
  app/                          Next.js 16 App Router
    layout.tsx                  root layout (sidebar + topbar + PWA manifest)
    page.tsx                    redirect to /models
    models/                     registry grid + per-model dialogs
    chat/                       streaming chat + history
    benchmark2/                 live dashboard (replaces legacy /benchmark/new)
    benchmark/                  legacy — history + run detail still live here
    humaneval/, profiler/, heatmap/, leaderboard-models/
    arena/                      live battle
    arena/review/               pending-vote queue for autobattle
    diff/                       side-by-side model diff
    dflash/                     DFlash benchmark
    router/                     smart router rules + replay validator
    recommender/                data-driven pick
    planner/                    memory planner
    disk/                       disk reclaim
    visualizer/                 per-token timing waterfall
    downloads/                  HF search + download UI
    notifications/              feed
    schedules/                  rule editor
    settings/                   config + LAN serving
    agents/                     agent integration (hermes, clients.py sync)
    finetune/, optimizer/, cost/, groups/, badges/, backup/
    metrics/                    WebSocket live charts
    batch-inference/, token-analytics/, health/, shortcuts/,
    command-palette/

  components/
    Sidebar.tsx                 collapsible nav w/ live CPU sparkline + wattage
    ui/                         shadcn primitives
    …feature-specific components

  lib/
    api.ts                      typed fetch wrappers
    sse.ts                      readSSE helper
    stores/                     Zustand stores (models, chat, benchmark, settings)
    utils.ts, cn.ts

  public/                       PWA icons + manifest
  next.config.ts                rewrites /api/* /v1/* /ws/* → backend:7777
```

## Adapter protocol

```python
class AbstractAdapter:
    async def scan(self) -> list[ModelEntry]: ...
    async def load(self, model: ModelEntry) -> AsyncGenerator[LoadEvent, None]: ...
    async def stop(self) -> None: ...
    async def is_healthy(self) -> bool: ...
    async def chat(self, request: ChatRequest) -> AsyncGenerator[ChatEvent, None]: ...
    async def benchmark_single(self, request: BenchmarkRequest) -> BenchmarkResult: ...
```

`kind="mlx"` resolves to either `omlx` or `mlx_lm` via `_resolve_engine` in
`routers/models.py`: per-load `?engine=` override > `preferred_engine` in
`model_notes` > first entry in `ENGINES_BY_KIND[kind]`.

## Data flow — benchmark run

```
POST /api/benchmark/run
  → BenchmarkEngine.run(config)
      for each (model, prompt, rep):
          adapter.load(model)            # if not resident
          adapter.benchmark_single(...)  # token timestamps → p50/p90/p99
                                         # vm_stat + thermal at start + peak
          yield SSE {event: result, ...}
          db.save_result(run_id, result)
      db.save_run_summary(run_id)
      yield SSE {event: done, ...}
```

## Data flow — arena battle (sequential slots)

```
POST /api/arena/battle/{id}/chat
  slot "a":
    yield slot_start
    async for chunk in arena.stream_to_omlx(model_a):
        while silent > 5s: yield heartbeat{phase: loading|generating}
        yield token / done
  POST /v1/models/{model_a}/unload   # free VRAM before next slot
  slot "b": (same pattern)
  yield complete
  finally: unload only touched models (avoids noisy 400s)
```

## SSE conventions

- All streams use `data: <json>\n\n`; the json object has an `event` field.
- Long silences are padded with `heartbeat` events so clients behind buffering
  proxies (Cloudflare tunnel) don't time out.
- First SSE event is always emitted before any blocking work (kill_port,
  subprocess wait) so Starlette doesn't cancel the generator if the client
  disconnects mid-setup.

## Recovery / crash detection

- `session_persist.mark_running()` at startup acquires an exclusive `fcntl.flock`
  on `~/.config/crucible/session.lock` AND writes `session.json`. A duplicate
  uvicorn that fails to bind port 7777 can't acquire the lock, so it can't
  clobber the session file.
- `session_persist.mark_clean_shutdown()` on SIGTERM sets `clean: true`.
- On next startup, if `clean == false` → dirty shutdown → expose via
  `/api/recovery` so the UI can offer one-click restore.

## Threading model

- FastAPI on uvicorn with asyncio event loop.
- Subprocess adapters spawn via `asyncio.create_subprocess_exec`; stdout/stderr
  tailed async for health detection.
- `vm_stat` / `powermetrics` polled via `asyncio.create_subprocess_shell`.
- SQLite via `aiosqlite` — no blocking calls on the loop.
- Single active model enforced by a global `_active_adapter` lock.
- WebSocket `/ws/metrics` broadcasts system samples at 1Hz to all subscribers.

## Config / data files

| Path | Purpose |
|---|---|
| `~/.config/crucible/config.json` | Main config |
| `~/.config/crucible/model_params.json` | Sampling params (global + per-model) |
| `~/.config/crucible/model_stats.json` | Persistent avg_tps per model |
| `~/.config/crucible/model_notes.json` | Notes / tags / hidden / preferred_engine |
| `~/.config/crucible/schedules.json` | Scheduled switching rules |
| `~/.config/crucible/prompt_templates.json` | Shared prompt library |
| `~/.config/crucible/zlab_drafts.json` | Cached z-lab repo list (6h TTL) |
| `~/.config/crucible/hf_updates.json` | Origin repo + upstream lastModified |
| `~/.config/crucible/session.json`/`.lock` | Crash recovery marker |
| `~/.config/crucible/crucible.db` | SQLite (benchmark, arena, chat, eval) |
| `~/.config/crucible/outputs/` | Saved generated-code blocks |

## Remote access

- Cloudflare tunnel `mac-studio` fronts `crucible.buckeyes1995.com` (frontend)
  and `crucible-api.buckeyes1995.com` (WebSocket).
- Protected by Cloudflare Access (OTP) — backend `api_key` must be empty.
- Frontend runs in production mode (`pnpm build && pnpm start`) — dev HMR
  WebSocket doesn't survive the tunnel.
- Tunneled SSE streams are padded to kick Cloudflare's buffer; downloads page
  polls instead of streaming.
