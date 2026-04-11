# Crucible — Claude Code Context

## Project Overview

**Crucible** is a local LLM management and benchmarking web application.
- **Backend:** Python 3.13 + FastAPI (in `backend/`)
- **Frontend:** Next.js 15 + TypeScript + Tailwind v4 + shadcn/ui (in `frontend/`)
- **DB:** SQLite via `aiosqlite` — raw SQL, no ORM
- **Package managers:** `uv` for Python, `pnpm` for JS

## Directory Layout

```
forge/
  backend/            FastAPI app
    main.py           entry point (uvicorn)
    adapters/         one module per backend (llama_cpp.py, mlx_lm.py, ollama.py, external.py)
    models/           Pydantic schemas
    db/               SQLite helpers + migrations
    benchmark/        benchmark engine, metrics collection
    routers/          FastAPI routers (models, chat, benchmark, settings, status,
                        params, downloads, notes, schedules, proxy)
    clients.py        opencode / client config sync
    config.py         CrucibleConfig dataclass + load/save
    hf_downloader.py  HuggingFace download manager
    model_notes.py    Notes and tags storage
    model_params.py   Per-model and global default parameters
    registry.py       Model scanning, stats persistence
    scheduler.py      Scheduled model switching
  frontend/           Next.js app
    app/              App Router pages
      models/         Model registry + per-model dialogs
      benchmark/      New run, history, detail views
      chat/           Streaming chat
      downloads/      HuggingFace download UI
      schedules/      Scheduled switching UI
      settings/       Config + LAN serving
    components/       shared UI components (Sidebar, etc.)
    lib/              API client (api.ts), stores (Zustand), utils
  menubar/            macOS menu bar companion (rumps)
  docs/               design docs and specs
    PHASES_3_4_5.md   Phase 3/4/5 planning
  run.sh              starts both backend and frontend
  CLAUDE.md           this file
  SPEC.md             full feature specification
```

## Commands

```bash
# Start everything
bash run.sh

# Backend only
cd backend && source .venv/bin/activate && uvicorn main:app --reload --port 7777

# Frontend only
cd frontend && pnpm dev

# Install backend deps
cd backend && uv pip install -r requirements.txt

# Install frontend deps
cd frontend && pnpm install
```

## Inference Backends

| Backend | Kind string | How Crucible controls it | Default port |
|---|---|---|---|
| llama-server (llama.cpp) | `"gguf"` | subprocess | 8080 |
| mlx_lm.server | `"mlx"` | subprocess | 8000 |
| Ollama | `"ollama"` | external daemon, HTTP API | 11434 |

**Never hardcode ports** — always use the adapter's `port` property which reads from config.

## API Routes (FastAPI, port 7777)

```
GET  /api/models                        # all models across all backends
POST /api/models/{id}/load              # load model (SSE stream for progress)
POST /api/models/stop                   # stop active model
GET  /api/status                        # active model, engine state, memory, thermal

POST /api/chat                          # streaming chat (SSE)

POST /api/benchmark/run                 # start benchmark (SSE stream)
GET  /api/benchmark/history             # list past runs (filterable)
GET  /api/benchmark/run/{id}            # single run detail with all metrics
DELETE /api/benchmark/run/{id}          # delete a run

GET  /api/settings                      # current config
PUT  /api/settings                      # save config

GET  /api/models/{id}/params            # model-specific params (raw, no merge)
PUT  /api/models/{id}/params            # save model params
DELETE /api/models/{id}/params          # reset model params
GET  /api/params/defaults               # global default params
PUT  /api/params/defaults               # save global defaults
DELETE /api/params/defaults             # reset global defaults

GET  /api/models/{id}/notes             # get model notes + tags
PUT  /api/models/{id}/notes             # save model notes + tags
GET  /api/tags                          # all unique tags

GET  /api/schedules                     # list switching rules
POST /api/schedules                     # create rule
PUT  /api/schedules/{id}                # update rule
DELETE /api/schedules/{id}              # delete rule

GET  /api/hf/search?q=...&kind=mlx     # search HuggingFace
POST /api/hf/download                   # start download
GET  /api/hf/downloads                  # list jobs
GET  /api/hf/download/{id}/stream       # SSE progress stream

GET  /v1/models                         # OpenAI-compat: active model list
POST /v1/chat/completions               # OpenAI-compat proxy → adapter
```

All SSE streams use `data: <json>\n\n` format with an `event` field indicating message type.

## Config File

`~/.config/crucible/config.json` — created with defaults on first run.

```json
{
  "mlx_dir":        "/Volumes/DataNVME/models/mlx",
  "gguf_dir":       "/Volumes/DataNVME/models/gguf",
  "llama_server":   "~/.local/bin/llama-server",
  "llama_port":     8080,
  "mlx_port":       8000,
  "ollama_host":    "http://localhost:11434",
  "default_model":  "",
  "bind_host":      "127.0.0.1",
  "api_key":        ""
}
```

## Data Files

| File | Purpose |
|---|---|
| `~/.config/crucible/config.json` | Main config |
| `~/.config/crucible/model_params.json` | Per-model + global default inference parameters |
| `~/.config/crucible/model_stats.json` | Persistent avg_tps per model (survives restarts) |
| `~/.config/crucible/model_notes.json` | Notes and tags per model |
| `~/.config/crucible/schedules.json` | Scheduled switching rules |
| `~/.config/crucible/crucible.db` | SQLite benchmark history |

## UI Design Language

- **Dark-first** — `zinc-950` / `zinc-900` backgrounds, not pure black
- **Glass cards** — `backdrop-blur` with `border-white/10`
- **Accent** — indigo (`indigo-500`) for active states, CTAs, primary chart series
- **Fonts** — Inter for UI, JetBrains Mono for metrics and code
- **Charts** — Recharts, dark bg, accent primary series, muted secondary; minimal gridlines
- **Motion** — subtle only: fade-in, skeleton loaders, smooth chart entry. No gratuitous animation
- **Layout** — collapsible left sidebar nav, main content area, optional right stats panel
- **Status dots** — pulsing colored dots for live state (loading/running/idle/error)

## Key Implementation Rules

- Backend is async throughout — use `asyncio`, `aiofiles`, `aiosqlite`; no blocking calls on the event loop
- Use Python 3.13 (`/opt/homebrew/bin/python3.13`)
- Frontend API calls go through `lib/api.ts` — never fetch backend URLs directly in components
- Zustand stores in `lib/stores/` — one store per domain (models, benchmark, chat, settings)
- shadcn/ui for all base components — don't reinvent buttons, dialogs, tabs
- Recharts for all charts — no Chart.js, no D3 directly
- **mlx_lm 0.31.1+**: model field in POST must be the full path (as returned by `/v1/models`), NOT a bare name — bare names trigger HuggingFace lookup
- **Qwen3 thinking models**: streaming tokens are in `delta.reasoning`, not `delta.content` — all adapters handle this fallback
- **Model params**: `get_params()` merges global defaults + model-specific (model wins); `get_params_raw()` returns model-only
- **Proxy at `/v1/*`**: rewrites `"model"` field to `_server_model_id` (full path) before forwarding to mlx_lm.server

## Current Status

**Phase 1 — Complete. Phase 2 — Complete.** See SPEC.md for Phase 3/4/5 plans.

Machine: M2 Max, 96GB, macOS 15. Models at `/Volumes/DataNVME/models/`.
