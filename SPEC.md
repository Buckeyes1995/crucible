# Crucible — Full Feature Specification

## Phase 1 — Core (Complete)

### 1. Model Registry

**Backend:**
- `scan_mlx(dir)` — walks `mlx_dir`, finds subdirs with `config.json`, parses architecture/context/quant
- `scan_gguf(dir)` — walks `gguf_dir`, finds `.gguf` files and single-file subdirs, parses GGUF metadata
- `scan_ollama(host)` — `GET {host}/api/tags`, returns name + size
- Unified `ModelEntry` schema: `{id, name, kind, path, size_bytes, context_window, quant, backend_meta}`
- Model registry rebuilt on startup and on `POST /api/models/refresh`
- Context window parsed from `config.json` (MLX), GGUF metadata, or Ollama API
- `avg_tps` persisted to `~/.config/crucible/model_stats.json` across restarts
- VL models: context parsed from nested `text_config.max_position_embeddings`

**Frontend — Model Registry page (`/models`):**
- Grid of model cards
- Each card: name, backend badge (color-coded: indigo=MLX, amber=GGUF, emerald=Ollama), size, context window, quant, avg tok/s from history, last loaded time
- Active model: pulsing green dot, "Active" badge — sorts first
- Loading: animated progress bar with stage labels
- Click card → load model (confirm if another is active)
- Search/filter bar: by name, backend kind, tags
- Sort: by name, size, avg tok/s, last used
- Alias display on cards (hover to see configured alias)
- Tags displayed as indigo pills on cards
- Hover icons: notes (StickyNote), params (Settings2)

**Loading flow (SSE):**
```
{event: "stage", data: {stage: "starting", message: "Starting llama-server…"}}
{event: "stage", data: {stage: "loading",  message: "Loading weights…"}}
{event: "stage", data: {stage: "warmup",   message: "Warming up…"}}
{event: "done",  data: {model_id, elapsed_ms}}
{event: "error", data: {message}}
```

---

### 2. Benchmarking (Hero Feature)

#### Run Configuration UI (`/benchmark/new`)

**Step 1 — Select Models:**
- Multi-select from model registry
- Option: "Run same model on all available backends"

**Step 2 — Prompts:**
- Built-in prompt library with categories: Short, Medium, Long, Coding, Reasoning, Creative, Instruction-following
- Multi-select prompts
- Custom prompt input with token count estimate
- Number of reps per prompt (1–10)

**Step 3 — Parameters:**
- Max output tokens (default 2048)
- Temperature (default 0.0 for deterministic benchmarking)
- N warmup runs before timing (default 1)
- Context length override (optional)

**Step 4 — Review & Run**

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

**Note:** Qwen3 thinking models stream tokens in `delta.reasoning` — all adapters handle this fallback.

#### Benchmark Progress (SSE stream)

```
{event: "start",    data: {run_id, total_steps}}
{event: "progress", data: {step, model_id, prompt_id, rep, status}}
{event: "result",   data: {step, model_id, prompt_id, rep, metrics: {...}}}
{event: "done",     data: {run_id, summary}}
{event: "error",    data: {message}}
```

Live progress bar in UI during run. Results populate the chart in real time as each generation completes.

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
- Columns: Model, Backend, Prompt, Reps, TTFT (ms), tok/s mean, tok/s p90, Prompt eval tok/s, Tokens out, Memory, Thermal
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
- Collapsible system prompt field (saved to localStorage)
- Inline controls: temperature slider, max tokens stepper
- Markdown output with syntax-highlighted code blocks, per-block copy button
- Reasoning token display (Qwen3 thinking models)

---

### 5. Settings (`/settings`)

Sections:
- **Backends** — paths and ports for each engine
- **Model Directories** — MLX dir, GGUF dir
- **Ollama** — host URL
- **LAN Serving** — bind_host (127.0.0.1 or 0.0.0.0), API key for external clients
- **Defaults** — default model

Saved to `~/.config/crucible/config.json` via `PUT /api/settings`.

---

## Phase 2 — Ecosystem (Complete)

### 2.1 Per-Model Parameters (`/models` → gear icon)

Per-model overrides for inference parameters. Merges with global defaults (model-specific wins).

**MLX parameters:**
- `temperature`, `max_tokens`, `top_k`, `top_p`, `min_p`, `repetition_penalty`, `presence_penalty`
- `cache_limit_gb` — limits KV cache memory
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

### 2.6 Model Notes and Tagging

- Per-model notes (free text) and comma-separated tags
- Tags shown as indigo pills on model cards
- Tag filter pills in search bar for one-click filtering
- StickyNote hover icon on cards opens notes dialog

**Storage:** `~/.config/crucible/model_notes.json`

**API:**
- `GET /api/models/{id}/notes` — get notes + tags
- `PUT /api/models/{id}/notes` — save notes + tags
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

Planned: Zed settings.json, Aider `.aider.conf.yml` (per-client toggle in settings)

---

### 2.9 OpenAI-Compatible Proxy (`/v1/*`)

Crucible exposes an OpenAI-compatible endpoint for external tools (opencode, aider, etc.):
- `GET /v1/models` — returns active model in OpenAI format
- `POST /v1/chat/completions` — rewrites `"model"` field to full path (fixes mlx_lm 0.31.1 HuggingFace lookup), forwards to adapter

Supports both streaming and non-streaming. Any OpenAI-compatible client pointed at `http://127.0.0.1:7777/v1` works.

---

## Phase 3 — Inference Intelligence (Planned)

See `docs/PHASES_3_4_5.md` for full details.

- **3.1** Multi-model side-by-side chat
- **3.2** Prompt templates & system prompt library with variable substitution
- **3.3** RAG / context injection (BM25, file drop)
- **3.4** Real-time metrics dashboard (tok/s, TTFT, memory — live charts)
- **3.5** Performance regression alerts

## Phase 4 — Ecosystem Integration (Planned)

- **4.1** VS Code extension (status bar, quick-load)
- **4.2** Aider / Zed config sync
- **4.3** Model comparison database (charts over time)
- **4.4** Prompt benchmark marketplace
- **4.5** REST API webhooks

## Phase 5 — Advanced & Experimental (Planned)

- **5.1** Multi-node Forge (mDNS discovery, proxy chat across nodes)
- **5.2** Speculative decoding orchestration
- **5.3** Fine-tune launcher (mlx_lm.lora, live loss chart)
- **5.4** GGUF model merge UI
- **5.5** Local model hub (LAN model sharing)
- **5.6** Thermal & power profiling (powermetrics integration)

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
| `~/.config/crucible/model_params.json` | Per-model + global default parameters |
| `~/.config/crucible/model_stats.json` | Persistent avg_tps per model |
| `~/.config/crucible/model_notes.json` | Notes and tags per model |
| `~/.config/crucible/schedules.json` | Scheduled switching rules |
| `~/.config/crucible/forge.db` | SQLite benchmark history |
