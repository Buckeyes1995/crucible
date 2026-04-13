# Crucible

A local LLM management and benchmarking web app for Apple Silicon. Discover, load, chat with, and benchmark models across multiple inference backends — all from a clean web UI.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi)
![Python](https://img.shields.io/badge/Python-3.13-blue?logo=python)
![Platform](https://img.shields.io/badge/Platform-macOS%20Apple%20Silicon-silver?logo=apple)

---

## Features

- **Model Registry** — auto-discovers MLX, GGUF, and Ollama models from configured directories
- **Multi-Backend Inference** — pluggable adapter system supporting MLX-LM, llama.cpp, Ollama, and any external OpenAI-compatible server
- **Live Metrics** — real-time WebSocket dashboard: generation tok/s, prompt eval tok/s, TTFT, memory pressure, thermal state
- **Benchmarking** — multi-model, multi-prompt benchmarks with TTFT, throughput, p50/p90/p99 percentiles, memory and thermal tracking
- **HumanEval** — 164-problem Python code generation benchmark with sandboxed execution and failure classification
- **Chat** — streaming chat with the active model, with per-request TTFT and tok/s stats
- **HuggingFace Downloads** — search and download MLX or GGUF models with live SSE progress tracking and resume support
- **Scheduled Switching** — time-based rules to auto-load models (e.g., big model at night, fast model during the day)
- **Per-Model Parameters** — temperature, max_tokens, top_k, top_p, min_p, repetition penalty, context window, TTL — saved per model
- **Model Notes & Tags** — attach notes and tags to models for organization
- **Webhooks** — fire-and-forget HTTP callbacks on `model.loaded`, `model.unloaded`, `benchmark.done`, `download.done`
- **OpenAI-Compatible Proxy** — `/v1/chat/completions` endpoint for external tool integration (opencode, aider, etc.)
- **LAN Serving** — bind to `0.0.0.0` with optional API key auth for network access
- **macOS Menu Bar** — companion app showing active model, memory pressure, and quick model switching

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, TypeScript, Tailwind CSS v4, shadcn/ui, Recharts, Zustand |
| Backend | Python 3.13, FastAPI, uvicorn, aiosqlite |
| HTTP client | httpx (async), aiohttp (webhooks) |
| System metrics | psutil, macOS IOKit (thermal) |
| Model downloads | huggingface_hub |
| Menu bar | Python, rumps |

---

## Requirements

- macOS (Apple Silicon recommended)
- Python 3.13 — `brew install python@3.13`
- Node.js + pnpm — `brew install node pnpm`
- At least one supported inference backend (see below)

---

## Quick Start

```bash
git clone https://github.com/Buckeyes1995/crucible.git
cd crucible
bash run.sh          # production mode (recommended)
bash run.sh --dev    # dev mode with hot reload (local only)
```

Opens:
- **Web UI** → http://localhost:3000
- **API** → http://localhost:7777

`run.sh` creates the Python venv, installs all dependencies, builds the frontend (production mode), and starts both servers. Ctrl+C to stop everything.

> **Remote access:** Production mode is required when accessing Crucible through a reverse proxy or Cloudflare Tunnel — dev mode's WebSocket HMR breaks through tunnels/proxies.

---

## Manual Setup

### Backend

```bash
cd backend
/opt/homebrew/bin/python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 7777
```

### Frontend

```bash
cd frontend
pnpm install
pnpm dev
```

### Menu Bar Companion (optional)

```bash
cd menubar
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python crucible_menubar.py
```

---

## Configuration

Config is stored at `~/.config/crucible/config.json` and created with defaults on first run. Edit via **Settings** in the UI or directly:

```json
{
  "mlx_dir": "/Volumes/DataNVME/models/mlx",
  "gguf_dir": "/Volumes/DataNVME/models/gguf",
  "llama_server": "~/.local/bin/llama-server",
  "llama_port": 8080,
  "mlx_port": 8010,
  "mlx_python": "~/.venvs/mlx/bin/python",
  "mlx_external_url": "",
  "ollama_host": "http://localhost:11434",
  "default_model": "",
  "bind_host": "127.0.0.1",
  "api_key": ""
}
```

| Option | Description |
|---|---|
| `mlx_dir` | Directory containing MLX model folders |
| `gguf_dir` | Directory containing GGUF model files or folders |
| `llama_server` | Path to `llama-server` binary |
| `mlx_python` | Python executable for the MLX venv (must have `mlx_lm` installed) |
| `mlx_external_url` | Use an already-running OpenAI-compatible server for MLX instead of spawning one |
| `bind_host` | Set to `0.0.0.0` for LAN access |
| `api_key` | If set, non-localhost requests must provide `Authorization: Bearer <key>` or `X-API-Key: <key>` |

### Data Files

| Path | Contents |
|---|---|
| `~/.config/crucible/config.json` | Main configuration |
| `~/.config/crucible/model_params.json` | Per-model inference parameters |
| `~/.config/crucible/model_stats.json` | Persisted avg tok/s per model |
| `~/.config/crucible/model_notes.json` | Notes and tags per model |
| `~/.config/crucible/schedules.json` | Scheduled switching rules |
| `~/.config/crucible/webhooks.json` | Registered webhooks |
| `~/.config/crucible/crucible.db` | SQLite benchmark history |
| `~/.config/crucible/downloads.json` | Download job state (persists across restarts) |

---

## Inference Backends

Crucible manages inference servers as subprocesses or connects to running daemons.

| Backend | Model format | How it's managed | Default port |
|---|---|---|---|
| **MLX-LM** | `.safetensors` + `config.json` | Spawned subprocess | 8010 |
| **llama.cpp** | `.gguf` | Spawned subprocess | 8080 |
| **Ollama** | Ollama library | External daemon | 11434 |
| **External** | Any OpenAI-compatible | HTTP only (no subprocess) | configurable |

On model load, Crucible kills any orphaned process on the target port, spawns the server, waits for it to be ready, runs a warmup request, then marks the model as loaded.

---

## API

Crucible exposes a REST API at `http://localhost:7777` and an OpenAI-compatible proxy at `/v1`.

### Key Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/models` | List all discovered models |
| `POST` | `/api/models/{id}/load` | Load a model (SSE stream of load stages) |
| `POST` | `/api/models/stop` | Unload active model |
| `POST` | `/api/models/refresh` | Re-scan model directories |
| `GET` | `/api/status` | Active model, engine state, memory, thermal |
| `POST` | `/api/chat` | Streaming chat (SSE) |
| `POST` | `/api/benchmark/run` | Run benchmark (SSE) |
| `GET` | `/api/benchmark/history` | List benchmark runs |
| `GET` | `/api/benchmark/run/{id}` | Benchmark run detail |
| `GET` | `/api/settings` | Get config |
| `PUT` | `/api/settings` | Update config |
| `GET/PUT/DELETE` | `/api/models/{id}/params` | Per-model inference params |
| `POST` | `/api/hf/download` | Start HuggingFace download |
| `GET` | `/api/hf/download/{id}/stream` | SSE download progress |
| `POST` | `/api/hf/download/{id}/resume` | Resume failed/cancelled download |
| `GET/POST/PUT/DELETE` | `/api/webhooks` | Webhook CRUD |
| `WebSocket` | `/ws/metrics` | Live metrics stream (1s interval) |
| `GET` | `/v1/models` | OpenAI-compatible model list |
| `POST` | `/v1/chat/completions` | OpenAI-compatible chat completions |

### OpenAI Proxy

The `/v1/chat/completions` endpoint proxies to the active model's inference server, rewrites the `model` field to the correct server-side ID, and captures performance metrics from the usage chunk. Compatible with any client that speaks the OpenAI API.

```bash
curl http://localhost:7777/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "any", "messages": [{"role": "user", "content": "Hello"}], "stream": true}'
```

### Webhooks

Register HTTP callbacks for events:

```bash
curl -X POST http://localhost:7777/api/webhooks \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-server/hook", "events": ["model.loaded", "benchmark.done"], "secret": "optional"}'
```

Supported events: `model.loaded`, `model.unloaded`, `benchmark.done`, `download.done`

---

## Pages

| Page | Route | Description |
|---|---|---|
| Models | `/models` | Model grid with load/unload, params, notes, favorites |
| Chat | `/chat` | Streaming chat with live TTFT and tok/s stats |
| Benchmark | `/benchmark/new` | Configure and run benchmarks |
| History | `/benchmark/history` | Past runs with trend and comparison views |
| HumanEval | `/humaneval` | 164-problem Python coding benchmark |
| Downloads | `/downloads` | HuggingFace model search and download queue |
| Schedules | `/schedules` | Time-based model auto-switching rules |
| Metrics | `/metrics` | Live WebSocket dashboard |
| Settings | `/settings` | App configuration and webhooks |

---

## Project Structure

```
crucible/
├── backend/
│   ├── main.py              # FastAPI app, lifespan, auth middleware
│   ├── config.py            # CrucibleConfig (Pydantic)
│   ├── registry.py          # Model discovery and scanning
│   ├── scheduler.py         # Time-based model switching
│   ├── webhooks.py          # Webhook registry and dispatcher
│   ├── hf_downloader.py     # HuggingFace download manager
│   ├── clients.py           # External tool config sync (opencode)
│   ├── model_params.py      # Per-model parameter storage
│   ├── model_notes.py       # Per-model notes and tags
│   ├── adapters/
│   │   ├── base.py          # BaseAdapter abstract class
│   │   ├── omlx.py          # oMLX subprocess adapter
│   │   ├── mlx_lm.py        # MLX-LM server adapter
│   │   ├── llama_cpp.py     # llama.cpp server adapter
│   │   ├── ollama.py        # Ollama adapter
│   │   ├── external.py      # External OpenAI-compatible adapter
│   │   └── port_utils.py    # Port cleanup utilities
│   ├── benchmark/
│   │   ├── engine.py        # Benchmark runner
│   │   ├── metrics.py       # Memory pressure, thermal state
│   │   ├── prompts.py       # Built-in benchmark prompts
│   │   └── humaneval.py     # HumanEval runner
│   ├── routers/
│   │   ├── models.py        # Model management endpoints
│   │   ├── chat.py          # Chat endpoint
│   │   ├── benchmark.py     # Benchmark endpoints
│   │   ├── proxy.py         # OpenAI-compatible proxy
│   │   ├── metrics_ws.py    # WebSocket metrics
│   │   ├── downloads.py     # HuggingFace download endpoints
│   │   ├── settings.py      # Config endpoints
│   │   ├── params.py        # Model params endpoints
│   │   ├── notes.py         # Model notes endpoints
│   │   ├── schedules.py     # Schedule endpoints
│   │   ├── webhooks.py      # Webhook endpoints
│   │   ├── humaneval.py     # HumanEval endpoints
│   │   └── status.py        # Status endpoint
│   └── db/
│       └── database.py      # SQLite schema and helpers
├── frontend/
│   ├── app/                 # Next.js App Router pages
│   ├── components/          # Sidebar, TopBar, shadcn/ui
│   └── lib/
│       ├── api.ts           # Typed API client
│       └── stores/          # Zustand state stores
├── menubar/
│   └── crucible_menubar.py  # macOS menu bar companion
├── run.sh                   # One-command startup script
└── SPEC.md                  # Full feature specification
```

---

## License

MIT
