# Changelog

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
