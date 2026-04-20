# Changelog

## 2026-04-20 — Overnight

Completed the pending 2026-04-18 TODO list, shipped backends / minimal UIs
for 20+ items from [docs/ROADMAP.md](docs/ROADMAP.md), added a 50-item
[ROADMAP v2](docs/ROADMAP_V2.md), wrote a
[TEST_PLAN](docs/TEST_PLAN_2026_04_20.md) covering yesterday's untested
features and today's additions, and captured scoping notes for items that
need more than a day in [DEFERRED.md](docs/DEFERRED.md).

### Old backlog completed
- **Global default MLX engine** — Settings picker, plumbed through the engine resolver, per-model preferences still win.
- **HumanEval prompt side pane** — toggleable drawer alongside the results table with the full problem text.
- **/planner polish** — Selection list collapsed by default; Plan headline bumped to `text-xl` for across-the-room reading.
- **Model-parse tests expanded** — 17 new real-library cases (Llama-3.x, Phi-3.5, Q4_K_M, int4, MXFP8). Parser gained int4 + multi-underscore Q-suffix + consistent quant casing. 112/112.
- **Recovery: Clean start** — third button on the recovery banner that also wipes completed download history.
- **Auto-bench manual trigger** — `/api/auto-bench/trigger` re-benchmarks any existing model without requiring a fresh download.
- **Reddit LLM watcher** — full scaffold: config, candidate-post fetch from public `r/{sub}/new.json`, per-post draft generation via the active MLX model, `pending / approved / rejected / posted` workflow on `/reddit`. Never auto-posts.

