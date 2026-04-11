# Forge — Phase 3, 4, and 5 Planning

## Phase 3 — Inference Intelligence

### 3.1 Multi-Model Chat (Side-by-Side)
- Split-pane chat that sends the same prompt to two loaded models simultaneously
- Requires: two active adapter slots, parallel streaming
- Backend: `/api/chat/compare` endpoint, accepts two model IDs
- Frontend: `SplitChatView` component, synchronized scroll, per-pane tok/s

### 3.2 Prompt Templates & System Prompts Library
- Per-model default system prompt (saved in model params)
- Shared system prompt library: save, name, apply
- Jinja2-style variable substitution in templates (`{{date}}`, `{{context}}`)
- Frontend: template picker in chat sidebar

### 3.3 RAG / Context Injection
- Attach local files or URLs to a chat session
- Simple chunking + BM25 retrieval (no vector DB required)
- Injects retrieved chunks into system message
- Frontend: file drop zone in chat, "context" badge on messages

### 3.4 Inference Metrics Dashboard
- Real-time page showing tok/s, TTFT, memory pressure as live charts
- Recharts line charts with 60-second rolling window
- WebSocket endpoint `/ws/metrics` streaming live stats every second
- Thermal throttling alerts (notification when thermal state degrades)

### 3.5 Model Performance Regression Alerts
- After each benchmark run, compare to historical baseline for that model
- If tok/s drops >10%, flag as regression in history list
- Optional: push macOS notification via the menu bar companion

---

## Phase 4 — Ecosystem Integration

### 4.1 VS Code Extension
- Thin extension that queries `/api/status` and shows active model in status bar
- Click → opens Forge Web UI
- Quick-load command palette entry

### 4.2 Aider / Zed Config Sync
- Extend `clients.py` to also write Aider's `.aider.conf.yml` and Zed's `settings.json`
- `sync_all_clients(model_id)` called alongside `sync_opencode`
- Config: per-client enable/disable toggle in Settings

### 4.3 Model Comparison Database
- Track all benchmark results across time with schema version
- Automatic chart: "tok/s over time for this model" on model detail page
- Export: full SQLite or CSV archive

### 4.4 Prompt Benchmark Marketplace
- Community prompt library synced from a GitHub-hosted JSON file
- Categories: code generation, instruction following, long-context, math, reasoning
- Download and add to local library with one click

### 4.5 REST API Webhooks
- `POST /api/webhooks` — register a URL to call on events
- Events: `model.loaded`, `model.unloaded`, `benchmark.done`, `download.done`
- Payload includes model ID, timestamp, relevant metrics
- Useful for home automation (HA), custom dashboards, Slack/Discord notifications

---

## Phase 5 — Advanced & Experimental

### 5.1 Multi-Node Forge
- Forge instances on multiple machines (e.g. Mac Studio + Mac Mini)
- Primary Forge discovers peers via mDNS or static config
- Can proxy chat/benchmark to remote Forge instances
- Frontend: node selector in model list, benchmark across nodes

### 5.2 Speculative Decoding Orchestration
- Automatically pair a small draft model with a large target model
- UI: "Enable speculative decoding" toggle on model card
- Forge manages both processes and the draft→target handoff
- Measures actual speedup vs. solo target model in benchmarks

### 5.3 Fine-tune Launcher
- UI to configure and launch `mlx_lm.lora` fine-tuning jobs
- Dataset picker (local JSONL files), LoRA hyperparams
- Live training loss chart via SSE
- Auto-register the resulting adapter as a model variant

### 5.4 GGUF Model Merge UI
- Wrapper around `llama-merge` / MergeKit
- Select base + delta models, merge method (SLERP, TIES, DARE)
- Progress stream, auto-register result
- Compare merged model vs. base in benchmark

### 5.5 Local Model Hub
- Full-featured alternative to HuggingFace for local-first model sharing
- Serve your quantized models to other machines on LAN
- Simple HTTP directory listing with model card metadata
- Other Forge instances can browse and download

### 5.6 Thermal & Power Profiling
- Integrate with macOS `powermetrics` to capture ANE/GPU/CPU power
- Attach watts/token to benchmark results
- Efficiency chart: tok/s per watt across models
- Useful for comparing quantization vs. power trade-off

---

## Implementation Priority Notes

| Phase | Effort | Value | Suggested order |
|---|---|---|---|
| 3.1 Side-by-side chat | Medium | High | First in P3 |
| 3.4 Metrics dashboard | Low | High | Quick win |
| 4.2 Aider/Zed sync | Low | Medium | Extend existing clients.py |
| 4.5 Webhooks | Low | High | Enables automation |
| 3.3 RAG | High | Medium | Later |
| 5.2 Speculative decoding | Medium | High | Depends on mlx_lm support |
| 5.1 Multi-node | High | Medium | Needs network design |
| 5.3 Fine-tune | High | High | High user value |
