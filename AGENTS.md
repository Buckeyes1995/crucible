# Forge — Agent Instructions

> These instructions are specific to the Forge project and supplement the global AGENTS.md rules.
> Global rules still apply. When in conflict, these project rules take precedence.

---

## What Is Forge

A local LLM management and benchmarking web application.

- **Backend:** Python 3.13 + FastAPI, port 7777, at `backend/`
- **Frontend:** Next.js 15 + TypeScript + Tailwind v4 + shadcn/ui, port 3000, at `frontend/`
- **Database:** SQLite via `aiosqlite` at `backend/forge.db` — raw SQL, no ORM
- **Package managers:** `uv` for Python (or the project venv), `pnpm` for JS

Read `CLAUDE.md` for full context. Read `SPEC.md` for feature detail before implementing anything.

---

## Commands

```bash
# Start everything
bash run.sh

# Backend only
cd backend && source .venv/bin/activate && uvicorn main:app --reload --port 7777

# Frontend only
cd frontend && pnpm dev

# Backend setup (first time)
cd backend && /opt/homebrew/bin/python3.13 -m venv .venv && source .venv/bin/activate
pip install fastapi uvicorn aiosqlite aiofiles sse-starlette pydantic psutil

# Frontend setup (first time)
cd frontend && pnpm install
```

---

## Project Structure

```
forge/
  backend/
    main.py             FastAPI app entry point
    config.py           load/save ~/.config/forge/config.json
    db/                 SQLite schema + helpers
    adapters/           one module per backend (llama_cpp, mlx_lm, ollama)
    benchmark/          benchmark engine + metrics collection
    routers/            FastAPI route handlers
  frontend/
    app/                Next.js App Router pages
    components/         shared React components
    lib/                API client (api.ts), SSE helper, Zustand stores
  docs/
    API.md              full API reference
    ARCHITECTURE.md     file structure + data flow
  CLAUDE.md             full context doc
  SPEC.md               feature specification
  run.sh                starts both services
```

---

## Inference Backends

| Backend | Kind string | Control method | Default port |
|---|---|---|---|
| llama-server (llama.cpp) | `"gguf"` | subprocess | 8080 |
| mlx_lm.server | `"mlx"` | subprocess | 8000 |
| Ollama | `"ollama"` | external daemon, HTTP | 11434 |

- **Never hardcode ports** — read from config
- Ollama is NOT spawned by Forge — it runs as a system daemon
- llama-server and mlx_lm.server ARE spawned as subprocesses by Forge
- Use `asyncio.create_subprocess_exec` — never blocking `subprocess.run`

---

## API Contract

All routes are under `/api/`. Full reference in `docs/API.md`.

Key routes:
- `GET /api/models` — all models, all backends
- `POST /api/models/{id}/load` — SSE stream for loading progress
- `POST /api/chat` — SSE stream for streaming chat
- `POST /api/benchmark/run` — SSE stream for benchmark progress + results
- `GET /api/benchmark/history` — past runs
- `GET/PUT /api/settings` — config

**SSE format:** `data: <json>\n\n` with an `event` field on all messages.

---

## Backend Rules

- Fully async throughout — `async def` everywhere, `await` all I/O
- Never block the event loop — no `time.sleep`, no `subprocess.run`, no sync file I/O
- Use `aiosqlite` for all database access
- Use `aiofiles` for file reads
- Config file: `~/.config/forge/config.json` — created with defaults on first run
- One active model at a time — enforce with an asyncio lock

---

## Frontend Rules

- All API calls go through `lib/api.ts` — never fetch backend URLs directly in components
- Zustand stores in `lib/stores/` — one per domain (models, benchmark, chat, settings)
- Use shadcn/ui for base components — don't reinvent buttons, dialogs, inputs, tabs
- Use Recharts for all charts — no Chart.js, no D3 directly
- Dark mode default — `zinc-950`/`zinc-900` backgrounds, `indigo-500` accent
- JetBrains Mono for metric readouts and code; Inter for all other UI text

---

## UI Design Principles

- **Glass cards:** `backdrop-blur` + `border-white/10`
- **Status dots:** colored with pulse animation for live state
- **Charts:** dark background, minimal gridlines, accent primary series
- **Motion:** subtle only — fade-in on load, skeleton loaders. No gratuitous animation
- **Layout:** collapsible left sidebar, main content area

---

## Phased Work Plan

See `SPEC.md` for full detail. High-level:

### Phase 1 (current)
1. Backend scaffold + config + SQLite schema
2. Three backend adapters (llama_cpp, mlx_lm, ollama)
3. Model registry (scan + unified list)
4. Model loading with SSE progress
5. Benchmark engine with all metrics
6. Benchmark history storage + API
7. Chat with SSE streaming
8. Frontend shell (sidebar, pages)
9. Model registry UI
10. Benchmark run wizard + results charts
11. Benchmark history UI
12. Chat UI
13. Settings page

### Phase 2 (later — do not implement now)
- HuggingFace download UI
- macOS menu bar companion app
- vLLM backend
- LAN serving

**Stop at the end of each phase and wait for user instruction before continuing.**

---

## Verification

After any backend change:
```bash
cd backend && python -m py_compile main.py && echo OK
```

After frontend changes:
```bash
cd frontend && pnpm build 2>&1 | tail -20
```

Before declaring any feature complete, verify it actually runs — start the server and hit the endpoint.