### Roadmap v1 shipped
- **Gists (#16)** — `/api/gists` CRUD + raw view for local markdown sharing.
- **Reading-level (#18)** — `/api/textutil/reading-level` (Flesch–Kincaid).
- **Quantization advisor (#21)** — `/api/quant-advisor` returns best-fit quant for (param count, RAM budget).
- **Wishlist (#23)** — track HF repos you haven't downloaded yet via `/api/wishlist`.
- **Cold-load predictor (#25)** — `/api/load-timings` + per-load hook records elapsed_ms; `/predict` returns median or size-based estimate.
- **Per-model changelog (#26)** — `/api/models/{id}/changelog` fetches recent HF commits, 6h cached.
- **Folder pinning (#27)** — `/api/folder-pins` + `/resolve?cwd=` for "when I chat from $repo, default to $model".
- **Cross-model eval matrix (#28)** — `eval_suite.all_items()` picks up user-dropped JSONL under `~/.config/crucible/evals/`.
- **Param sweep optimizer (#30)** — `/api/param-sweep` grid-searches temperature × top_p.
- **User-uploaded evals (#32)** — drop JSONL rows under `~/.config/crucible/evals/`; they merge into the suite.
- **Arena share link (#33)** — `/arena/share/<id>` renders a public read-only view of any voted battle.
- **Model chaining (#36)** — `/api/chain/run` pipes output through N steps, unloading between each.
- **Image input for VLMs (#38)** — `/api/vision/describe` accepts an upload, wraps into OpenAI `image_url` format.
- **Log viewer /logs (#41)** — live `tail -F` via SSE across Crucible / oMLX / frontend logs.
- **Ops dashboard /ops (#42)** — process tree of tracked backends with per-service restart buttons and auto-restart policy.
- **Usage tracker /usage (#45)** — per-day / per-hashed-caller token counts; auto-captured in the `/v1` proxy.
- **Cron workflows (#46)** — `/api/cron-workflows` CRUD + background poller firing matching schedules every minute.
- **Notification routes (#47)** — `/api/notification-routes` CRUD + dispatcher for Slack / Discord / raw webhook kinds.
- **Battery-saver schedules (#48)** — new `battery_saver` flag skips rules when `pmset` reports we're not on AC.
- **Auto-restart policy (#49)** — `/api/ops/auto-restart` + `/run-restart/{name}` for operator-initiated service kicks.
- **Remote rsync backup (#50)** — `/api/backup/rsync` pushes `~/.config/crucible/` to a user-supplied destination.
- **Message edit & branch (#7)** — per-user-turn action forks the conversation with a new edited message.
- **Conversation search (#9)** — `/api/chat/search?q=` full-text across chat history.
- **Error taxonomy (#43)** — `/api/errors/classify` buckets a raw error into actionable categories.
- **Rate limiting (#44)** — per-hashed-key token bucket on `/v1/chat/completions`, tunable via `/api/rate-limits`.

### Documentation
- [docs/ROADMAP_V2.md](docs/ROADMAP_V2.md) — next 50 ideas, grouped by theme.
- [docs/TEST_PLAN_2026_04_20.md](docs/TEST_PLAN_2026_04_20.md) — T1–T31 for today plus Y1–Y14 for yesterday's untested items.
- [docs/DEFERRED.md](docs/DEFERRED.md) — scoping notes for voice input, REPL panel, MCP chat integration, hermes skill browser, per-doc RAG, hybrid retrieval.

### Known constraints
- Many of today's features shipped as backend endpoints without dedicated frontend pages (eg quant advisor, reading-level, folder pins, wishlist, changelogs, param sweep, chain). The API is stable and documented; UI pages are fair game for the next pass.
- Batch inference against multiple models sequentially will need the usage tracker hook to route through proxy or the ensemble/chain paths for per-call counts — right now usage is only tallied when callers hit `/v1/chat/completions`.

---

## 2026-04-18 — Overnight + morning pass

### Added
- **Arena autobattle & review queue** — queue N blind battles overnight, vote in the morning at [/arena/review](frontend/app/arena/review). Optional LLM-as-judge auto-votes each battle with bias mitigations (slot randomization, length-neutral prompt). Anonymized progress indicators to keep the review genuinely blind.
- **Structured eval suite** — multi-category scorers (code / reasoning / factual / instruction-following) beyond HumanEval.
- **NIAH (needle-in-a-haystack)** — context-length torture test at configurable depths.
- **Ensemble** — multi-model fan-out with judge-based rerank.
- **Training-data curator** — chat history → ShareGPT JSONL, filterable by turn count / recency / code presence.
- **Fine-tune pipeline** — curator export → LoRA training scaffold with provenance tracking.
- **Batch pipeline** — one-off prompt pipeline with CSV export.
- **Workflows** — parameterized hermes macros with replay.
- **Warmth analyzer** — per-model load count + recency scoring; backing event log.
- **Smart router replay validator** — replay historical traffic against candidate rulesets.
- **Per-token logprobs streaming** — alt-token distribution for visualizer + curator.
- **Recommender v2** — data-driven picks joining arena ELO, bench history, chat reactions.
- **Memory planner** ([/planner](frontend/app/planner)) — pick N models, see fits / headroom before loading.
- **Disk reclaim** ([/disk](frontend/app/disk)) — bulk-select stale models, one-click delete.
- **Recovery UX** — detects dirty shutdown, offers one-click restore of previous active model + in-flight downloads.
- **PWA manifest** — installable from the browser on desktop and mobile.
- **Sidebar live telemetry** — CPU sparkline + wattage readout.
- **Chat session resume** — pick a past conversation from history, new turns append to the same session.
- **Visualizer templates dropdown** — paste a saved prompt above the input.
- **Downloads UX** — target path, throughput, ETA displayed live.
- **Two-part engine badge** — "FORMAT · engine" on model cards.
- **Sort preference persistence** — model-grid sort stored in localStorage.
- **Power-aware scheduled switching** — rules can be "off-peak only", skipped on battery or hot thermal state.
- **Auto-resume interrupted HF downloads** on backend restart.
- **OpenAI-compat SDK smoke test** — `backend/tests/test_openai_compat.py` (12/12 passing).
- **Model-parse pinning tests** — regression-fence parser behavior across real model names.

### Fixed
- **Arena**: heartbeat during cold load between slots — prevented client disconnect during oMLX model B warmup.
- **Arena**: only unload touched models in the `finally` block — no more misleading 400s on models that never loaded.
- **Arena**: TTFT excludes cold-load cost via explicit warmup pass.
- **Arena**: raise default `max_tokens` from 1024 → 4096 so code-gen battles don't truncate.
- **Autobattle**: raise default `max_tokens` from 512 → 1536.
- **Autobattle**: anonymize the running-battle progress indicator (previously leaked model names).
- **Recovery**: file-lock guard via `fcntl.flock` so duplicate backends can't clobber the crash marker.
- **Models**: strict size/tps sort — removed favorite-pinning secondary key.
- **Models**: route model-card Benchmark button to `/benchmark2` (not legacy `/benchmark/new`).
- **Visualizer**: surface errors from `/api/chat` instead of silently swallowing (special "no model loaded" hint).
- **Benchmark**: swap running-card glow to emerald; multiple clock-tick refactors (elapsed still racy — tracked).
- **Chat**: visible "+ New chat" button replaces cryptic trash icon.
- **HF updates**: backfill meta on legacy update notifications.
- **Sidebar**: auto-indent sub-routes (e.g. /arena/review under /arena).

### Docs
- Comprehensive README rewrite covering 35+ overnight features, install/quickstart, backends table, pages table, API reference.
- `docs/API.md` updated to cover all new endpoints.
- `docs/ARCHITECTURE.md` updated to document new subsystems (session_persist fcntl, autobattle, ensemble, curator, niah, eval_suite, workflows, warmth, batch_pipeline, finetune_pipeline, recovery).
- `docs/OVERNIGHT_TEST_PLAN.md` — structured test plan covering all 34 tasks.

### Known issues
- `/benchmark2` Elapsed/ETA clock doesn't tick during a live run. Three refactor attempts failed (phase-gated setInterval → always-on → tick-counter with Date.now() at render). Needs browser-side diagnosis.
- Update&replace on the Notifications page can delete the local model while "download" falsely reports success in seconds (likely because `existing_bytes` gets counted as `downloaded_bytes`). Data-loss risk — working pattern is to trigger a fresh download and manually delete the old folder once complete.

---

## Prior history

See `git log` for the full commit history leading to this release.
