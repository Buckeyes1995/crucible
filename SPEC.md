# Crucible — Full Feature Specification

## Phase 1 — Core (Complete)

### 1. Model Registry

**Backend:**
- `scan_mlx(dir)` — walks `mlx_dir`, finds subdirs with `config.json`, parses architecture/context/quant
- `scan_gguf(dir)` — walks `gguf_dir`, finds `.gguf` files and single-file subdirs, parses GGUF metadata
- `scan_ollama(host)` — `GET {host}/api/tags`, returns name + size
- Unified `ModelEntry` schema: `{id, name, kind, path, size_bytes, context_window, quant, backend_meta, hidden}`
- Model registry rebuilt on startup and on `POST /api/models/refresh`
- Context window parsed from `config.json` (MLX), GGUF metadata, or Ollama API
- `avg_tps` persisted to `~/.config/crucible/model_stats.json` across restarts
- VL models: context parsed from nested `text_config.max_position_embeddings`

**Frontend — Model Registry page (`/models`):**
- Grid of model cards
- Each card: name, backend badge (color-coded: indigo=MLX, amber=GGUF, emerald=Ollama), size, context window, quant, avg tok/s from history, last loaded time
- Active model: pulsing green dot, "Active" badge — sorts first
- Loading: animated progress bar with stage labels, Cancel button
- Stop Loading button in header while any model is loading
- Click card → load model (confirm if another is active)
- Search/filter bar: by name, backend kind, tags
- Sort: by name, size, avg tok/s, last used
- Alias display on cards (hover to see configured alias)
- Tags displayed as indigo pills on cards
- Hide/unhide models — hidden models filtered from list by default, "Hidden (N)" toggle to reveal
- Hover icons: notes (StickyNote), params (Settings2), hide (EyeOff)

**Loading flow (SSE):**
```
{event: "stage", data: {stage: "starting", message: "Starting llama-server…"}}
{event: "stage", data: {stage: "loading",  message: "Loading weights…"}}
{event: "stage", data: {stage: "warmup",   message: "Warming up…"}}
{event: "done",  data: {model_id, elapsed_ms}}
{event: "error", data: {message}}
```

**GGUF loading fixes:**
- `kill_port` uses `-sTCP:LISTEN` so only the listening server is killed (not browser client connections)
- First SSE event is yielded before blocking on `kill_port` to keep the browser connection alive
- `stderr=PIPE` on llama-server subprocess — last 5 lines of stderr included in error messages

---

### 2. Benchmarking (Hero Feature)

#### New Benchmark UI (`/benchmark2`) — Redesigned

Two-pane layout:
- **Left rail (320px):** config steps, always-visible Run button at bottom
  - Step 1: Models — checkbox list with search filter, LOADED badge, internal scroll so steps 2/3 always visible
  - Step 2: Prompts — Quick / Standard / Deep / Custom preset cards; Custom shows category chips + custom text input
  - Step 3: Settings — collapsed accordion with reps, max tokens, temperature, run name
  - Temperature auto-populated from selected model's merged params
  - Run button shows `Nm × Pp × Rr` summary; disabled with hints when config incomplete
- **Right panel:** idle = recent history; loading = spinner; running/done = live per-model summary cards

**Per-model summary cards (live):**
- Avg tok/s, Best tok/s, Avg TTFT
- Per-prompt result rows with tok/s
- Progress indicator while running

#### Metrics Collected Per Generation

| Metric | Source |
|---|---|
| TTFT (ms) | Time from request to first token byte |
| Throughput tok/s | output_tokens / total_generation_time |
| Prompt eval tok/s | prompt_tokens / prompt_eval_time |
| p50/p90/p99 tok/s | streaming token timestamps |
| Total generation time (ms) | wall clock |
| Output token count | from response |
| Memory pressure at start | macOS `vm_stat` |
| Memory pressure peak | polled during run |
| Thermal state | macOS IOKit sysctl |
| CPU watts / GPU watts / ANE watts | powermetrics (if available) |

**Note:** Qwen3 thinking models stream tokens in `delta.reasoning` — all adapters handle this fallback.

#### Benchmark Progress (SSE stream)

```
{event: "start",    data: {run_id, total_steps}}
{event: "progress", data: {step, model_id, prompt_id, rep, status}}
{event: "result",   data: {step, model_id, prompt_id, rep, metrics: {...}}}
{event: "done",     data: {run_id, summary}}
{event: "error",    data: {message}}
```

#### Results View (`/benchmark/run/{id}`)

