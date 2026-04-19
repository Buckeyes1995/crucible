# Crucible API Reference

Base URL: `http://localhost:7777`

All SSE streams: `Content-Type: text/event-stream`, format `data: <json>\n\n`. Most
streams use a `chunk.event` field (e.g. `token`, `done`, `error`) rather than the
traditional `event:` header, so readers can switch on a single JSON payload.

> This reference is a pragmatic map of the HTTP surface exposed by the routers in
> `backend/routers/`. It covers the common payloads; request bodies and query
> params that aren't listed are either optional or inferable from the router
> source.

---

## Models & status

### GET /api/models
All models across all configured backends. Each `ModelEntry` carries id, kind,
size_bytes, quant, available_engines, preferred_engine, dflash state,
available_draft_repo, origin_repo, update_available, hidden flag, tags, notes,
avg_tok_per_sec, last_loaded.

### POST /api/models/refresh
Re-scan directories + remote nodes. Same response shape as GET.

### POST /api/models/{id}/load
Loads a model. SSE stream with `stage`, `progress`, `done`, `error` events.
Query param `engine=omlx|mlx_lm|...` overrides saved preference for this load.

### POST /api/models/stop
Stops the active model/engine.

### PUT /api/models/{id}/preferred-engine
Body: `{"engine": "omlx" | "mlx_lm" | null}`. Null clears.

### PUT /api/models/{id}/hidden
Body: `{"hidden": true}`.

### GET /api/status
```json
{"active_model_id": "...", "engine_state": "ready",
 "memory_pressure": "nominal", "thermal_state": "nominal", "uptime_s": 342}
```

---

## Chat

### POST /api/chat
SSE stream. Body: `{model_id?, messages, temperature?, max_tokens?, session_id?}`.
Emits `delta`, `stats`, `done`, `error`. Persists to chat history when `session_id`
is provided or generated server-side.

### GET /api/chat/history
List sessions. `GET /api/chat/history/{session_id}` returns full turns.

### POST /api/chat/reactions
Thumbs up/down a turn. Feeds the recommender.

### Templates
`GET/POST/PUT/DELETE /api/templates` — prompt template CRUD. Shared across chat,
arena, diff, visualizer.

### System prompts
`GET/POST/PUT/DELETE /api/system-prompts` — reusable system-message library.

---

## Benchmark

### POST /api/benchmark/run
SSE. Body: `{models[], prompts[], custom_prompts[]?, reps, warmup_reps,
max_tokens, temperature}`. Events: `start`, `progress`, `result`, `done`.

### GET /api/benchmark/history
Query: `model`, `kind`, `since`, `limit`.

### GET /api/benchmark/run/{id}
Full run detail.

### DELETE /api/benchmark/run/{id}

### GET /api/bench-presets
Saved benchmark configurations.

### GET/POST /api/bench-scheduler
Recurring benchmark jobs.

### Auto-bench
Newly-completed downloads automatically queue a tiny 3-prompt bench; result is
stamped onto the model card via `registry.py`.

---

## HumanEval

### POST /api/humaneval/run
Kick a HumanEval run. SSE with per-problem `result` events. Problems are from
the canonical 164-entry set; sandbox execution classifies failures as infra
(timeout, import error) vs legitimate.

### GET /api/humaneval/history
### GET /api/humaneval/run/{id}

---

## Structured eval suite

Multi-category scorers beyond HumanEval: code, reasoning, factual,
instruction-following.

### POST /api/eval-suite/run
Body: `{models[], categories[]}`.
### GET /api/eval-suite/runs
### GET /api/eval-suite/run/{id}

---

## NIAH (needle-in-a-haystack)

Context-length stress test — plants a fact at a target depth, asks the model to
recall it across context sizes.

### POST /api/niah/run
### GET /api/niah/runs
### GET /api/niah/run/{id}

---

## Blind A/B arena

### POST /api/arena/battle
Creates a battle with two anonymized slots. Returns `{battle_id, status}`.

### POST /api/arena/battle/{id}/chat
SSE. Emits `slot_start`, `token`, `heartbeat`, `done`, `error`, `complete`.
Heartbeat fires every 5s during silent cold-load windows.

### POST /api/arena/battle/{id}/vote
Body: `{"winner": "model_a" | "model_b" | "tie"}`. Writes to DB and updates ELO.

