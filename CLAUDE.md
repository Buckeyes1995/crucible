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
    adapters/         one module per backend (llama_cpp.py, mlx_lm.py, ollama.py, external.py, remote_node.py)
    omlx_admin.py     oMLX admin API client (DFlash toggle, settings)
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
# Start everything (production mode — required for remote/tunnel access)
bash run.sh

# Start in dev mode (hot reload, local only)
bash run.sh --dev

# Backend only
cd backend && source .venv/bin/activate && uvicorn main:app --reload --port 7777

# Frontend only (dev)
cd frontend && pnpm dev

# Frontend only (production)
cd frontend && pnpm build && pnpm start

# Install backend deps
cd backend && uv pip install -r requirements.txt

# Install frontend deps
cd frontend && pnpm install
```

## Inference Backends

| Backend | Kind string | Engine name | How Crucible controls it | Default port |
|---|---|---|---|---|
| oMLX | `"mlx"` | `omlx` | subprocess (launchd) | 8000 |
| mlx_lm.server | `"mlx"` | `mlx_lm` | subprocess | 8010 |
| vllm serve (vllm-metal) | `"vllm"` | `vllm` | subprocess | 8020 (compare 8021) |
| llama-server (llama.cpp) | `"gguf"` | `llama_cpp` | subprocess | 8080 (compare 8081) |
| Ollama | `"ollama"` | `ollama` | external daemon, HTTP API | 11434 |
| MLX Studio | `"mlx_studio"` | `mlx_studio` | external HTTP | configured |
| Remote Node | any (proxied) | — | HTTP proxy to remote Crucible | remote's port |

**Never hardcode ports** — always use the adapter's `port` property which reads from config.

**Preferred engine:** `kind="mlx"` can run on either `omlx` (default) or `mlx_lm`. Choice flows through `_resolve_engine` in `routers/models.py`: per-load `?engine=` override > `model_notes.preferred_engine` > first entry in `ENGINES_BY_KIND[kind]`. Stored per-model in `model_notes.json`. vLLM and GGUF map 1:1 to their engine, so the picker is hidden for those kinds.

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

GET  /api/nodes                         # remote node connectivity status

GET  /api/models/{id}/dflash            # DFlash eligibility + status
PUT  /api/models/{id}/dflash            # enable/disable DFlash for a model

POST /api/arena/battle                  # start blind A/B battle
POST /api/arena/battle/{id}/chat        # stream both model responses (SSE)
POST /api/arena/battle/{id}/vote        # vote on winner → ELO update
GET  /api/arena/leaderboard             # ELO rankings
GET  /api/arena/history                 # recent battles

POST /api/dflash/benchmark              # DFlash vs normal speed comparison (SSE)

GET  /api/smart-router/config           # smart router rules
PUT  /api/smart-router/config           # save routing rules
POST /api/smart-router/classify         # test prompt classification

GET  /api/profiler/profiles             # recent inference profiles
GET  /api/profiler/stats                # per-model aggregate stats

GET  /api/recommender                   # model library analysis + recommendations

GET  /api/models/{id}/params            # model-specific params (raw, no merge)
PUT  /api/models/{id}/params            # save model params
DELETE /api/models/{id}/params          # reset model params
GET  /api/params/defaults               # global default params
PUT  /api/params/defaults               # save global defaults
DELETE /api/params/defaults             # reset global defaults

GET  /api/models/{id}/notes             # get model notes + tags + preferred_engine
PUT  /api/models/{id}/notes             # save model notes + tags
PUT  /api/models/{id}/hidden            # set model hidden flag
PUT  /api/models/{id}/preferred-engine  # set preferred engine for mlx models
GET  /api/tags                          # all unique tags

GET  /api/zlab/drafts                   # list z-lab DFlash draft repos (cached)
POST /api/zlab/drafts/refresh           # force-refetch z-lab repo list from HF
POST /api/zlab/drafts/download          # trigger HF download of a z-lab draft

GET  /api/hf-updates                    # upstream update state for all tracked models
POST /api/hf-updates/refresh            # re-check HF lastModified for all tracked models
GET  /api/models/{id}/origin-repo       # get origin HF repo + last-checked state
PUT  /api/models/{id}/origin-repo       # set origin HF repo (body: {repo_id})

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
  "vllm_dir":       "/Volumes/DataNVME/models/vllm",
  "vllm_bin":       "~/.venv-vllm-metal/bin/vllm",
  "vllm_port":      8020,
  "vllm_compare_port": 8021,
  "llama_server":   "~/.local/bin/llama-server",
  "llama_port":     8080,
  "mlx_port":       8010,
  "ollama_host":    "http://localhost:11434",
  "default_model":  "",
  "bind_host":      "127.0.0.1",
  "api_key":        "",
  "nodes":          []
}
```

## Data Files