**Chart 1 — Throughput Bar Chart (hero)**
- X axis: model names, Y axis: tok/s, bars grouped by backend kind
- Hover tooltip: all metrics

**Chart 2 — TTFT Bar Chart**

**Chart 3 — Token Stream Chart**
- Line chart: time (ms) on X, cumulative tokens on Y
- One line per model/backend

**Chart 4 — Prompt Comparison**
- Grouped bars per prompt category

**Metrics Table**
- Columns: Model, Backend, Prompt, Reps, TTFT (ms), tok/s mean, tok/s p90, Prompt eval tok/s, Tokens out, Memory, Thermal, CPU W, GPU W
- Sortable, export JSON/CSV/Markdown

**Baseline Comparison**
- Select any model as baseline; others show delta % color-coded

---

### 3. Benchmark History (`/benchmark/history`)

**SQLite schema:**
```sql
CREATE TABLE benchmark_runs (id, created_at, name, config_json, summary_json);
CREATE TABLE benchmark_results (id, run_id, model_id, model_name, backend_kind, prompt_id, prompt_text, rep, metrics_json);
```

**History list view:** table with date, run name, models, prompts, best tok/s

**Overlay / Trend view:** select 2+ runs → overlay tok/s bars; line chart over time

**Compare Two Runs:** side-by-side diff table, highlights metrics changed >5%

---

### 4. Chat / Quick Test (`/chat`)

- Streaming chat with active model via SSE
- Real-time stats bar: TTFT and tok/s update as tokens arrive
- Multi-turn conversation, scrollable history
- "New Chat" clears history
- System prompt bar with template picker (BookOpen dropdown)
- RAG context bar: attach files, "Use context" checkbox, chunk count display
- Inline controls: temperature slider, max tokens input (default 8192, max 32768)
- Prompt tok/s shown in live metrics (from `usage.prompt_tokens_per_second` or computed from TTFT)

---

### 5. Settings (`/settings`)

Sections:
- **Backends** — paths and ports for each engine
- **Model Directories** — MLX dir, GGUF dir
- **Ollama** — host URL
- **LAN Serving** — bind_host (127.0.0.1 or 0.0.0.0), API key for external clients
- **Defaults** — default model
- **Prompt Templates** — CRUD for saved system prompt templates (name, description, content)

Saved to `~/.config/crucible/config.json` via `PUT /api/settings`.

---

## Phase 2 — Ecosystem (Complete)

### 2.1 Per-Model Parameters (`/models` → gear icon)

Per-model overrides for inference parameters. Merges with global defaults (model-specific wins).

**MLX parameters:**
- `temperature`, `max_tokens`, `top_k`, `top_p`, `min_p`, `repetition_penalty`, `presence_penalty`
- `cache_limit_gb` — limits KV cache memory
- `draft_model` — path to draft model for speculative decoding
- `num_draft_tokens` — speculative decoding draft count

**GGUF / llama.cpp parameters:**
- `temperature`, `max_tokens`, `top_k`, `top_p`, `min_p`, `repetition_penalty`, `presence_penalty`
- `batch_size`, `ubatch_size`, `threads`
- `flash_attn` (boolean)
- `cache_type_k`, `cache_type_v` — KV cache quantization (f16, q8_0, q4_0, q4_1, iq4_nl, q5_0, q5_1)

**TTL:**
- `ttl_minutes` — auto-unload after N minutes of idle; 0 = never

**Storage:** `~/.config/crucible/model_params.json`

**API:**
- `GET /api/models/{id}/params` — model-only params (no merge)
- `PUT /api/models/{id}/params` — save model params
- `DELETE /api/models/{id}/params` — reset to defaults
- `GET /api/params/defaults` — global defaults
- `PUT /api/params/defaults` — save global defaults
- `DELETE /api/params/defaults` — reset global defaults

---

### 2.2 Global Default Parameters

Global defaults pre-populated with Qwen-recommended values:
- temperature=0.7, max_tokens=2048, top_k=20, top_p=0.8, min_p=0.0
- repetition_penalty=1.0, presence_penalty=0.0

Per-model dialog shows global default as placeholder text in each field.

Access via ⚙ "Global Defaults" button in model page filter bar.

---

### 2.3 HuggingFace Download UI (`/downloads`)

- Search HuggingFace model hub with debounce
- Filter by kind (MLX / GGUF)
- Download queue with progress tracking
- SSE stream shows download progress (size-based polling)
- Cancel in-progress downloads
- Auto-detects dest dir from config (mlx_dir / gguf_dir)

