# Forge Architecture

## Backend Structure

```
backend/
  main.py                   uvicorn entry point, mounts all routers
  config.py                 load/save ~/.config/forge/config.json
  db/
    schema.sql              SQLite schema
    connection.py           aiosqlite pool helper
    benchmark.py            benchmark CRUD
  adapters/
    base.py                 AbstractAdapter protocol
    llama_cpp.py            llama-server subprocess adapter
    mlx_lm.py               mlx_lm.server subprocess adapter
    omlx.py                 oMLX HTTP adapter (managed via launchd)
    vllm.py                 vllm serve subprocess adapter (vllm-metal)
    ollama.py               Ollama HTTP adapter
    external.py             generic OpenAI-compat external server
    remote_node.py          proxy to another Crucible instance
  zlab.py                   z-lab HF org tracker (DFlash drafts)
  hf_updates.py             per-model origin repo + upstream update watcher
  model_notes.py            notes/tags/hidden/preferred_engine store
  registry.py               unified model scan (scan_mlx / scan_vllm / scan_gguf / scan_ollama / scan_remote_node)
  benchmark/
    engine.py               orchestrates runs, collects metrics
    metrics.py              macOS memory/thermal sampling
    prompts.py              built-in prompt library
  routers/
    models.py               /api/models routes
    chat.py                 /api/chat SSE
    benchmark.py            /api/benchmark routes
    settings.py             /api/settings routes
    status.py               /api/status route
  requirements.txt
```

## Frontend Structure

```
frontend/
  app/
    layout.tsx              root layout (sidebar + topbar)
    page.tsx                redirect to /models
    models/
      page.tsx              model registry grid
    benchmark/
      new/page.tsx          benchmark run wizard
      history/page.tsx      history list
      run/[id]/page.tsx     results view with charts
    chat/
      page.tsx              chat interface
    settings/
      page.tsx              settings form
  components/
    sidebar.tsx             collapsible left nav
    model-card.tsx          model registry card
    status-dot.tsx          pulsing status indicator
    benchmark/
      run-config.tsx        wizard steps
      results-charts.tsx    recharts panels
      metrics-table.tsx     sortable table
      history-list.tsx      run history
    chat/
      message-list.tsx      conversation view
      input-bar.tsx         prompt input + controls
      stats-bar.tsx         live TTFT + tok/s
  lib/
    api.ts                  typed fetch wrappers for all endpoints
    sse.ts                  SSE client helper
    stores/
      models.ts             Zustand model registry store
      benchmark.ts          active run + history store
      chat.ts               conversation store
      settings.ts           config store
  public/
  package.json
  tailwind.config.ts
  tsconfig.json
```

## Adapter Protocol

Each backend adapter implements:

```python
class AbstractAdapter:
    async def scan(self) -> list[ModelEntry]: ...
    async def load(self, model: ModelEntry) -> AsyncGenerator[LoadEvent, None]: ...
    async def stop(self) -> None: ...
    async def is_healthy(self) -> bool: ...
    async def chat(self, request: ChatRequest) -> AsyncGenerator[ChatEvent, None]: ...
    async def benchmark_single(self, request: BenchmarkRequest) -> BenchmarkResult: ...
```

## Data Flow — Benchmark Run

```
POST /api/benchmark/run
  → BenchmarkEngine.run(config)
    → for each (model, prompt, rep):
        → adapter.load(model)   [if not already loaded]
        → adapter.benchmark_single(prompt, params)
          → records token timestamps for p50/p90/p99
          → samples memory/thermal at start + peak
        → yield SSE result event
        → db.save_result(run_id, result)
    → db.save_run_summary(run_id)
    → yield SSE done event
```

## SSE Pattern

Backend uses FastAPI `StreamingResponse` with `text/event-stream`.
Frontend uses a custom `useSSE(url, onEvent)` hook in `lib/sse.ts` that:
1. Opens `EventSource` or `fetch` with `ReadableStream`
2. Parses `data:` lines
3. Calls typed event handlers
4. Cleans up on unmount

## Threading Model

- FastAPI runs on uvicorn with asyncio event loop
- Subprocess adapters (llama-server, mlx-lm) spawn via `asyncio.create_subprocess_exec`
- Subprocess stdout/stderr tailed asynchronously for health detection
- macOS `vm_stat` and thermal polled via `asyncio.create_subprocess_shell`
- SQLite accessed via `aiosqlite` — never blocks the event loop
- One active model at a time — enforced by a global `_active_adapter` lock
