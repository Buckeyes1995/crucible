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

### 4.6 Remote Nodes (Multi-Node Cluster)

Connect multiple Crucible instances into a cluster. A "hub" node discovers and can load/chat/benchmark models on remote "spoke" nodes.

**Backend:**
- `NodeConfig` in config: `name`, `url`, `api_key` per remote node
- `scan_remote_node()` in registry — queries remote `/api/models`, imports entries with `node=<name>` and IDs prefixed `@<name>/`
- Anti-recursion: skips models where `node != "local"` on the remote side (no transitive proxying)
- `RemoteNodeAdapter` (`adapters/remote_node.py`) — full adapter implementing load/stop/chat via HTTP to the remote Crucible API
  - Load: SSE proxy of remote's `/api/models/{id}/load` stream
  - Chat: streaming proxy of remote's `/v1/chat/completions`
  - Stop: `POST /api/models/stop` on remote
  - Discovers `_server_model_id` from remote `/v1/models` after load (for proxy compatibility)
- `GET /api/nodes` — returns connectivity status, model count, active model, memory/thermal for all configured nodes (parallelized)
- Registry scanning parallelized with `asyncio.gather` for all nodes
- `backend_meta` internal routing fields (`_remote_url`, `_remote_api_key`, `_remote_model_id`) stripped before serialization to frontend

**Frontend:**
- Models page: node filter buttons (All nodes / Local / @node-name), `@node` badge on remote model cards
- Settings page: Remote Nodes section — add/remove nodes (name, URL, API key), connectivity test with status dots (green=online), model count, active model, memory %
- `api.ts`: `NodeConfig`, `NodeStatus` types, `api.nodes.list()`

**Config:**
```json
{
  "nodes": [
    {"name": "mac-mini", "url": "http://192.168.1.181:7777", "api_key": ""}
  ]
}
```

**ModelEntry extension:** `node` field — `"local"` (default) or remote node name.

**Adapter routing:** `models.py`, `benchmark.py` check `model.node != "local"` before kind-based adapter selection. Remote models use `RemoteNodeAdapter`; local models use the existing kind-based logic.

---

## Phase 5 — Advanced & Experimental (Implemented)

### 5.2 Speculative Decoding

#### Legacy (mlx_lm.server)
- `draft_model` param in per-model MLX parameters
- Passed as `--draft-model` to `mlx_lm.server` on load
- `num_draft_tokens` controls draft count

#### DFlash (oMLX 0.3.5+)

Block diffusion speculative decoding via oMLX's DFlashEngine. A small draft model proposes 16 tokens at once via block diffusion, verified by the target model in a single pass. All accepted tokens are lossless.

**Eligible models:** MLX models with a matching `*-DFlash` sibling directory in the model dir. Current drafts:
- `Qwen3-Coder-Next-DFlash` → targets Qwen3-Coder-Next-MLX-{4,6}bit
- `Qwen3-Coder-30B-A3B-DFlash` → targets Qwen3-Coder-30B-A3B-Instruct-MLX-8bit
- `Qwen3.5-9B-DFlash` → targets Qwen3.5-9B-MLX-4bit
- `Qwen3.5-27B-DFlash` → targets Qwen3.5-27B-* (base, not distilled)
- `Qwen3.5-35B-A3B-DFlash` → targets Qwen3.5-35B-A3B-8bit

**Backend:**
- `omlx_admin.py` — client for oMLX admin API (session-cookie auth)
- `find_dflash_draft()` — matches target models to draft dirs by stripping quant/format suffixes
- `GET /api/models/{id}/dflash` — eligibility + current state
- `PUT /api/models/{id}/dflash` — toggle DFlash via oMLX admin API
- `scan_mlx()` skips `*-DFlash` directories from model list
- `_annotate_hidden()` reads oMLX `model_settings.json` to sync `dflash_enabled` state

**Frontend:**
- DFlash badge (Bolt icon) on eligible model cards — amber when enabled, zinc when disabled
- Click badge to toggle on/off
- Badge hidden for non-eligible models

**Constraints:**
- Single-request processing (no continuous batching in DFlash mode)
- Falls back to BatchedEngine when context > `DFLASH_MAX_CTX` (default 4096)
- Draft model quantized to 4-bit by default to save memory

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

## Phase 6 — Intelligence & Insights (Complete)

### 6.1 Model Arena (`/arena`)

Blind A/B testing with ELO ratings. Two random MLX models compete anonymously — user enters a prompt, both stream responses side-by-side via oMLX, then votes on the winner. ELO ratings (K=32, start=1500) tracked in SQLite. Leaderboard page shows rankings, win rates, and recent battle history.

### 6.2 DFlash Benchmark Dashboard (`/dflash`)

One-click DFlash vs Normal speed comparison for eligible models. Runs same prompts with DFlash off then on, shows speedup multiplier hero stat, tok/s and TTFT comparison bar charts, per-prompt results table.

### 6.3 Smart Router (`/router`)

Auto model selection based on prompt content analysis. Classifies prompts into code/math/reasoning/short/long categories using regex pattern matching. Configurable routing rules with model pattern matching and size filters. Integrated into `/v1/chat/completions` proxy for transparent routing to external tools. Settings page with rule editor and test classifier.

