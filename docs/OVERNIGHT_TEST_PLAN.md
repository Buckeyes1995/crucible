# Overnight Test Plan — 2026-04-18 branch

All work is on `overnight/2026-04-18`. Check out the branch, rebuild, restart, then
walk through the sections below. Each check is self-contained; skip any you don't care
about.

```bash
git checkout overnight/2026-04-18
cd backend && .venv/bin/uvicorn main:app --port 7777 --host 0.0.0.0 &
cd ../frontend && pnpm build && pnpm start &
open http://localhost:3000
```

Legend: **[smoke]** = 10 seconds, **[standard]** = 1-5 minutes, **[long]** = >5 minutes / needs a live model, **[scaffold]** = endpoint / plumbing is in place but end-to-end may require more wiring.

---

## Part 1 — First 19 tasks (earlier overnight pass)

### T1. Benchmark live dashboard — `/benchmark2`
- **[smoke]** Open `/benchmark2` from the sidebar "New Run" link.
- **[standard]** Pick a loaded model + the "Quick" preset. Click Run.
  - ✅ Sticky top strip shows 5 tiles: Elapsed, Progress, ETA, Best tok/s, Avg tok/s.
  - ✅ Elapsed ticks every ~500 ms (previously static — now fixed).
  - ✅ "Now running <model> · prompt <id> · rep N" banner appears below the strip.
  - ✅ Per-model card glows indigo while running; shows inline sparkline once 2+ results in.
  - ✅ After 2+ completed inferences, bottom multi-series tok/s-over-run chart appears.
  - ✅ ETA is "calc…" until first result, then populated thereafter.

### T2. Engine badge clarity (models page)
- **[smoke]** `/models` — every card badge should read `<FORMAT> · <engine>`:
  - MLX models: `MLX · omlx` (or `MLX · mlx_lm` if preferred_engine set)
  - GGUF files: `GGUF · llama.cpp`
  - Ollama entries: `GGUF · ollama`
  - vLLM entries: `vLLM · vllm`
  - MLX Studio: `MLX · Studio`

### T3. HF-update notification backfill
- **[smoke]** Open `/notifications`. Any "Model update available" entries that existed
  before the meta-field change should now show an **"Update & replace"** button (the
  backfill runs on backend startup and on `POST /api/hf-updates/refresh`).
- **[standard]** Click "Update & replace" on one — dialog confirms. Check `/downloads`
  for the new job.

### T4. Chat resume-from-history
- **[smoke]** `/chat/history` → click a past conversation → click **Resume**.
- ✅ Should land on `/chat` with prior messages loaded. New turns append to the same
  session_id (verify by sending one and refreshing `/chat/history`).

### T5. Sort preference persistence (models)
- **[smoke]** `/models` — click Size → DESC (arrow down). Reload the page. Same sort
  should still be active with the arrow still showing.

### T6. Downloads — target path + ETA
- **[smoke]** `/downloads`. Each job card shows `→ /Volumes/DataNVME/…` path.
- **[standard]** Start a new download. While running, the progress row shows: `NN% ·
  size/total · rate MB/s · ETA Xm`.

### T7. model-parse unit tests
- **[smoke]** `cd frontend && npx tsx lib/model-parse.test.ts`
- ✅ Prints 40 checks, ends with `✓ all 40 checks passed`.

### T8. HumanEval honest defaults
- **[smoke]** `/humaneval` — with a model loaded, the Temperature input should
  default to that model's merged param (NOT hardcoded 0.0). Max tokens should be 2048.

### T9. Memory planner
- **[smoke]** `/planner` — select 2-3 large models. Right panel shows:
  - Green "Fits — X GB headroom" OR red "Over by X GB"
  - Per-model size breakdown
  - Total RAM / free now / OS headroom / budget stats

### T10. Auto-benchmark on download
- **[long]** Download any MLX model via `/downloads`. When it finishes:
  - Expect a notification: "Benchmark ready: <model>: X tok/s across N prompts"
  - On `/models`, the card's Avg tok/s should show a value (not "—") immediately.

