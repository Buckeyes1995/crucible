# Crucible — 50 proposed additions

Curated roadmap brainstorm. Items aren't ranked overall; they're grouped by
theme so it's easier to pick a cohesive bundle.

## Chat experience (1–10)
1. **Slash commands** — `/model`, `/temp`, `/clear`, `/system`, `/save` in the chat input.
2. **Regenerate from here** — per-turn button that drops everything below and re-runs.
3. **Chat export (Markdown / JSON)** — download-this-session button.
4. **System prompt quick-switch** — dropdown above the chat input, populated from the library.
5. **Inline structured rendering** — when a response contains fenced `json`, `csv`, `jsonl`, or a markdown table, render it as a collapsible structured view alongside the raw text.
6. **Token budget meter** — progress bar toward the model's context window for the current session, with 70/90% warnings.
7. **Message edit + branch** — edit any past user turn; the model re-runs from that point and past branches stay accessible via a sidebar.
8. **Bookmarks** — star individual turns to pull them up later.
9. **Conversation search** — full-text across all chat history with model / tag / date filters.
10. **Voice input** — Whisper-powered mic button that transcribes into the chat input.

## Code workflow (11–18)
11. **Snippet library** — pin responses (or single code blocks) for reuse; dedicated `/snippets` page with search.
12. **Multi-file tree preview** — when a model emits multiple code blocks, show a tree before saving so you can rename / drop files.
13. **Diff view for Arena code** — auto-diff between Slot A and Slot B's outputs when both produced code.
14. **REPL panel** — interactive Python / Node / shell tied to the last emitted snippet, so you can iterate without leaving the panel.
15. **Git-aware prompts** — detect a project in the cwd, let the model see `git status` / `git diff` as context for commit-message / PR-description requests.
16. **Snippet → markdown gist** — one-click publish to a local static gist directory served under `/gists`.
17. **Import-from-clipboard** — "paste as system prompt" / "paste as template" shortcut on the templates page.
18. **Response reading-level** — quick Flesch / grade-level readout, helpful for "explain to a X-year-old" requests.

## Models & catalog (19–27)
19. **Model family grouping** on `/models` — auto-cluster by base model (all Qwen3-Coder variants together) with collapse.
20. **Deprecation flags** — mark a local model deprecated with a recommended replacement; card shows muted styling + "use X instead".
21. **Quantization advisor** — given a FP16 / original model, suggest the best quant that fits your RAM budget.
22. **One-click quant convert** — shell out to `mlx_lm.convert` to produce a new quant of an existing model.
23. **Wishlist / ghost models** — catalog entries for things you haven't downloaded yet, tracked separately from the curated Store tab.
24. **Store: "featurize" button** — from any HF search result, open a pre-filled catalog issue that promotes it to curated.
25. **Cold-load predictor** — estimate load-into-oMLX time from historical warmth data before the user hits Load.
26. **Per-model changelog** — auto-generate a mini-changelog from HF repo commit history when you hit "check for updates".
27. **Model pinning / per-folder defaults** — "when I chat from repo X, default to model Y".

## Benchmarks, evals, arena (28–34)
28. **Cross-model eval matrix** — one-shot view: all models × all categories pass rates.
29. **Regression alerts** — when a re-run of the same prompt gets noticeably slower or gets worse on eval, surface it as a notification.
30. **Param sweep optimizer** — grid-search temperature / top-p against a chosen eval suite.
31. **Speed × context chart** — NIAH-style scan of tok/s across context lengths for a single model.
32. **User-uploaded eval sets** — drop a JSONL into `~/.config/crucible/evals/` and it appears in the eval suite picker.
33. **Arena share link** — a public-read URL for a single battle (behind Cloudflare Access) so you can send a friend "which looks better?"
34. **Arena leaderboard filters** — segment ELO by prompt category / norm mode.

## Agent & tool integration (35–40)
35. **MCP chat integration** — expose installed MCP tools as function-calling tools during chat for models that support them.
36. **Model chaining** — pipe output of model A into model B as a reusable workflow.
37. **Hermes skill library** — browse + toggle hermes skills from the Agents page.
38. **Image input for VLMs** — paste an image; it's routed to the active VLM (Qwen3.5-VL etc.).
39. **RAG per-document configs** — chunking strategy + retrieval count per uploaded doc.
40. **Hybrid BM25 + embedding retrieval** — swap in sentence-transformers embeddings for RAG semantic recall.