### GET /api/arena/leaderboard
Cumulative ELO + win/loss/tie per model.

### GET /api/arena/history
Recent battles.

### Autobattle (overnight queue)
- `POST /api/arena/autobattle` body: `{count, prompts?, max_tokens?,
  max_wall_s_per_battle?, judge_model_id?}`. Starts a background batch. If
  `judge_model_id` is set, the judge auto-votes each completed battle.
- `GET /api/arena/autobattle` — list jobs.
- `GET /api/arena/autobattle/{job_id}` — progress + last anonymized message.
- `DELETE /api/arena/autobattle/{job_id}` — cancel.
- `GET /api/arena/pending` — battles waiting for a human vote (fed into
  `/arena/review`).
- `POST /api/arena/pending/{battle_id}/vote` — apply vote to a pending battle;
  hydrates a BattleState, runs the normal ELO/persist path.

---

## DFlash speculative decoding

### GET /api/models/{id}/dflash
`{eligible, enabled, draft_repo, draft_local_path}`.

### PUT /api/models/{id}/dflash
Body: `{"enabled": true}`. Proxies to oMLX admin API.

### POST /api/dflash/benchmark
A/B speed comparison between normal vs DFlash modes. SSE.

### z-lab draft tracker
- `GET /api/zlab/drafts` — cached z-lab repo list (6h TTL).
- `POST /api/zlab/drafts/refresh`
- `POST /api/zlab/drafts/download` — body: `{"repo_id": "z-lab/..."}`.

---

## Smart router + replay

### GET/PUT /api/smart-router/config
Rules list: prompt regex → target model.

### POST /api/smart-router/classify
Body: `{prompt}`. Returns the matched rule.

### POST /api/router-replay
Replay historical traffic against a candidate ruleset; returns hit-rate /
latency estimate.

---

## Inference profiler

### GET /api/profiler/profiles
Recent per-request profiles: ttft, tok/s, token-delta histogram.

### GET /api/profiler/stats
Per-model aggregates.

### POST /api/logprobs
Opt-in per-token logprobs + top-k alternatives for a single prompt. Used by the
visualizer and curator.

---

## Recommender

### GET /api/recommender
v1 — simple model-library analysis.

### GET /api/recommender/v2
Data-driven picks — joins arena ELO, benchmark history, chat reactions to rank
best model for code / reasoning / chat / long-context.

---

## Curator & fine-tune

### POST /api/curator/export
Body: `{filter: {min_turns?, since?, has_code?, tags?}, format: "sharegpt"}`.
Scans chat history, writes JSONL to outputs.

### GET /api/finetune-pipeline/jobs
Lists fine-tune runs scaffolded from a curator export.

### POST /api/finetune-pipeline/start
Body: `{export_id, base_model, lora_rank?, epochs?}`.

---

## Batch pipeline

### POST /api/batch-pipeline/run
Body: `{model_id, prompts[], temperature?, max_tokens?}`. Streams per-prompt
results. Export as CSV.

### GET /api/batch-pipeline/runs
### GET /api/batch-pipeline/run/{id}/csv

---

## Ensemble

### POST /api/ensemble/run
Fan-out to N models, optionally rerank with a judge model.

### GET /api/ensemble/runs

---

## Outputs (saved code)

### GET /api/outputs
List saved generated-code directories. Grouped by source (`arena`, `diff`,
`chat`), run_id, model.

### POST /api/outputs/reveal
Body: `{path}`. Opens the directory in Finder.

### POST /api/outputs/save
Usually called from the arena/diff UI after a completed generation — persists
fenced code blocks to disk.

---

## Downloads (HF)

### GET /api/hf/search?q=&kind=mlx|gguf|vllm
### POST /api/hf/download — body: `{repo_id, kind}`. Returns `{job_id}`.
### GET /api/hf/downloads — active + recent jobs.
### GET /api/hf/download/{job_id}/stream — SSE with bytes/total/eta.
### DELETE /api/hf/download/{job_id} — cancel.

Auto-resume: on backend startup, any in-progress job is resumed.

---

## HF upstream update watcher

### GET /api/hf-updates
Per-model `{origin_repo, downloaded_at, upstream_last_modified, last_checked,
update_available}`.

### POST /api/hf-updates/refresh
Concurrently re-checks `lastModified` across all tracked models. Newly-flagged
updates push to notifications.

