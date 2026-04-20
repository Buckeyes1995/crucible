# Crucible — ROADMAP v2 (next 50)

Follow-up to `docs/ROADMAP.md`. Items already shipped or deferred from v1
are not repeated here. Grouped by theme; not ranked.

## Chat & UX (51–60)
51. **Chat forking tree UI** — visualize all the branches edit-and-branch produces, let the user hop between them.
52. **Chat pinned system prompts per session** — remember "this session uses the code-reviewer prompt".
53. **Multi-user avatars / per-user chat history** — when the backend runs behind a Cloudflare Access tunnel with multiple users, keep their conversations separate.
54. **Streaming response cancellation button** — current Stop only resets state; a real cancel would abort the upstream HTTP request.
55. **Response styles picker** — dropdown with "concise / creative / rigorous / playful" that pre-fills a matching system prompt.
56. **Emoji reactions on turns** — tap 👍 / 👎 / 🔄 on any assistant turn, feeds into recommender.
57. **Token usage per message** — hover a turn to see exact input + output token counts.
58. **Markdown render toggle** — today chat is `whitespace-pre-wrap`; let the user opt into rendered markdown per session.
59. **Message collapse on long outputs** — >500 chars collapses to first 10 lines + "show more".
60. **Chat voice output** — TTS of the assistant's reply, piped to a system audio device.

## Catalog & models (61–70)
61. **Auto-categorize from HF metadata** — when a model is added, scrape its model card and auto-assign capability chips.
62. **Wishlist auto-availability** — when an HF search result matches a wishlist entry, show it promoted at the top of /store.
63. **Download bandwidth limit** — global setting to cap HF downloader rate when other network tasks need priority.
64. **Per-model cost ledger** — estimated electricity cost per generation based on power draw × time.
65. **Related models widget** — "people who downloaded X also grabbed Y" from the curated catalog.
66. **Model diff (config)** — show what changed between two quants of the same model (context window, vocab, chat template).
67. **Delete-on-schedule** — mark a model "delete after N days if unused".
68. **Model favorites export** — one-click export of starred models as a curator JSONL for reinstall elsewhere.
69. **Ollama / mlx_lm / vLLM unified registry** — single view when a model is installed via multiple backends.
70. **Model aliases** — symlink-style: `code` → `mlx:Qwen3-Coder-Next-MLX-6bit`, works in chat slash commands.

## Benchmarks / evals (71–78)
71. **HumanEval pass@k** — run each problem k times, report pass-at-1 / pass-at-k / pass-at-all.
72. **Latency budgets** — flag benchmark runs where p99 > threshold.
73. **Comparison views** — side-by-side diff of two benchmark runs on the same model.
74. **Eval suite difficulty curves** — per-item pass rate across all models, identify items that are too easy / too hard.
75. **Custom scorer plugins** — users drop a Python file into `~/.config/crucible/scorers/` that exposes a `score(response) → bool`.
76. **Benchmark CI trigger** — run a preset bench on every new download automatically, publish to a shared leaderboard URL.
77. **Grouped arena** — run an N-vs-N tournament (group A vs group B) where each battle is a single model from each.
78. **Arena ELO decay** — optionally let unused models' ELO drift toward 1500 over time so the leaderboard reflects current preference.

## Code workflow (79–85)
79. **Code review mode** — drop a file or paste a patch, get a structured review using the built-in prompt (which Store ships).
80. **Git-aware chat session** — auto-inject the current `git diff` + `git status` as context whenever you open chat from a git repo (via the /git/context endpoint we already have).
81. **File search & load** — type a path in chat, preview the file, model can reference it.
82. **Snippet → installed prompt** — promote a snippet into a reusable prompt template in one click.
83. **Response → issue body** — one-click open a GitHub issue prefilled with the assistant's reply.
84. **Diff view across sessions** — compare two saved-code runs' outputs.
85. **Run history per snippet** — when a snippet gets re-run via the "Run" button, remember prior outputs.

## Agents & automation (86–92)
86. **Workflow marketplace** — similar to prompt marketplace but for hermes workflows; import with one click from a catalog.
87. **Agent health dashboard** — per-agent uptime, recent errors, last-run-at sparkline.
88. **Trigger from Slack** — DM bot that runs a workflow and returns the result.
89. **Scheduled benchmarks** — cron-workflow integration so the leaderboard refreshes automatically without manual runs.
90. **Multi-step batch pipelines** — extend /batch-pipeline so each prompt can be a chain of 2-3 models (cross-product of chain + batch).
91. **Tool call traces** — when MCP chat integration lands, show a timeline of `model → tool call → result → model` so users can debug prompts.
92. **Feedback loop** — rate workflow runs good/bad, auto-tune the template prompt based on aggregate feedback.

## Observability & ops (93–97)
93. **Prometheus metrics endpoint** — `/metrics` in OpenMetrics format so external monitoring can scrape.
94. **Alerting rules** — "notify me if TTFT exceeds 3s for any model" via the existing notification-routes.
95. **Distributed tracing** — propagate trace IDs through proxy → adapter → oMLX, render in the profiler.
96. **Backup schedule** — cron-driven rsync to a remote target, so backup-to-remote (50) becomes automatic.
97. **Disk quota enforcement** — auto-delete LRU models when `/Volumes/DataNVME/models` exceeds a configured quota.

## Emerging / big bets (98–100)
98. **Full MCP chat integration** — model uses installed MCP tools via function calling. Depends on deferred item #35.
99. **Crucible Collaborator** — a persistent "pair-programming" mode that stays across sessions, keeps a memory index, and proactively surfaces relevant past context.
100. **Fine-tune on my best chats** — extend the curator so "train a small LoRA on my favorite responses" is a single button.