### T11. Sidebar live CPU + watts
- **[smoke]** Any page. Bottom of sidebar shows:
  - Memory bar (existing)
  - Thermal dot + label (existing)
  - **New:** CPU % row with an animated inline sparkline.
  - If passwordless sudo is set up for powermetrics: `X.XW` next to the thermal row.

### T12. Crash recovery
- **[standard]** Load a model. `kill -9` the backend (simulating a crash).
  Restart backend. Reload the frontend.
- ✅ An amber "Previous session had <model> loaded N minutes ago and didn't shut down
  cleanly" banner should appear at top, with Restore and dismiss buttons.

### T13. Disk reclaim
- **[smoke]** `/disk`. Shows kind-rollup tiles + per-model table sorted by idleness.
- **[standard]** Set threshold to 1 day. Select a throwaway model you can delete. Click
  "Reclaim X GB (1)" → confirm → after success the model disappears from `/models`.

### T14. Autobattle (human-voted)
- **[standard]** `/arena/review`. Queue 3 battles (small number for testing). Wait for
  generation. Vote through them with ← / → / ↓ / space.
- ✅ Each vote updates the leaderboard at `/arena/leaderboard`.

### T15. Visualizer templates dropdown
- **[smoke]** `/visualizer` → click Templates above the input. Dropdown lists saved
  templates. Click one → prompt input populated.

### T16. Code save-to-disk (arena + diff)
- **[standard]** Run an arena battle with a coding prompt. When both panels finish,
  click "Save N files" → "Reveal".
- ✅ Finder opens at `~/.config/crucible/outputs/arena/<battle_id>/model-{a,b}/code-*.html`.
- **[standard]** Run a multi-model `/diff`. Each panel saves to a per-model subfolder
  under the same run_id.

### T17. Arena TTFT excludes cold-load
- **[standard]** Run an arena battle on two MLX models where at least one is cold. Once
  generation ends, panel header shows both:
  - `Load X.Xs` (the warmup cost, shown only if > 100 ms)
  - `TTFT XXXms` (first-token latency on the real prompt, should be small now — ms, not
    seconds)

### T18/T19. Arena sequential + forced single-model mode
- **[standard]** Run an arena battle. Watch `ssh jim@192.168.1.50 docker logs hermes-agent`
  — actually for arena use oMLX logs: `tail -f ~/.omlx/logs/server.log`.
- ✅ Each slot unloads before the next loads (look for `unloading model: …` between the
  two `Loading model` lines). Prevents both models being resident at once.

---

## Part 2 — New 15 tasks

### N1. OpenAI SDK compat
- **[standard]** Load a model, then:
  ```bash
  cd backend && .venv/bin/pip install openai   # if not already
  .venv/bin/python -m tests.test_openai_compat
  ```
- ✅ Prints `✓ all N/N checks passed`. Covers models.list, chat.completions
  (streaming + non), multi-turn, system prompt.

### N2. Model warmth analyzer
- **[smoke]** Load and unload a couple of models to generate events.
- **[smoke]** `curl -s http://localhost:7777/api/warmth | jq .`
  Returns per-model `load_count`, `days_since_last_load`, and a 0..1 `priority` score.
- ✅ Top row should be the model you've loaded most + most recently.
- **[scaffold]** No UI yet — endpoint is ready for a future "pre-warm now" button.

### N3. Smart router replay
- **[standard]** Have some chat history built up (at least 5-10 sessions with different
  models).
  ```bash
  curl -s -X POST http://localhost:7777/api/router-replay \
    -H 'Content-Type: application/json' \
    -d '{"limit": 50, "source": "chat"}' | jq .
  ```
- ✅ Returns `agreement_rate`, category_distribution, and a per-prompt list showing
  what the router *would* have picked vs what you actually used.
- **[scaffold]** No dedicated UI — callable via curl or for a future `/router/replay`
  page.

### N4. Mobile PWA
- **[smoke]** On an iOS device on the same network: Safari → `http://192.168.1.25:3000`
  (or your cloudflare domain) → Share → Add to Home Screen.
- ✅ App icon appears on home screen. Tapping opens Crucible in standalone mode (no
  Safari chrome, indigo status bar).
- Same on Android via Chrome's install prompt.