**Backend:** `hf_downloader.py` using `huggingface_hub.snapshot_download` in thread executor

**API:**
- `GET /api/hf/search?q={query}&kind={mlx|gguf}` — search HuggingFace
- `POST /api/hf/download` — start download job
- `GET /api/hf/downloads` — list all jobs
- `GET /api/hf/download/{id}/stream` — SSE progress stream

---

### 2.4 Menu Bar Companion (`menubar/`)

macOS menu bar app (Python + rumps):
- Shows active model name + memory pressure % in title
- Spinner (⟳) during loading
- Dynamic model list for quick switching
- Stop model button
- Open Web UI button
- Polls `/api/status` and `/api/models` every 10 seconds

**Setup:** `cd menubar && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && python crucible_menubar.py`

---

### 2.5 LAN Serving

- `bind_host` setting: `127.0.0.1` (local only) or `0.0.0.0` (LAN)
- `api_key` setting: if set, required in `Authorization: Bearer <key>` header for non-localhost clients
- Auth middleware skips localhost requests
- `run.sh` reads `bind_host` from config dynamically

---

### 2.6 Model Notes, Tagging, and Hiding

- Per-model notes (free text) and comma-separated tags
- Tags shown as indigo pills on model cards
- Tag filter pills in search bar for one-click filtering
- StickyNote hover icon on cards opens notes dialog
- **Hide/unhide models:** EyeOff icon on card hover; hidden models excluded from model list and benchmark by default; "Hidden (N)" toggle in filter bar to reveal; persists across restarts

**Storage:** `~/.config/crucible/model_notes.json`

**API:**
- `GET /api/models/{id}/notes` — get notes + tags + hidden flag
- `PUT /api/models/{id}/notes` — save notes + tags (preserves hidden)
- `PUT /api/models/{id}/hidden` — set hidden: true/false
- `GET /api/tags` — all unique tags

---

### 2.7 Scheduled Model Switching (`/schedules`)

- Define rules: day(s) of week + hour + minute → load model
- Enable/disable individual rules
- Scheduler checks every 30 seconds
- Rules fire within the 30s window of their scheduled time

**Storage:** `~/.config/crucible/schedules.json`

**API:** CRUD at `/api/schedules` and `/api/schedules/{id}`

---

### 2.8 Client Config Sync

On model load, Crucible automatically updates:
- **opencode** — `~/.config/opencode/opencode.json` (model name + baseURL `http://127.0.0.1:7777/v1`)
- **Aider** — `.aider.conf.yml` in home dir
- **Zed** — `~/.config/zed/settings.json`

---

### 2.9 OpenAI-Compatible Proxy (`/v1/*`)

Crucible exposes an OpenAI-compatible endpoint for external tools (opencode, aider, etc.):
- `GET /v1/models` — returns active model in OpenAI format
- `POST /v1/chat/completions` — rewrites `"model"` field to full path (fixes mlx_lm 0.31.1 HuggingFace lookup), forwards to adapter

Supports both streaming and non-streaming. Any OpenAI-compatible client pointed at `http://127.0.0.1:7777/v1` works.

---

## Phase 3 — Inference Intelligence (Complete)

### 3.1 Multi-Model Side-by-Side Chat (`/chat/compare`)

- Split-pane layout: two independent chat sessions, same prompt sent to both
- Model A: active model; Model B: independently loaded via compare adapter slot
- Real-time streaming to both panes simultaneously
- Stats bar per pane: TTFT, tok/s

---

### 3.2 Prompt Templates

- Named system prompt templates with optional description
- Template picker in chat system prompt bar (BookOpen dropdown)
- Full CRUD in Settings → Prompt Templates section

**Storage:** `~/.config/crucible/prompt_templates.json`

**API:**
- `GET /api/templates` — list all templates
- `POST /api/templates` — create template
- `PUT /api/templates/{id}` — update template
- `DELETE /api/templates/{id}` — delete template

---

### 3.3 RAG / Context Injection

Pure-Python BM25 retrieval, no external dependencies.

- File upload in chat context bar (txt, md, py, ts, tsx, js, json, csv, yaml, html, rst)
- Files chunked at 400 words with 80-word overlap
- BM25 scoring for top-k retrieval at chat time
- Retrieved context injected as system message before user turn
- Session-scoped: each chat session has its own RAG store
- "Use context" checkbox to enable/disable per-message
- File chips show name + chunk count