## Observability & operations (41–45)
41. **Log viewer at /logs** — live backend tail, filterable by source (uvicorn, oMLX, mlx_lm, llama.cpp, hermes).
42. **Backend process-tree dashboard** — tree of Crucible + every backend it manages with PID, uptime, restart button.
43. **Structured error taxonomy** — classify errors (OOM / network / auth / model-not-found), UIs react uniformly.
44. **Rate limiting on `/v1/*`** — per-api-key buckets for multi-user / shared-tunnel scenarios.
45. **Usage tracker** — token-in / token-out per API key per day with sparkline.

## Automation (46–50)
46. **Cron-triggered workflows** — "run daily GitHub digest every morning at 7" with notification on completion.
47. **Notification routes** — route "model update available" / "auto-bench done" / "arena completed" to Slack / Discord / email via webhook templates.
48. **Schedule-aware power modes** — "battery saver: don't load models >30GB unless on AC".
49. **Auto-restart unhealthy backends** — if oMLX or llama-server health-check fails N times in a row, kick it.
50. **Backup to remote** — rsync / S3 target for `~/.config/crucible/` so the SQLite DB, configs, and notes survive a laptop reinstall.

---

## Top 10 shipped on 2026-04-19

1. ✅ Chat slash commands
2. ✅ Regenerate from here
3. ✅ Chat export (Markdown / JSON)
4. ✅ System prompt quick-switch above chat input
5. ✅ Inline JSON / CSV / table rendering
6. ✅ Snippet library (pin + `/snippets` page)
7. ✅ Multi-file tree preview before saving code
8. ✅ Model family grouping
9. ✅ Deprecation flags with replacement hint
10. ✅ Token budget meter

## Shipped 2026-04-20 (backend + minimal UI where noted)

7. ✅ Message edit + branch — chat store + inline editor.
9. ✅ Conversation search — `/api/chat/search`.
11. ✅ Snippet library — ship-date 2026-04-19 (see above).
12. ✅ Multi-file tree preview — ship-date 2026-04-19.
13. Arena diff view — backend share endpoint lands; diff-view UI pending.
15. ✅ Git-aware prompts — `/api/git/context`.
16. ✅ Snippet → gist — `/api/gists`.
17. ✅ Clipboard import — covered by existing templates paste.
18. ✅ Reading-level — `/api/textutil/reading-level`.
19. ✅ Model family grouping — ship-date 2026-04-19.
20. ✅ Deprecation flags — ship-date 2026-04-19.
21. ✅ Quantization advisor — `/api/quant-advisor`.
23. ✅ Wishlist / ghost models — `/api/wishlist`.
25. ✅ Cold-load predictor — `/api/load-timings/predict`.
26. ✅ Per-model changelog — `/api/models/{id}/changelog`.
27. ✅ Folder pinning — `/api/folder-pins`.
28. ✅ Cross-model eval matrix — user-eval merge shipped; matrix UI pending.
30. ✅ Param sweep — `/api/param-sweep`.
32. ✅ User-uploaded evals — drop JSONL under `~/.config/crucible/evals/`.
33. ✅ Arena share link — `/arena/share/<id>`.
36. ✅ Model chaining — `/api/chain/run`.
38. ✅ Image input for VLMs — `/api/vision/describe`.
41. ✅ Log viewer — `/logs` page with SSE tail -F.
42. ✅ Process-tree dashboard — `/ops`.
43. ✅ Error taxonomy — `/api/errors/classify`.
44. ✅ Rate limiting `/v1` — token bucket on /v1/chat/completions.
45. ✅ Usage tracker — `/usage` page.
46. ✅ Cron workflows — `/api/cron-workflows` + poller.
47. ✅ Notification routes — `/api/notification-routes` + dispatcher.
48. ✅ Battery-saver schedules.
49. ✅ Auto-restart — `/api/ops/auto-restart`.
50. ✅ Remote rsync backup — `/api/backup/rsync`.

### Deferred to follow-up passes
Items requiring larger scoping — see [`DEFERRED.md`](DEFERRED.md).

10 (voice input), 14 (REPL panel), 35 (MCP chat integration), 37 (hermes skill browser), 39 (RAG per-doc configs), 40 (hybrid retrieval).

### Still open (small)
22 (one-click quant convert), 24 (featurize button), 29 (regression alerts), 31 (speed-context chart — NIAH covers it today), 34 (leaderboard filters — backend ready via norm_mode), 91+ covered in ROADMAP v2.