### N5. Power-aware scheduler
- **[scaffold]** Open `/schedules` (the existing page). The backend now accepts three
  additional fields per rule:
  `offpeak_only: true, offpeak_start_hour: 22, offpeak_end_hour: 6`
  You can add these by hand to `~/.config/crucible/schedules.json` and restart, OR
  wait for a future UI toggle.
- **[smoke]** `curl -s http://localhost:7777/api/schedules` returns current rules.
- ✅ Rules with `offpeak_only=true` are silently skipped outside their window.

### N6. Recommender v2
- **[smoke]** `curl -s http://localhost:7777/api/recommender/v2 | jq .`
- ✅ Returns per-model `scores: { quality, speed, preference }`, `combined` score, and
  an `insights` array like "X is your top overall pick" / "N models lack data — queue
  an autobattle".
- **[scaffold]** Exposed only as an endpoint; the existing /recommender page still uses
  v1. Easy to flip once you've accumulated arena + bench data.

### N7. Batch inference pipeline
- **[standard]** With a model loaded:
  ```bash
  curl -s -X POST http://localhost:7777/api/batch-pipeline/start \
    -H 'Content-Type: application/json' \
    -d '{"model_id": "<id>", "prompts": ["1+1=?", "What year is it?", "Name a color."],
         "temperature": 0.2, "max_tokens": 32}' | jq .
  ```
  Note the returned job_id.
- **[smoke]** `curl http://localhost:7777/api/batch-pipeline/<job_id> | jq .status`
  → done.
- **[smoke]** `curl http://localhost:7777/api/batch-pipeline/<job_id>/csv > out.csv`
  → inspect. Columns: idx, prompt, response, tokens, tps, ttft_ms, elapsed_s, error.
- **[scaffold]** No frontend upload UI yet.

### N8. Multi-model ensemble
- **[standard]** With 2-3 models available:
  ```bash
  curl -s -X POST http://localhost:7777/api/ensemble/run \
    -H 'Content-Type: application/json' \
    -d '{"prompt": "Explain gravity in one paragraph.",
         "model_ids": ["<id1>", "<id2>"],
         "strategy": "longest"}' | jq .
  # Note job_id
  curl http://localhost:7777/api/ensemble/<job_id> | jq .
  ```
- ✅ Both models generate (sequentially — unload between), `winner_model_id` set,
  `final_response` is whichever was longest.
- **[standard]** Repeat with `"strategy": "best_of_n", "judge_model_id": "<id3>"`.
- ✅ Judge votes; reasoning appears in `final_response` under `[judge]:`.

### N9. Training data curator
- **[smoke]** Requires chat history to exist.
  ```bash
  curl -s -X POST http://localhost:7777/api/curator/preview \
    -H 'Content-Type: application/json' \
    -d '{"min_turns": 4, "max_age_days": 90, "require_code": false}' | jq '.total_matching'
  ```
- **[standard]** With a non-zero preview, hit `/api/curator/export` with the same body.
  Response gives the output path + count.
- ✅ File is valid ShareGPT JSONL: each line has `{"conversations":[{"from":"human","value":"..."},...]}`.
  Feed it to the finetune page's dataset path.

### N10. LLM-as-judge autobattle
- **[long]** `curl -s -X POST http://localhost:7777/api/arena/autobattle \
    -H 'Content-Type: application/json' \
    -d '{"count": 5, "judge_model_id": "<larger-model-id>"}'`
- ✅ Unlike normal autobattle, these battles get auto-voted. After completion, go
  to `/arena/leaderboard` — ELO should have shifted for the models in those battles.
- Position bias is randomized per judge call (A/B swap); judge reasoning is stored in
  the battle record.

### N11. NIAH context-length test
- **[long]** With a model loaded:
  ```bash
  curl -s -X POST http://localhost:7777/api/niah/start \
    -H 'Content-Type: application/json' \
    -d '{"model_id": "<id>", "lengths": [2000, 8000, 16000]}' | jq .
  curl http://localhost:7777/api/niah/<job_id> | jq '.results | map({target_tokens, success, ttft_ms, tps})'
  ```
- ✅ Returns per-length success/failure + TTFT (reveals prefill cost scaling) +
  tok/s (reveals generation degradation with large KV cache).
