# Crucible — Roadmap v4: Ten Major Upgrades

**Status:** design plan, no code yet.
**Scope:** ten genuinely major features, each a multi-session build. Not polish. Not another 50 small ideas. Things that change what Crucible *is*.

Every item below includes: **What**, **Why it matters**, **Shape** (how it'd actually get built), **Risks/tradeoffs**, and a **Prereqs** line so we can sequence them.

---

## 1. ⭐ Agent Runner (execute workflows + tool calling) — unblocks everything

**What:** Run the "workflows" from the store as actual agents. Model plans, calls tools (MCP servers already installed, shell, file ops, web), observes results, iterates. Live trace of every step in the UI; each run saved to a `runs` table and replayable.

**Why it matters:** Today Crucible lets you *install* workflows and *chat* with models, but not *execute* agentic work. This is the single biggest gap. It turns Crucible from "compare models" into "do work here." Also completes the loop on the MCP integration — installed tools finally have somewhere to be called.

**Shape:**
- Backend `agent_runner.py`: event loop `plan → pick_tool → dispatch → observe → loop` until goal or budget hit.
- Tool dispatcher: adapters for MCP tools (already in `mcp_host.py`), shell exec (sandboxed), HTTP fetch, file read/write (scoped to a workspace dir).
- Run persistence: `runs` + `run_steps` tables, each step has type/input/output/tokens/elapsed.
- SSE stream of step events to the frontend so traces appear live.
- Frontend `/runs` list + `/runs/<id>` trace view with expandable steps, tool inputs/outputs, token counts, branching to re-run from any step.
- Budgets: max steps, max tokens, wall-clock timeout, per-tool allow-list.
- Safety: require explicit user OK on every shell exec (configurable to auto-allow).

**Risks/tradeoffs:** This is at least 3-4 sessions of real work. Safety is non-trivial — exec-without-guardrails gets us burned. Tool-calling quality depends heavily on the model; smaller models may just spin.

**Prereqs:** None. Builds on existing MCP + chat + SSE plumbing.

---

## 2. ⭐ Local RAG v2 (real vector store + citations + per-project)

**What:** Replace the current file-upload-into-memory RAG with a proper on-disk vector store. Index directories/files/URLs into a project, cite sources inline in chat responses, show chunk previews on hover, re-index on file change.

**Why it matters:** Current RAG is a toy. People want to point Crucible at their notes/codebase/downloaded PDFs and chat about them with citations. Without citations, "RAG" is just an expensive fuzzy search.

**Shape:**
- Storage: `hnswlib` (pip-installable, Apple-Silicon-friendly) with metadata in SQLite. No external service.
- Embeddings: use the currently-loaded model via a separate "embed" endpoint; or bundle a small dedicated embedder (e.g. `all-MiniLM-L6-v2` mlx-converted).
- Indexing: recursive directory walker, chunk by heading/paragraph, dedup by hash.
- Per-project store: scoped to the Projects feature (see #4). Each project has its own index.
- Chat UI: when a RAG-assisted turn emits `[1]` style citations, render them as pills. Click → slide-out pane with chunk + source path.
- Auto-reindex: filesystem watcher (fswatch / inotify-via-watchdog) rebuilds chunks on file change.

**Risks/tradeoffs:** Embedding model choice is a rabbit hole. On-device embeddings are slow for big corpora (8-10 k chunks/min on M2 Max). Citations require the chat prompt to include chunk IDs and the response parser to survive model drift.

**Prereqs:** Projects (#4) gives it a scope. Without that, RAG lives in a global pool that gets confused fast.

---

## 3. ⭐ Multi-modal Chat (images + vision models)

**What:** Drag-drop / paste images into chat, route to vision-capable models (Qwen3.5-VL already downloaded), see inline results. Follow-up: extract frames from a short video, OCR a screenshot, annotate an image with a bounding box.

**Why it matters:** Half the local-model advancements in 2026 are multi-modal. Crucible currently hides this entirely — there's no way to even test a VL model through the UI.

**Shape:**
- Frontend: extend the chat input to accept image paste + drag-drop, show thumbnail strip above the input, base64-encode for OpenAI-compat `image_url` content blocks.
- Backend: pass `content: [{type:'image_url', image_url:{url}}, {type:'text', text}]` through the proxy. Most VL models (Qwen3.5-VL, MiniCPM-V) already handle this in their chat templates.
- Model filter: chat model picker shows a "👁" chip on vision-capable models. If user attaches an image while on a non-vision model, warn inline.
- History: images saved alongside chat_messages (base64 → filesystem with a DB pointer, not inline BLOB).
- Follow-up: image preview component with crop/annotate for "tell me what's here."

**Risks/tradeoffs:** Some VL models have specific image preprocessing that the OpenAI-compat proxy doesn't normalize. Storage grows fast — needs a sensible cap + cleanup.

**Prereqs:** None.

---

## 4. Project Workspaces (group chats / snippets / RAG as a unit)

**What:** Named "projects" that scope a bundle of chat sessions, snippets, system prompts, RAG index, and settings (default model, temperature, etc.). Switch the project → everything flips context. Export a project as a zip; import one.

**Why it matters:** Everything in Crucible is currently global — all chats in one list, all snippets in one list. When you use it for real work you end up with hundreds of unrelated items mixed together. Projects make it feel like you're "working on something" instead of "using a tool."

**Shape:**
- New `projects` table: id, name, color, default_model_id, system_prompt, rag_index_path, created_at.
- Foreign keys from chat_sessions, snippets, workflows_runs to project_id.
- Sidebar: project switcher at the top, shows active name + color bar.
- "New project" dialog: pick a color, optional starter system prompt, optional RAG source dir.
- Export: zip containing project.json + all message rows + snippets + settings. Import: unzip into a new project row.

**Risks/tradeoffs:** Migrating existing data requires a "Default" project catch-all. Simple concept but touches a lot of pages.

**Prereqs:** None. Becomes a scope for RAG (#2) and runs (#1).

---

## 5. ⭐ Eval Harness (MMLU, GSM8K, HumanEval, ARC in one click)

**What:** One-click "run all evals against this model" → benchmark runner executes each suite, scores the model, ranks it against published baselines, stores history. Compare multiple models side-by-side, see where each wins.

**Why it matters:** Today's benchmark feature measures throughput/TTFT — it tells you how *fast* a model is, not how *smart*. Published eval scores are the currency of model discussions. Crucible should be the easy way to verify them locally.

**Shape:**
- Suites: MMLU (57 subjects, 14k MCQs), GSM8K (math, 1319 problems), HumanEval (already have this, 164), ARC (challenge + easy), TruthfulQA.
- Each suite: loader (downloads dataset once, caches), prompt template, scorer (exact match, log-prob, or model-graded).
- Runner: streaming SSE like benchmarks, handles suite-specific answer extraction.
- Published baselines: bundled JSON with scores from model cards/papers so rows show "Qwen3-7B: 72.3 (you) vs 71.8 (reported)".
- UI: `/evals` page with per-model run history, diff between runs, leaderboard of all your runs across suites.
- Daily / weekly scheduled runs → regression detection piggybacking on existing alert infra.

**Risks/tradeoffs:** Running MMLU on a 35B takes hours. Need a "quick mode" subsampling. Scoring edge cases are a swamp (model says "A) The answer is X" — did it pick A?).

**Prereqs:** None. Mostly extends benchmark infra.

---

## 6. Voice Mode (TTS + STT + hands-free)

**What:** Speak a question → STT → model → TTS reads reply. Toggle per-session. Voice picker (system voices + optional local Coqui/Piper/MLX-TTS). Realtime waveform during recording. "Wake word" optional.

**Why it matters:** Hands-free is a new modality, not a polish. Cooking, driving, walking, coding away from the keyboard. Also a natural entry point for later: phone call to your local model via a Twilio-style bridge.

**Shape:**
- STT: macOS built-in `SFSpeechRecognizer` wrapped via a small Swift helper or `whisper.cpp` locally (already in the inference stack).
- TTS: `say` (built-in) or Piper (high quality, offline, fast on Apple Silicon).
- Web Audio API for capture + playback on the frontend; WS back to the backend for STT chunks.
- Session flag: "voice mode on" keeps auto-sending after silence threshold.
- Per-model voice persona: save a preferred voice per model (Qwen3-Coder = "Daniel", MiniMax = "Samantha").

**Risks/tradeoffs:** Real-time waveform + low-latency roundtrip requires careful pipelining. Piper model selection is its own rabbit hole.

**Prereqs:** None. Voice waveform visualization could reuse the `/visualizer` page infra.

---

## 7. Fine-tuning UI (LoRA on MLX)

**What:** Point Crucible at a dataset (either a JSONL file, a set of chat sessions, or a set of snippets), pick a base model, pick rank/alpha/learning rate presets, run training with live loss chart, save the LoRA, hot-swap it at inference time.

**Why it matters:** MLX supports LoRA training natively but it's a CLI-and-config affair. Bringing it into Crucible closes the "data → custom model" loop — chat with the model, cherry-pick good turns, train a personalized variant.

**Shape:**
- Dataset curator: UI that scans chat_sessions / snippets, lets you multi-select turns, previews formatted training pairs, exports to JSONL.
- Training backend: shells out to `mlx_lm.lora` (or the omlx equivalent), captures stdout, parses loss events, writes to a training-job table.
- UI: `/finetune` page with active jobs, loss curves, eval loss vs train loss, checkpoint browser.
- Adapter hot-swap: oMLX supports loading LoRAs on top of a base model — wire a toggle per-model.

**Risks/tradeoffs:** Training is slow — 4-6 hours for a small LoRA on 35B. Needs clear progress + estimated remaining. Dataset curation UI is easy to get wrong (tags, filters, dedup).

**Prereqs:** Project workspaces (#4) help because you'd usually train per-project.

---

## 8. Automation / Triggers (cron + condition matchers + hooks)

**What:** "When X, do Y." Examples: when memory pressure > 0.8, unload the current model. Every 3h, run quick-bench on the loaded model and post to Notifications. When a new Qwen release hits, auto-download it. When a chat contains the word "deploy," open a draft PR.

**Why it matters:** Crucible already has `schedules.py`, `webhooks.py`, `notifications.py`, `bench_scheduler.py` — but they're disconnected islands. A unified trigger system turns Crucible into a small ops platform for your local LLM stack.

**Shape:**
- Core: triggers table with `condition_type`, `condition_args`, `action_type`, `action_args`, `enabled`, `last_fired`.
- Condition types: `cron` (expression), `memory_pressure` (threshold), `model_loaded` (specific id), `hf_update_available` (any or specific), `chat_contains` (regex).
- Action types: `load_model`, `unload_model`, `run_benchmark`, `send_notification`, `webhook`, `shell` (sandboxed).
- Evaluator loop: 1Hz tick reads conditions, fires matching actions with debounce.
- UI: `/automations` page — list, edit, test-fire, see last-N fired events.

**Risks/tradeoffs:** Test-fire vs safety. The `shell` action is dangerous; probably needs a local-only guard + explicit user confirm the first time.

**Prereqs:** Leans on existing schedules + webhooks infra.

---

## 9. Plugins / Extension API

**What:** Users write a small plugin (backend Python file + frontend TSX component) that adds a route, a sidebar entry, or a background worker to Crucible without forking. Think VS Code extensions, scoped.

**Why it matters:** Ten good ideas come from a community-sized surface area much faster than from one person. Right now every roadmap item requires the repo owner to build it. Plugins unlock that.

**Shape:**
- Plugin layout: `~/.config/crucible/plugins/<name>/backend.py` (exports a FastAPI router + optional `on_startup`), `frontend/page.tsx` (exports a default component), `plugin.json` (metadata, permissions).
- Backend loader: scan on boot, import each `backend.py`, mount `/api/plugins/<name>/*`. Reject plugins that exceed declared permissions (no network unless declared, no filesystem outside scoped dir, etc.).
- Frontend loader: Next.js can't dynamically import arbitrary modules at runtime in production mode — use an iframe sandbox at `/plugins/<name>` that loads the plugin's standalone Next mini-app. Crude but safe.
- Plugin marketplace tab in the Store: browse + one-click install.
- "Propose plugin" just opens a PR template to a separate `crucible-plugins` repo.

**Risks/tradeoffs:** Security is the biggest one. Permissions system done wrong is worse than no plugins. Plugins break across Crucible version upgrades unless there's a versioned SDK.

**Prereqs:** API key scoping (#149, already shipped) gives us the foundation for per-plugin credentials.

---

## 10. Prompt Engineering IDE

**What:** Prompts become first-class artifacts: versioned, diffable, testable against saved inputs, with per-version metrics (tokens, latency, tps, eval pass rate). A/B any two versions against a test set. Template variables with validation. Forkable from chat.

**Why it matters:** Prompts currently live in the Snippets tab as dumb strings. For anyone iterating seriously, prompt = product — it needs the tools we give code (diff, history, tests).

**Shape:**
- `prompts` table with versions (like git blobs): id, parent_version, content, created_at, name.
- "Test set" = N saved inputs + expected-outputs or a grading prompt.
- A/B run: frontend POSTs `{prompt_version_a, version_b, test_set_id, model_id}`, backend iterates the set through both prompts, returns per-input deltas.
- Editor UI with template-variable syntax (`{{name}}`, `{{context}}`). Inline lint: warn on unreferenced vars.
- Publish a prompt to the Store (crosses over with prompt templates that already exist).

**Risks/tradeoffs:** "Prompt IDE" is a big surface. Scope discipline needed — V1 = versions + A/B run + test set, not a full eval framework.

**Prereqs:** Evals harness (#5) provides the grader; Projects (#4) provide scope.

---

## Suggested sequencing

Dependencies are loose but there's a natural order:

```
  Project workspaces (#4) ──────────────────────┐
            │                                   │
            ├── Local RAG v2 (#2)              │
            │                                   │
            ├── Fine-tuning UI (#7)            │
            │                                   │
            └── Prompt IDE (#10) ◀── Evals (#5)
                                    ▲
                                    │
  Agent runner (#1) ───────────────┘
         │
         └── Automation (#8)

  (independent)
  Multi-modal chat (#3)
  Voice mode (#6)
  Plugins (#9)
```

### Sprint 1 (2–3 sessions) — foundation
**#4 Projects** + **#3 Multi-modal chat**.
Projects is the organizing primitive the next four items all benefit from, and it's a modest-size build. Multi-modal is high-value and independent — ships in parallel while projects is baking.

### Sprint 2 (3–4 sessions) — core capability
**#1 Agent runner**.
Single biggest transformation. Ships on top of Projects so runs are scoped; ships before Automation so automation can trigger runs.

### Sprint 3 (2–3 sessions) — make the model personal
**#2 RAG v2** + **#5 Evals**.
Both lean on Projects. RAG gets users' data into the model; Evals teach users which model earns their data.

### Sprint 4 (2–3 sessions) — productize the workflow
**#10 Prompt IDE** + **#7 Fine-tuning UI**.
Prompt IDE uses Evals as a grader. Fine-tuning curates from chat/snippets — which Projects made orderly.

### Sprint 5 (optional, opportunistic) — reach + modalities
**#6 Voice mode** (new modality) and **#8 Automation** (hands-off ops).
Nice to have, not blocking. Voice is a strong demo; Automation pays off for heavy users.

### Sprint 6 (long-term) — ecosystem
**#9 Plugins**.
Last because it depends on Crucible being stable enough to offer a contract to other devs. Premature plugin APIs are a maintenance curse.

---

## What I'd cut if time got tight

In descending order of "drop this first":
1. **Voice mode (#6)** — delightful but not core. Requires new modalities + audio pipeline = high investment for the "I'll try it once" crowd.
2. **Plugins (#9)** — hugely valuable *if* a community forms, but "build it and they will come" burns energy. Revisit after #1–#5 prove the base product.
3. **Automation (#8)** — useful for power users; can land as three half-features (cron-only, condition-only, hooks-only) instead of one big system if needed.

Items #1–#5, #7, #10 are the spine. Those seven — Projects, RAG, Multi-modal, Agent Runner, Evals, Fine-tuning, Prompt IDE — would make Crucible a *serious* local-LLM workbench, not just a nicely-polished model runner.

---

## Not here on purpose

- **Cluster mode / federation of Crucible instances** — the remote_node adapter exists; scaling it further is infrastructure work, not product. Revisit after single-node nails its job.
- **Cloud model proxies** — adding OpenAI / Anthropic / Gemini upstream adapters would be easy, but dilutes the "local first" identity. If you ever add them, gate behind an explicit opt-in.
- **A mobile app** — the PWA works on phone today; a native iOS app is huge scope with tiny incremental value over the PWA. Punt.
- **Built-in team/auth** — Crucible is a personal tool. Multi-user is a different product, not an upgrade.

---

## Decision point

If you want to act on this today, **#4 Projects** is the smallest first step that unblocks the most downstream work. It's a 1-session ship, touches a lot of files, and every subsequent major benefits. Say the word and I'll scaffold it.