| File | Purpose |
|---|---|
| `~/.config/crucible/config.json` | Main config |
| `~/.config/crucible/model_params.json` | Per-model + global default inference parameters |
| `~/.config/crucible/model_stats.json` | Persistent avg_tps per model (survives restarts) |
| `~/.config/crucible/model_notes.json` | Notes, tags, hidden flag, and `preferred_engine` per model |
| `~/.config/crucible/schedules.json` | Scheduled switching rules |
| `~/.config/crucible/prompt_templates.json` | Saved prompt templates (marketplace) |
| `~/.config/crucible/crucible.db` | SQLite benchmark history |
| `~/.config/crucible/zlab_drafts.json` | Cached z-lab HF repo list (6h TTL) |
| `~/.config/crucible/hf_updates.json` | Per-model origin HF repo + upstream lastModified tracking |

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
- Frontend API calls go through `lib/api.ts` using relative `/api` paths — never hardcode `localhost:7777` in components
- Next.js rewrites in `next.config.ts` proxy `/api/*`, `/v1/*`, and `/ws/*` to the backend on port 7777 server-side
- Zustand stores in `lib/stores/` — one store per domain (models, benchmark, chat, settings)
- shadcn/ui for all base components — don't reinvent buttons, dialogs, tabs
- Recharts for all charts — no Chart.js, no D3 directly
- **mlx_lm 0.31.1+**: model field in POST must be the full path (as returned by `/v1/models`), NOT a bare name — bare names trigger HuggingFace lookup
- **Qwen3 thinking models**: streaming tokens are in `delta.reasoning`, not `delta.content` — all adapters handle this fallback
- **Model params**: `get_params()` merges global defaults + model-specific (model wins); `get_params_raw()` returns model-only
- **Proxy at `/v1/*`**: rewrites `"model"` field to `_server_model_id` (full path) before forwarding to mlx_lm.server
- **Remote nodes**: models from remote Crucible instances have `node != "local"` and IDs prefixed `@node_name/`. Adapter routing checks `model.node` before `model.kind`. `backend_meta` internal fields (`_remote_*`) are stripped before serialization to the frontend.
- **DFlash speculative decoding**: MLX models with a matching `*-DFlash` sibling directory are annotated with `dflash_draft` path. DFlash is toggled per-model via oMLX admin API (`PUT /admin/api/models/{id}/settings`). `dflash_enabled` state is read from oMLX's `~/.omlx/model_settings.json`. DFlash draft directories are hidden from the model list.
- **vLLM models**: `kind="vllm"` models are HF-format safetensors (NOT mlx-community quantized dirs — vLLM-metal can't load those). Discovered from `config.vllm_dir`. Adapter shells out to `config.vllm_bin serve <path>` and polls `/v1/models` for readiness (up to 900s cold-start).
- **z-lab tracker**: `zlab.py` caches the `z-lab` HF org repo list (6h TTL) and matches `{base}-DFlash` drafts to local base models via `match_draft_for()` (normalizes quant/format suffixes). Surfaced as `available_draft_repo` on `ModelEntry`, suppressed when `dflash_draft` is already set.
- **HF update watcher**: `hf_updates.py` tracks per-model `origin_repo` + `downloaded_at`; on startup, `seed_from_downloads()` auto-fills from completed hf_downloader jobs (users set manually for pre-existing models via the Notes dialog). `check_models()` polls HF `lastModified` and flags `update_available=True` when upstream is newer. Newly-flagged updates push to the Notifications feed. `_annotate_hidden` in `routers/models.py` is the single source that stamps preferred_engine, available_draft_repo, origin_repo, update_available onto `ModelEntry`.

## Remote Access

Crucible is accessible remotely via Cloudflare Tunnel at `https://crucible.buckeyes1995.com`, protected by Cloudflare Access (OTP).

- **Tunnel:** `mac-studio` (ID `9661ad14-7a78-4615-80a8-e7318bd4e320`)
- **Config:** `/etc/cloudflared/config.yaml` (root-owned, daemon reads this — NOT `~/.cloudflared/config.yaml`)
- **Hostnames:**
  - `crucible.buckeyes1995.com` → `http://localhost:3000` (Next.js frontend)
  - `crucible-api.buckeyes1995.com` → `http://localhost:7777` (backend, for WebSocket metrics)
- **Frontend must run in production mode** (`pnpm build` + `pnpm start`) — dev mode's WebSocket HMR breaks through tunnels
- **API key not needed** when Cloudflare Access is the auth layer — the backend's `api_key` config should be empty for tunnel use
- The Next.js rewrite handles `/api/*` → backend server-side, so the browser never talks to port 7777 directly (except WebSocket on `/metrics` page via `crucible-api` hostname)

## Key Gotchas

- **GGUF load stuck at "starting"**: `kill_port` must use `-sTCP:LISTEN` flag with `lsof` — without it, Chrome Helper connections to port 8080 get killed, disconnecting the browser before the generator starts
- **SSE generator must yield before blocking**: Starlette cancels the async generator if the client disconnects; always yield the first SSE event before any `await kill_port()` or `await self.stop()` calls
- **Multiple uvicorn instances**: `run.sh` starts uvicorn — never start a second one manually; use `pkill -9 -f uvicorn` to clean up if needed
- **Benchmark2**: The redesigned benchmark page is at `/benchmark2` — the old `/benchmark/new` still exists but Sidebar links to `/benchmark2`
- **Model hiding**: `model_notes.json` stores the `hidden` flag; `all_hidden()` returns a dict; `_annotate_hidden()` in `routers/models.py` stamps it onto `ModelEntry` for both list and refresh routes; hidden models are filtered from the benchmark model picker
- **Cloudflared reads `/etc/cloudflared/config.yaml`**: The LaunchDaemon runs as root — editing `~/.cloudflared/config.yaml` has no effect. Must `sudo` edit `/etc/cloudflared/config.yaml` and restart with `sudo launchctl kickstart -k system/com.cloudflare.cloudflared`
- **Uvicorn proxy_headers**: Uvicorn trusts `X-Forwarded-For` from localhost by default, rewriting `request.client.host` to the real client IP. This means the auth middleware sees external IPs even for requests proxied through Next.js. When using Cloudflare Access as the auth layer, leave `api_key` empty.

## Current Status

**Phases 1–6 — Complete.** See SPEC.md for full feature list. Phase 6 adds Arena, DFlash Bench, Smart Router, Inference Profiler, and Model Recommender.

Machine: M2 Max, 96GB, macOS 15. Models at `/Volumes/DataNVME/models/`.