**Backend:** `rag.py` — `BM25` class, `get_context(session_id, query, k)`, file/text ingestion

**API:**
- `POST /api/rag/{session_id}/upload` — upload file, returns chunk count
- `POST /api/rag/{session_id}/add-text` — add raw text
- `GET /api/rag/{session_id}/context?q={query}` — retrieve top-k chunks
- `GET /api/rag/{session_id}/info` — session stats
- `DELETE /api/rag/{session_id}` — clear session

---

### 3.4 Real-Time Metrics Dashboard (`/metrics`)

Live charts updated via WebSocket, polling `/api/status` every second:
- Tok/s sparkline (rolling 60s window)
- TTFT bar
- Memory pressure gauge
- Thermal state badge
- Prompt tok/s metric
- CPU / GPU / ANE watts (when powermetrics available)

---

### 3.5 Performance Regression Alerts

- After each benchmark run, compare avg tok/s to rolling baseline (last N runs for same model)
- Regression threshold configurable (default 10%)
- Alert badge on history list rows
- AlertTriangle icon on benchmark2 history entries

---

## Phase 4 — Ecosystem Integration (Complete)

### 4.2 Aider / Zed Config Sync

On model load, updates:
- `~/.aider.conf.yml` — `model: openai/{model_name}`, `openai-api-base`, `openai-api-key`
- `~/.config/zed/settings.json` — `language_models.openai` provider with model + api_url

---

### 4.3 Model History Charts

Per-model tok/s trend chart on model cards:
- Recharts sparkline showing last N benchmark results
- `GET /api/benchmark/model/{id}/history` — returns time-series data

---

### 4.4 Prompt Benchmark Marketplace

Built-in curated prompt library with categories (Short, Medium, Long, Coding, Reasoning, Math).
Presets map category names to prompt ID lists:
- **Quick** — 3 prompts, ~30s
- **Standard** — 7 prompts, ~2 min
- **Deep** — all prompts, ~10 min
- **Custom** — pick by category chip or add your own

**API:**
- `GET /api/benchmark/prompts` — all built-in prompts
- `GET /api/benchmark/presets` — preset name → prompt ID list

---

### 4.5 REST API Webhooks

- Fire HTTP POST on model load/unload events
- Configurable URL + optional secret in Settings

---

## Phase 5 — Advanced & Experimental (Implemented)

### 5.2 Speculative Decoding

- `draft_model` param in per-model MLX parameters
- Passed as `--draft-model` to `mlx_lm.server` on load
- `num_draft_tokens` controls draft count

---

### 5.3 Fine-Tune Launcher (`/finetune`)

- Create fine-tune jobs with model path, dataset path, output dir, learning rate, iterations, batch size
- Runs `mlx_lm.lora` as subprocess
- SSE stream of training output with loss parsing (regex `Iter \d+.*Train loss [\d.]+`)
- Live Recharts loss chart: train loss (indigo) + val loss (amber)
- Job list with status, Play/Stop/Delete actions
- Job persistence across restarts

**Backend:** `finetune.py` — `FinetuneJob` dataclass, `run_job()` async generator, `cancel_job()`

**Storage:** `~/.config/crucible/finetune_jobs.json`

**API:**
- `GET /api/finetune/jobs` — list jobs
- `POST /api/finetune/jobs` — create job
- `POST /api/finetune/jobs/{id}/run` — start job (SSE)
- `POST /api/finetune/jobs/{id}/cancel` — cancel
- `DELETE /api/finetune/jobs/{id}` — delete

---

### 5.6 Thermal & Power Profiling

- `PowerSampler` class runs `sudo -n powermetrics --samplers cpu_power -i 500 -f json`
- Wraps each benchmark rep to capture CPU/GPU/ANE watts
- Power stats merged into benchmark metrics: `cpu_watts`, `gpu_watts`, `ane_watts`
- Shown in benchmark results table and model summary cards

**Backend:** `powermetrics.py` — `PowerSampler.start()` / `stop()`

---

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
| `~/.config/crucible/model_stats.json` | Persistent avg_tps per model |
| `~/.config/crucible/model_notes.json` | Notes, tags, and hidden flag per model |
| `~/.config/crucible/schedules.json` | Scheduled switching rules |
| `~/.config/crucible/prompt_templates.json` | Saved system prompt templates |
| `~/.config/crucible/finetune_jobs.json` | Fine-tune job definitions |
| `~/.config/crucible/crucible.db` | SQLite benchmark history |
