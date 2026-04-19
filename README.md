# Crucible

**Local LLM management, benchmarking, and research workbench for Apple Silicon.** Discover and load models across multiple inference engines, chat with them, run structured evals, play them against each other in a blind arena, fine-tune from curated chat history, and keep it all in one web UI.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi)
![Python](https://img.shields.io/badge/Python-3.13-blue?logo=python)
![Platform](https://img.shields.io/badge/Platform-macOS%20Apple%20Silicon-silver?logo=apple)
![License](https://img.shields.io/badge/License-MIT-green)

![Crucible screenshot placeholder](docs/screenshot.png)

---

## Table of contents

- [What it does](#what-it-does)
- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Inference backends](#inference-backends)
- [Pages](#pages)
- [API](#api)
- [Data & paths](#data--paths)
- [Remote access](#remote-access)
- [Architecture](#architecture)
- [Development](#development)
- [License](#license)

---

## What it does

### Model management

- **Multi-backend inference** — plug-in adapters for **oMLX**, **mlx_lm.server**, **vLLM (metal)**, **llama.cpp**, **Ollama**, and any external OpenAI-compatible server.
- **Model discovery** — auto-scans configured directories for MLX weights, GGUF files, and vLLM-format safetensors. Also pulls Ollama's local library via its HTTP API.
- **Preferred engine per model** — MLX models can run on either `omlx` or `mlx_lm`; pick a default per model and override per load with `?engine=`.
- **Chip-based model cards** — parsed identifiers (family / params / variant / quant) replace the old long truncated names; full ID shown as small mono footer.
- **Loaded model pinned** — the active model has its own "Loaded" section above the Library grid with an emerald glow.
- **Notes, tags, favorites, aliases** — per-model metadata stored in `model_notes.json`.
- **Memory planner** (`/planner`) — pick N models, see "Fits — 8 GB headroom" or "Over by 15 GB" before you try to load them.
- **Disk reclaim** (`/disk`) — per-model last-loaded age, bulk-select candidates idle for >N days, one-click reclaim.
- **Warmth analyzer** — per-model load count + recency scoring for future pre-warm automation.

### Chat

- **Streaming chat** (`/chat`) with live TTFT and tok/s.
- **Chat history** (`/chat/history`) — every turn persisted to SQLite. Resume a past conversation with one click; new turns append to the same session.
- **Templates** — saved prompt templates with one-click paste into chat, arena, diff, visualizer.
- **RAG** — upload a text or file as session context, chunks are retrieved per turn.
- **Visualizer** (`/visualizer`) — per-token timing waterfall to spot pauses, draft-acceptance patterns, cold-load cost.

### Benchmarking

- **Live dashboard** (`/benchmark2`) — sticky top stat strip (elapsed / progress / ETA / best tok/s / avg tok/s), per-model compact cards with inline sparkline, multi-series tok/s chart.
- **HumanEval** (`/humaneval`) — 164-problem Python benchmark with sandboxed execution, failure classification (infra vs legitimate), per-category scoring.
- **Structured eval suite** — deterministic multi-category scorers (code / reasoning / factual / instruction-following) with pass rates.
- **NIAH context test** — needle-in-haystack at configurable context lengths to find where a model starts hallucinating.
- **DFlash Bench** (`/dflash`) — A/B speculative decoding with/without DFlash, fair warmup + measurement.
- **Auto-benchmark on download** — every new MLX download gets a tiny 3-prompt bench automatically, stamped onto the model card.

### Blind A/B arena

- **Live arena** (`/arena`) — pick a prompt, two anonymous models answer, you vote, ELO updates.
- **Sequential generation** — one model loads, generates, unloads; next model loads. Prevents oMLX from doubling memory pressure mid-battle.
- **Heartbeat protocol** — SSE keeps the client alive during the cold-load gap between slots; panel shows `loading weights…` then `generating…`.
- **Review queue** (`/arena/review`) — autobattle generates N battles overnight with no human present, stashes them pending. Rapid-vote with arrow keys the next morning.
- **LLM-as-judge** — optional: pass a judge model to autobattle; each battle auto-votes with bias mitigations (slot randomization, length-neutral prompt).
- **Leaderboard** (`/arena/leaderboard`) — cumulative ELO + win/loss/tie across all battles.

### Code workflow

- **Model diff** (`/diff`) — run N models on the same prompt side-by-side, pipe-able into a copy-as-markdown report.
- **Save generated code** — after an arena battle or diff run, click **Save** on each panel. Fenced code blocks land at `~/.config/crucible/outputs/<source>/<run_id>/<model_name>/`; **Reveal** opens the directory in Finder for direct execution.
- **Training-data curator** — scan chat history, filter by turn count / recency / code-presence, export as ShareGPT JSONL for the fine-tune pipeline.
- **Fine-tune pipeline** — curator export → LoRA training scaffold with provenance tracking.

### Agents & automation

- **Agents** (`/agents`) — register remote agent sidecars (e.g. a hermes-agent docker container running on another machine) and control them from the Crucible UI: chat with streaming response, list cron jobs, pause/resume/restart container, view logs, prune orphans.
- **Hermes chat panel** — full conversational interface with the agent; multi-turn session persistence, Stop button, auto-scroll, Enter-to-send.
- **Scheduled switching** — time-based rules to auto-load models (big model at night, small model during the day). Rules can be gated to off-peak hours.
- **HF upstream watcher** — polls HuggingFace `lastModified` for every local model with a tracked origin repo, pushes a notification with Update & replace button when upstream changes.
- **Workflows** — save a parameterized hermes chat as a reusable macro (`"Summarize my PRs from the last {days} days"`); replay on demand or schedule.

### Multi-model synthesis

- **Ensemble** — fan out one prompt to N models in parallel, combine via **longest** / **best-of-N (judge)** / **concat** strategies.
- **Smart router** (`/router`) — classify prompt (code/math/reasoning/short/long), route to the best-fit model per user-configured rules.
- **Smart router replay** — run your actual chat history through the router and report agreement rate vs actual usage.
- **Recommender v2** — data-driven model picks combining arena ELO, benchmark avg, chat usage into a 0-1 score with actionable insights.

### Observability

- **Live metrics** (`/metrics`) — WebSocket dashboard: generation tok/s, prompt eval tok/s, TTFT, memory %, thermal state.
- **Sidebar telemetry** — always-on 60-sample CPU sparkline + package watts (when `sudo powermetrics` is configured) + thermal dot in the sidebar footer.
- **Crash recovery** — session state (active model, engine) persisted to disk with an fcntl file-lock guard. On backend restart after a dirty shutdown, an amber banner offers one-click Restore.
- **Notifications** (`/notifications`) — model-update alerts, auto-benchmark completions, rich events with action buttons.

### Integration

- **OpenAI-compatible proxy** (`/v1/*`) — drop-in replacement for any OpenAI SDK pattern: non-streaming + streaming chat completions, tool calls, structured outputs, multi-turn context. Covered by a compat smoke test (`backend/tests/test_openai_compat.py`).
- **Webhooks** — fire-and-forget HTTP callbacks on `model.loaded`, `model.unloaded`, `benchmark.done`, `download.done`.
- **Remote nodes** — connect multiple Crucible instances; models from remotes are discoverable + usable with a transparent proxy adapter.
- **PWA** — installable on iOS/Android home screen via Safari Share / Chrome install; standalone mode, themed status bar.
- **Menu-bar companion** — macOS menu bar app (separate `menubar/` project) with active model, memory pressure, quick switch.

---

## Requirements

- **macOS** (Apple Silicon recommended; tested on M2 Max, 96 GB)
- **Python 3.13** — `brew install python@3.13`
- **Node.js + pnpm** — `brew install node pnpm`
- At least one backend installed locally (see [Inference backends](#inference-backends))
- 16 GB RAM minimum; 64 GB+ recommended for real model work

---

## Install

```bash
git clone https://github.com/Buckeyes1995/crucible.git
cd crucible
```

**One-command startup** (creates venv, installs deps, builds frontend, starts everything):

```bash
bash run.sh           # production mode — use this for tunnels or LAN
bash run.sh --dev     # dev mode — hot reload, localhost-only
```

- **Web UI** → http://localhost:3000
- **API** → http://localhost:7777

Ctrl+C in the `run.sh` terminal stops both servers.

### Manual setup (if you prefer)

**Backend:**
```bash
cd backend
/opt/homebrew/bin/python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 7777
```

**Frontend:**
```bash
cd frontend
pnpm install
pnpm dev       # or: pnpm build && pnpm start  for production
```

**Menu-bar companion** (optional):
```bash
cd menubar
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python crucible_menubar.py
```

---

## Quick start

1. Start Crucible with `bash run.sh`.
2. Open http://localhost:3000 → **Settings** — set `mlx_dir`, `gguf_dir`, and at least one backend binary path.
3. Click **Models** — Crucible scans your directories. Click any card's **Load** button.
4. **Chat** at `/chat` — talk to the active model with live stats.
5. **Benchmark** at `/benchmark2` — pick a preset, click Run, watch the live dashboard.
6. **Arena** at `/arena` — blind A/B your models, vote, build up ELO rankings over time.

---

## Configuration

Config lives at `~/.config/crucible/config.json` (created with sensible defaults on first run). Edit via **Settings** in the UI or directly.

```json
{
  "mlx_dir":             "/Volumes/DataNVME/models/mlx",
  "gguf_dir":            "/Volumes/DataNVME/models/gguf",
  "vllm_dir":            "/Volumes/DataNVME/models/vllm",
  "vllm_bin":            "~/.venv-vllm-metal/bin/vllm",
  "vllm_port":           8020,
  "llama_server":        "~/.local/bin/llama-server",
  "llama_port":          8080,
  "mlx_port":            8010,
  "mlx_python":          "~/.venvs/mlx/bin/python",
  "mlx_external_url":    "http://localhost:8000",
  "omlx_api_key":        "123456",
  "ollama_host":         "http://localhost:11434",
  "default_model":       "",
  "bind_host":           "127.0.0.1",
  "api_key":             "",
  "nodes":               [],
  "agents":              []
}
```

| Key | Purpose |
|---|---|
| `mlx_dir` / `gguf_dir` / `vllm_dir` | Where to scan for models of each kind |
| `vllm_bin`, `mlx_python`, `llama_server` | Paths to backend binaries |
| `mlx_external_url` | URL of an already-running oMLX (preferred) — Crucible won't spawn mlx_lm when this is set |
| `omlx_api_key` | Bearer token for oMLX admin + inference requests |
| `bind_host` | `0.0.0.0` for LAN access |
| `api_key` | If set, non-localhost requests must include `Authorization: Bearer <key>` |
| `nodes` | Remote Crucible instances: `[{name, url, api_key}]` |
| `agents` | Remote agent sidecars: `[{name, url, api_key, kind}]` |

---

## Inference backends

| Backend | Kind | File format | Engine | How Crucible controls it | Default port |
|---|---|---|---|---|---|
| **oMLX** | `mlx` | MLX safetensors + config | `omlx` | External daemon (launchd) | 8000 |
| **mlx_lm.server** | `mlx` | MLX safetensors + config | `mlx_lm` | Subprocess | 8010 |
| **vLLM (metal fork)** | `vllm` | HF-format safetensors (NOT mlx-community dirs) | `vllm` | Subprocess | 8020 |
| **llama.cpp** | `gguf` | `.gguf` | `llama_cpp` | Subprocess | 8080 |
| **Ollama** | `ollama` | Ollama library | `ollama` | External daemon | 11434 |
| **External** | any | OpenAI-compatible | — | HTTP proxy only | configurable |
| **Remote Node** | any | proxied | — | HTTP proxy to remote Crucible | remote's |

On load, Crucible kills any orphaned process on the target port, spawns the server (if subprocess), waits for `/v1/models` readiness, runs a warmup request, then marks the model as loaded. For oMLX, it issues admin API calls instead of spawning.

Between serial runs (arena, diff), Crucible explicitly unloads the previous model via the backend's admin unload endpoint so memory stays predictable.

---

## Pages

| Route | Purpose |
|---|---|
| `/` | Dashboard |
| `/models` | Model grid — load, params, notes, favorites, chips, pinned loaded section |
| `/chat` | Streaming chat, templates, RAG, resume-from-history |
| `/chat/history` | Past conversations with search, export, resume |
| `/chat/compare` | Side-by-side chat on two models |
| `/diff` | N-model same-prompt diff with save-to-disk |
| `/arena` | Live blind A/B with ELO |
| `/arena/review` | Queue of autobattle-generated pending battles to vote on |
| `/arena/leaderboard` | ELO rankings |
| `/benchmark2` | Live-dashboard benchmark runner |
| `/benchmark/history` | Past runs |
| `/humaneval` | 164-problem Python coding benchmark |
| `/dflash` | DFlash A/B speed bench |
| `/visualizer` | Per-token timing waterfall |
| `/downloads` | HF search + download with live progress + target path + ETA |
| `/notifications` | Notifications + Update & replace buttons |
| `/planner` | Memory pressure planner |
| `/disk` | Disk usage + bulk reclaim |
| `/agents` | Remote agent control (hermes etc.) |
| `/schedules` | Time-based auto-switching rules |
| `/metrics` | Live WebSocket metrics |
| `/settings` | Config + webhooks + nodes + agents |
| `/router` | Smart router configuration |
| `/profiler` | Per-request performance breakdown |
| `/recommender` | Static recommender with redundancy detection |
| `/finetune` | LoRA fine-tuning jobs |
| `/token-analytics` | Token usage analytics |
| `/cost` | Cost attribution |
| `/optimizer` | Parameter optimizer |
| `/heatmap` | Cross-model prompt heatmap |
| `/groups` | Model grouping |
| `/backup` | Config backup/restore |
| `/batch-inference` | Batch prompt pipeline UI |

---

## API

Full REST at `http://localhost:7777`, OpenAI-compatible proxy at `/v1`.

### Core endpoints

| Method | Path | |
|---|---|---|
| `GET` | `/api/models` | List all discovered models (with chips, kind, engine, size, ELO, DFlash state) |
| `POST` | `/api/models/{id}/load` | Load (SSE progress stream) |
| `POST` | `/api/models/stop` | Unload active model |
| `POST` | `/api/models/refresh` | Re-scan directories |
| `DELETE` | `/api/models/{id}/disk` | Delete from disk (safety-checked) |
| `GET` | `/api/status` | Active model + engine state + memory + thermal |
| `GET` | `/api/system/telemetry` | CPU %, mem %, thermal, package watts |
| `POST` | `/api/chat` | Streaming chat (SSE) |
| `GET/POST` | `/api/chat/sessions` | Chat history CRUD |

### Benchmark & eval

| Method | Path | |
|---|---|---|
| `POST` | `/api/benchmark/run` | Run benchmark (SSE) |
| `GET` | `/api/benchmark/history` | List runs |
| `GET` | `/api/benchmark/run/{id}` | Run detail |
| `DELETE` | `/api/benchmark/history` | Delete all runs |
| `POST` | `/api/humaneval/run` | HumanEval run |
| `POST` | `/api/eval-suite/start` | Structured eval suite |
| `POST` | `/api/niah/start` | Needle-in-haystack context test |
| `POST` | `/api/dflash/benchmark` | DFlash A/B |

### Arena

| Method | Path | |
|---|---|---|
| `POST` | `/api/arena/battle` | Start a blind battle (picks two random MLX) |
| `POST` | `/api/arena/battle/{id}/chat` | Stream both responses sequentially (SSE) |
| `POST` | `/api/arena/battle/{id}/vote` | Vote winner + ELO update |
| `GET` | `/api/arena/leaderboard` | ELO rankings |
| `GET` | `/api/arena/history` | Past battles |
| `POST` | `/api/arena/autobattle` | Queue N background battles (optionally with `judge_model_id`) |
| `GET` | `/api/arena/pending` | Battles awaiting human vote |
| `POST` | `/api/arena/pending/{id}/vote` | Vote on a pending battle |

### Operations

| Method | Path | |
|---|---|---|
| `POST` | `/api/mem-plan` | Will these models fit simultaneously? |
| `GET` | `/api/disk/summary` | Per-model usage + kind rollup + free space |
| `POST` | `/api/disk/reclaim` | Bulk delete |
| `GET` | `/api/warmth` | Load counts + recency scores |
| `GET` | `/api/recovery` | Dirty-shutdown snapshot for restore |
| `POST` | `/api/recovery/dismiss` | Clear recovery state |

### Downloads & HF

| Method | Path | |
|---|---|---|
| `GET` | `/api/hf/search` | HF search |
| `POST` | `/api/hf/download` | Start download |
| `GET` | `/api/hf/downloads` | All jobs |
| `GET` | `/api/hf/download/{id}/stream` | SSE progress |
| `DELETE` | `/api/hf/downloads/history` | Clear finished jobs |
| `GET` | `/api/hf-updates` | Upstream update state |
| `POST` | `/api/hf-updates/refresh` | Re-check upstream |

### Output + workflows

| Method | Path | |
|---|---|---|
| `POST` | `/api/output/save` | Save generated code to sandboxed dir |
| `POST` | `/api/output/reveal` | Open dir in Finder |
| `POST` | `/api/curator/preview` | Filter chat history for training data |
| `POST` | `/api/curator/export` | Export JSONL |
| `POST` | `/api/finetune-pipeline/start` | Curator JSONL → LoRA job |
| `POST` | `/api/workflows` | Save a hermes macro |
| `POST` | `/api/workflows/{id}/run` | Replay with values |
| `POST` | `/api/batch-pipeline/start` | Queue N one-off prompts |
| `GET` | `/api/batch-pipeline/{id}/csv` | Download results |
| `POST` | `/api/ensemble/run` | Multi-model fan-out with optional judge |

### Smart router + recommender

| Method | Path | |
|---|---|---|
| `GET/PUT` | `/api/smart-router/config` | Routing rules |
| `POST` | `/api/smart-router/classify` | Classify a prompt |
| `POST` | `/api/router-replay` | Replay chat history against router |
| `GET` | `/api/recommender/v2` | Data-driven recommendations |

### Agent control

| Method | Path | |
|---|---|---|
| `GET/POST/DELETE` | `/api/agents` | Register / list / unregister |
| `GET` | `/api/agents/{name}/status` | Aggregate status |
| `POST` | `/api/agents/{name}/chat` | Stream a conversational turn |
| `POST` | `/api/agents/{name}/pause` | Docker pause |
| `POST` | `/api/agents/{name}/restart` | Docker restart |

### OpenAI-compatible proxy

```bash
curl http://localhost:7777/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "any", "messages": [{"role": "user", "content": "Hi"}], "stream": true}'
```

Covered by a drop-in compat test:
```bash
cd backend && .venv/bin/python -m tests.test_openai_compat
```

Full per-endpoint reference: [`docs/API.md`](docs/API.md).

---

## Data & paths

| Path | Contents |
|---|---|
| `~/.config/crucible/config.json` | Main configuration |
| `~/.config/crucible/model_params.json` | Per-model + global default inference params |
| `~/.config/crucible/model_stats.json` | Persisted avg tok/s per model |
| `~/.config/crucible/model_notes.json` | Notes, tags, hidden, preferred_engine |
| `~/.config/crucible/schedules.json` | Scheduled switching rules |
| `~/.config/crucible/workflows.json` | Saved hermes macros |
| `~/.config/crucible/notifications.json` | Notifications feed |
| `~/.config/crucible/session.json` | Active-model persistence (for crash recovery) |
| `~/.config/crucible/session.lock` | fcntl lockfile (do not edit) |
| `~/.config/crucible/warmth_log.jsonl` | Model load event log |
| `~/.config/crucible/auto_bench_results.json` | Auto-benchmark results |
| `~/.config/crucible/hf_updates.json` | HF upstream watcher state |
| `~/.config/crucible/zlab_drafts.json` | z-lab DFlash draft cache (6h TTL) |
| `~/.config/crucible/crucible.db` | SQLite: benchmarks, chat, arena |
| `~/.config/crucible/outputs/` | Saved generated code (per source / run / model) |
| `~/.config/crucible/curator_exports/` | Training JSONL exports |
| `~/.config/crucible/batch_results/` | Batch pipeline job state |
| `~/.config/crucible/niah_jobs/` | NIAH test results |
| `~/.config/crucible/eval_jobs/` | Eval suite results |
| `~/.config/crucible/ensemble_jobs/` | Ensemble run state |
| `~/.config/crucible/finetune_output/` | LoRA adapter outputs + provenance |

---

## Remote access

Crucible is safe to expose over the LAN or via a tunnel if you set `bind_host: "0.0.0.0"` and either (a) set `api_key` or (b) put it behind Cloudflare Access or a reverse proxy's auth.

**Cloudflare Tunnel example (two hostnames):**
- `crucible.example.com` → `http://localhost:3000` (Next.js frontend)
- `crucible-api.example.com` → `http://localhost:7777` (backend, needed for WebSocket metrics)

When Cloudflare Access is the auth layer, leave `api_key` empty. Production mode (`bash run.sh`) is required through tunnels — dev mode's WebSocket HMR doesn't survive.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Browser / PWA  ─────►  Next.js 16 (port 3000)               │
│                         │ rewrites /api/*, /v1/*, /ws/*     │
│                         ▼                                    │
│                        FastAPI (port 7777)                   │
│                         │ dispatches to routers              │
│              ┌──────────┼──────────┬────────────┐            │
│              ▼          ▼          ▼            ▼            │
│          Adapters  Benchmarks   Arena       Agents           │
│              │          │          │            │            │
│              ▼          ▼          ▼            ▼            │
│          oMLX :8000  SQLite    arena_*       hermes-ctrl     │
│          mlx_lm :8010 params   outputs/      :7879           │
│          vllm :8020   webhooks leaderboard                   │
│          llama.cpp :8080                                     │
│          ollama :11434                                       │
└─────────────────────────────────────────────────────────────┘
```

- **Backend is async throughout** — asyncio, aiosqlite, httpx.AsyncClient, aiofiles. No blocking calls on the event loop.
- **Adapter pattern** — each backend implements `load / generate / stop / is_loaded`. The active adapter lives in `app.state.active_adapter`.
- **SSE everywhere** — long-running operations (load, benchmark, chat, arena, download) stream progress as `data: <json>\n\n`. Heartbeat padding defeats proxy buffering.
- **Registry caches model discovery** — refreshed on startup, on-demand via `POST /api/models/refresh`, and after deletes.
- **Config + persistence files** are all JSON under `~/.config/crucible/` except the benchmark/chat/arena DB (SQLite).
- **Frontend** is a Next.js App Router SPA — Zustand stores per domain, shadcn/ui primitives, Recharts for charts.

More: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Development

```bash
cd frontend && pnpm build         # production build
cd frontend && npx tsx lib/model-parse.test.ts   # parser unit tests
cd backend && .venv/bin/python -m tests.test_openai_compat   # OpenAI SDK compat
```

Key conventions:
- Python 3.13, async/await, Pydantic for request bodies, no ORM (raw SQL via `aiosqlite`).
- Frontend API calls go through `lib/api.ts` using relative paths; never hardcode `localhost:7777`.
- Zustand stores in `lib/stores/` — one per domain.
- Per-backend state lives in adapters, not in routers.

---

## Further reading

- [`SPEC.md`](SPEC.md) — detailed feature spec and rationale
- [`docs/API.md`](docs/API.md) — full endpoint reference
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design
- [`docs/HERMES_INTEGRATION.md`](docs/HERMES_INTEGRATION.md) — hermes-agent setup via hermes-control sidecar
- [`docs/OVERNIGHT_TEST_PLAN.md`](docs/OVERNIGHT_TEST_PLAN.md) — walkthrough of every feature
- [`docs/MLX_STUDIO_INTEGRATION.md`](docs/MLX_STUDIO_INTEGRATION.md) — MLX Studio integration notes

---

## License

MIT — see [`LICENSE`](LICENSE).