### GET/PUT /api/models/{id}/origin-repo

---

## Notifications

### GET /api/notifications
Recent notifications: downloads complete, updates available, auto-bench done.

### POST /api/notifications/{id}/dismiss

---

## Recovery (crash detection)

### GET /api/recovery
`{dirty_shutdown, previous_state: {...}, age_s}`. Backend uses `fcntl` lock
on `~/.config/crucible/session.lock` — if the lock is held when startup runs,
the previous instance crashed; if not, clean shutdown marker is checked.

### POST /api/recovery/restore
Re-applies previous active_model and any in-flight downloads.

### POST /api/recovery/dismiss
Clears the dirty marker.

---

## Planner (memory)

### POST /api/mem-plan
Body: `{models[]}`. Returns `{fits, headroom_gb, total_gb, per_model: [...]}`.

---

## Disk reclaim

### GET /api/disk
Per-model disk usage + last-loaded age.

### POST /api/disk/reclaim
Body: `{model_ids[]}`. Bulk delete; returns per-id status.

---

## Warmth analyzer

### GET /api/warmth
Per-model load count + recency scoring. Feeds future pre-warm automation.

### GET /api/warmth/events
Raw load event log.

---

## System telemetry

### GET /api/system/telemetry
macOS-specific: CPU usage, memory pressure, thermal state, wattage from
`powermetrics` (best-effort, requires root — degrades gracefully if missing).

### WS /ws/metrics
Sidebar + metrics page subscribe here for 1Hz system samples.

---

## Workflows (hermes macros)

### GET /api/workflows
### POST /api/workflows
Parameterized macro: sequence of prompt templates with variable substitution.

### POST /api/workflows/{id}/run
### GET /api/workflows/{id}/runs

---

## Groups & tags

### GET /api/groups — model groups (e.g., "coders", "VLM").
### POST /api/groups — body: `{name, model_ids[]}`.
### GET /api/tags — all unique tags.

---

## Badges

### GET /api/badges/{model_id}
Per-model achievement badges — e.g., "Fastest code model", "Wins arena
Python prompts". Computed from arena + bench history.

---

## Cost tracker

### GET /api/cost
Estimated cost comparison vs cloud APIs for tokens served locally.

---

## Params

### GET /api/models/{id}/params — model-specific only.
### PUT /api/models/{id}/params
### DELETE /api/models/{id}/params
### GET /api/params/defaults — global defaults.
### PUT /api/params/defaults
### DELETE /api/params/defaults

`get_params()` merges global defaults + model-specific (model wins).
`get_params_raw()` returns model-only.

---

## Notes

### GET /api/models/{id}/notes — `{notes, tags, preferred_engine, hidden}`.
### PUT /api/models/{id}/notes

---

## Schedules (scheduled model switching)

### GET /api/schedules — list rules.
### POST /api/schedules — create (cron expression + target model).
### PUT /api/schedules/{id}
### DELETE /api/schedules/{id}

Power-aware gating: rules can be marked "off-peak only" and are skipped when
AC adapter unplugged or thermal state is hot.

---

## Settings

### GET/PUT /api/settings
### GET /api/nodes — remote Crucible node connectivity.

---

## OpenAI-compat proxy

### GET /v1/models
Active + available models in OpenAI list shape.

### POST /v1/chat/completions
Proxy — rewrites `model` field to the adapter's internal id, streams or buffers
based on `stream` flag. Compatible with the OpenAI Python SDK as a drop-in
(`base_url=http://localhost:7777/v1`). Tests live in
[backend/tests/test_openai_compat.py](../backend/tests/test_openai_compat.py).

---

## Diff

### POST /api/diff/run
Body: `{prompt, models[], max_tokens?}`. SSE with per-model token streams.

### GET /api/diff/runs
### GET /api/diff/run/{id}

---

## Plugins & webhooks

### GET /api/plugins — installed agent-facing plugins.
### GET /api/webhooks — outbound webhooks (e.g., notify Discord on bench done).
### GET /api/webhook-templates

---

## Health & uptime

### GET /api/health — simple liveness.
### GET /api/uptime — process uptime + engine state history.

---

## Backup / export

### POST /api/backup — dump config + DB as .tar.gz.
### POST /api/export — structured export of a specific data subset (bench runs,
arena history, chat, etc.).