- **[scaffold]** No viewer UI yet; results are actionable via curl.

### N12. Structured eval suite
- **[standard]** `curl -s -X POST http://localhost:7777/api/eval-suite/start \
    -H 'Content-Type: application/json' -d '{"model_id": "<id>"}' | jq .`
  Wait for it (~1-2 min per model).
- **[smoke]** `curl http://localhost:7777/api/eval-suite/<job_id> | jq .summary`
- ✅ Summary has per-category pass rates (code / reasoning / factual / instruction) +
  overall + weighted scores. Per-item results include the model's full response for
  post-hoc auditing.

### N13. Agentic workflow recorder
- **[standard]** Create a workflow via POST /api/workflows:
  ```bash
  curl -s -X POST http://localhost:7777/api/workflows \
    -H 'Content-Type: application/json' \
    -d '{"name": "daily github digest", "agent": "hermes",
         "template": "Summarize my PRs from the last {days} days.",
         "skills": ["github-issues"], "max_turns": 10}' | jq .
  ```
- **[standard]** Run it: POST /api/workflows/<id>/run with `{"values": {"days": "7"}}`
  → streams a hermes chat response.
- **[scaffold]** No dedicated UI; endpoint-callable for cron or scripted use.

### N14. Log-probs visualizer
- **[standard]** With a model loaded:
  ```bash
  curl -sN -X POST http://localhost:7777/api/logprobs/stream \
    -H 'Content-Type: application/json' \
    -d '{"prompt": "The best programming language is", "top_logprobs": 5}' | head -20
  ```
- ✅ Each SSE event includes `content` + `logprobs: { token, logprob, top: [...] }`
  with per-step alternative tokens.
- **[scaffold]** No frontend viewer yet (the existing /visualizer could be extended
  to consume this).

### N15. Fine-tune pipeline scaffold
- **[standard]** Have a curator export ready (see N9), then:
  ```bash
  curl -s -X POST http://localhost:7777/api/finetune-pipeline/start \
    -H 'Content-Type: application/json' \
    -d '{"base_model_id": "<id>", "curator_export": "curated-<timestamp>.jsonl",
         "run_name": "my-test-lora", "num_iters": 100}' | jq .
  ```
- ✅ Creates a finetune job (existing /finetune infra) with provenance tag
  written to `~/.config/crucible/finetune_output/<run_name>/crucible.json`.
- ⚠️ Actual training requires the trainer binary (mlx_lm lora / Unsloth) to be
  available — the scaffold wires the orchestration; the execution depends on your
  existing /finetune config.
- **[scaffold]** No one-click UI; endpoint-driven.

---

## Smoke-check all endpoints at once

After restart, validate that everything's mounted:

```bash
for ep in \
  /api/status /api/disk/summary /api/system/telemetry /api/recovery /api/warmth \
  /api/arena/pending /api/arena/autobattle /api/arena/leaderboard \
  /api/recommender/v2 /api/eval-suite/items /api/niah /api/workflows \
  /api/batch-pipeline /api/curator/exports /api/finetune-pipeline/outputs \
  /api/ensemble/nonexistent
do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:7777$ep)
  echo "$code $ep"
done
```

Expected: 200 on everything except `/api/ensemble/nonexistent` (404 — proves the
router is mounted and 404s for bad IDs rather than 500s).

## Per-task commit references

```bash
# Part 1 (19 tasks)
git log --oneline main..overnight/2026-04-18 | tail -19

# Part 2 (15 tasks) — all committed after the Part 1 merge-prep commit
git log --oneline overnight/2026-04-18 -- | head -15
```

## Revert / Pick strategy

If any task breaks something:

```bash
# Revert one task:
git revert <sha>

# Cherry-pick only the keepers into main:
git checkout main
git cherry-pick <sha1> <sha2> ...

# Keep everything:
git checkout main && git merge --ff-only overnight/2026-04-18

# Throw it all away:
git checkout main && git branch -D overnight/2026-04-18
```

Scaffolds (marked **[scaffold]** above) ship endpoints but may need frontend wiring to
feel complete. They're stable to merge — nothing regresses existing features.