### 6.4 Inference Profiler (`/profiler`)

Records every chat inference to SQLite with prefill/decode time split, tok/s, TTFT, memory pressure, and thermal state. Dashboard shows per-model aggregate stats, throughput chart, prefill vs decode pie chart, and per-request timeline with inline time breakdown bars.

### 6.5 Model Recommender (`/recommender`)

Analyzes model library for redundancy (multiple quants of same base), unused models, slow performers, and DFlash opportunities. Shows size distribution pie chart, insights (RAM warnings, DFlash tips), and prioritized recommendations with actionable advice.

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
  "api_key":        "",
  "nodes":          []
}
```

## Data Files

| File | Purpose |
|---|---|
| `~/.config/crucible/config.json` | Main config |
| `~/.config/crucible/model_params.json` | Per-model + global default inference parameters |
| `~/.config/crucible/model_stats.json` | Persistent avg_tps per model |
| `~/.config/crucible/model_notes.json` | Notes, tags, hidden flag, and preferred_engine per model |
| `~/.config/crucible/schedules.json` | Scheduled switching rules |
| `~/.config/crucible/prompt_templates.json` | Saved system prompt templates |
| `~/.config/crucible/finetune_jobs.json` | Fine-tune job definitions |
| `~/.config/crucible/zlab_drafts.json` | Cached z-lab HF repo list (6h TTL) |
| `~/.config/crucible/hf_updates.json` | Per-model origin HF repo + upstream lastModified state |
| `~/.config/crucible/crucible.db` | SQLite benchmark history |

---

## Phase 7 — Engine Expansion & HF Watchers (Complete)

### 1. vLLM Adapter (vllm-metal)

- New `kind="vllm"` backend; models discovered from `config.vllm_dir` (HF-format safetensors — vLLM-metal cannot load mlx-quantized dirs)
- `backend/adapters/vllm.py` — subprocess manager shelling out to `vllm serve <path> --port <port>`
- OpenAI-compatible API polled at `/v1/models` for readiness (up to 900s cold-start to accommodate Metal kernel compile + weight load)
- Ports: 8020 (default), 8021 (compare slot)
- Cyan badge + "vLLM" filter button on the Models page
- Install: `curl -fsSL https://raw.githubusercontent.com/vllm-project/vllm-metal/main/install.sh | bash`

### 2. Preferred Engine per Model

- `ENGINES_BY_KIND` map in `routers/models.py`: `mlx → [omlx, mlx_lm]`, `vllm → [vllm]`, `gguf → [llama_cpp]`, `ollama → [ollama]`, `mlx_studio → [mlx_studio]`
- Per-model preference stored in `model_notes.json` as `preferred_engine`
- Routing via `_resolve_engine(model, override)`: query-string `?engine=` override > notes preference > first available
- `ModelEntry.available_engines` + `preferred_engine` surfaced to the frontend
- Notes dialog gains an engine dropdown — only visible when `available_engines.length > 1` (today: MLX models only)
- `/api/models/{id}/load?engine=<name>` supports ad-hoc overrides without changing the saved preference

### 3. z-lab DFlash Draft Tracker

- `backend/zlab.py` — fetches the `z-lab` HF org model list (https://huggingface.co/api/models?author=z-lab), caches in `~/.config/crucible/zlab_drafts.json` with 6h TTL
- `match_draft_for(model_name, repos)` normalizes quant/format suffixes (`-8bit`, `-MXFP4`, `-MLX`, `-CRACK`, etc.) and looks for a `{base}-DFlash` z-lab repo
- Annotated on `ModelEntry.available_draft_repo` only when no local `dflash_draft` already exists and kind ∈ {mlx, gguf, vllm}
- Amber "Draft available" pill on the model card → click triggers `POST /api/zlab/drafts/download`, which uses the existing `hf_downloader` to pull the draft into `config.mlx_dir`
- After download completes, the existing `find_dflash_draft()` picks up the new sibling dir and the pill flips to the DFlash toggle button

### 4. HuggingFace Upstream Update Watcher

- `backend/hf_updates.py` tracks per-model `origin_repo` + `downloaded_at` + `upstream_last_modified` in `~/.config/crucible/hf_updates.json`
- `seed_from_downloads(jobs)` — on startup, auto-fills `origin_repo` from completed `hf_downloader` jobs
- `check_models(ids)` — concurrent GET on `/api/models/{repo_id}` for each tracked model; flags `update_available` when upstream `lastModified` > our `downloaded_at`
- Initial check fires as a background task on startup; full re-check on demand via `POST /api/hf-updates/refresh`
- Newly-flagged updates push to the Notifications feed (producer pattern — reuses existing `notifications.push()`)
- Frontend: sky-blue "New version" pill on the model card linking to `huggingface.co/{origin_repo}`, plus an editable "Origin HF repo" field in the Notes dialog for pre-existing models

### 5. Schema Additions

```python
class ModelEntry:
    # ... existing fields
    available_engines: list[str]          # computed from kind
    preferred_engine: str | None          # from model_notes.json
    available_draft_repo: str | None      # z-lab matching draft repo
    origin_repo: str | None               # HF repo we downloaded from
    update_available: bool                # upstream is newer than our copy
    upstream_last_modified: str | None    # ISO-8601 from HF
```
