# Crucible — ROADMAP v3 (50 more, 2026-04-21)

Follow-up to [ROADMAP.md](ROADMAP.md) and [ROADMAP_V2.md](ROADMAP_V2.md). Items
marked **⭐ major** require substantial design or cross-cutting changes;
everything else is a discrete smaller ship.

## Chat & conversation (104–115)
104. ⭐ **Markdown renderer toggle** — bold/italic/tables/links/ordered-and-unordered-lists/blockquotes properly rendered instead of `whitespace-pre-wrap`. Per-session opt-out for users who prefer raw.
105. ⭐ **Conversation branching tree view** — visualize all branches created by "Edit & branch" as a mini graph. Hop between branches with one click; see which branch diverged where.
106. **Chat session tagging** — per-session tags stored on `chat_sessions`. Tag editor inline on history page. Filter by tag in the list.
107. **Pinned sessions** — star a session to keep it at the top of `/chat/history` regardless of recency. Persisted.
108. **Multi-select turn operations** — checkbox-select N turns and apply (export selected / bookmark all / pin all). Good for pulling clean training data out of long chats.
109. **Continue-stale banner** — when resuming a session older than 24h, show a "last turn was N days ago" banner so the model context gets a date anchor.
110. **Voice output** — ⌘R on an assistant turn runs `say` (macOS TTS) with the reply. Handy for hands-busy listening.
111. **Chat message reactions** — 👍/👎/🔄 per turn; counts feed into the recommender score alongside arena ELO.
112. **Split view** — two chat panels side-by-side, same prompt, different sessions or same session different model. Richer than arena because each side keeps history.
113. **Message collapse on long outputs** — >500 chars collapses to 10 lines + "show more" to avoid wall-of-text scrolling.
114. **Session search in history page** — full-text filter across all chat turns (already have backend endpoint; UI follow-up).
115. **Per-session pinned system prompt memory** — Crucible remembers which system prompt was set when a session was last active; restore automatically on resume.

## Code workflow (116–123)
116. ⭐ **Inline syntax highlighting** — replace plain-text fenced code with a real highlighter (hljs / Prism / shiki). Apply to chat, arena, diff, snippets, gists.
117. **ZIP download for multi-file outputs** — one-click download of every code block in a response as a zipped folder.
118. **Save-anywhere output** — pick an arbitrary destination directory for saved code, not just the sandbox. Opt-in; requires the universal file picker from v2 #101.
119. **Copy as markdown** — fenced code block action to copy the block wrapped in its language fence, ready to paste into a markdown doc.
120. **"Send to chat" from snippet** — from the snippets page, pipe the snippet's content into a new chat turn with a prompt prefix.
121. **Snippet tags editor** — inline tag editing on the snippets page (tags field exists; UI for add/remove/rename).
122. **Import snippet from gist URL** — paste a GitHub gist URL, Crucible fetches and saves as a snippet.
123. **Diff two arena code outputs** — side-by-side diff of the code blocks from Slot A and Slot B once the battle is voted on.

## Models & catalog (124–133)
124. ⭐ **Mid-conversation model swap** — change model on the active chat without resetting history; new turns use the new model. Currently "new chat" is the only way.
125. **Model usage leaderboard** — `/models/leaderboard` aggregates chat-session count, bench runs, arena ELO per model. Shows which models you actually reach for.
126. **Per-model bench sparkline on cards** — mini tok/s trend from the last N auto-benches so you can see if a model regressed.
127. **Download pause/resume UI** — pause button on active download rows (cancel + resume endpoints exist; needs the pause button).
128. **Auto-download from wishlist** — when free disk exceeds threshold + a wishlisted model is available, notify / optionally auto-pull.
129. **Bulk wishlist import** — paste or upload a JSONL of HF repo IDs → add all to wishlist at once.
130. **HF organization watcher** — subscribe to an HF org (e.g. `mlx-community`, `z-lab`), get a notification when they publish a new model.
131. **"Verified" badge** — model that's passed N auto-benches and an eval-suite run gets a small badge so you know it works end-to-end.
132. **Smart model suggestion** — based on the current chat's prompt, suggest the best-fit model in a subtle banner ("this looks like code — Qwen3-Coder-Next would be faster").
133. **Model compare matrix (hover)** — hovering a model name anywhere shows a popover with size / tps / context / capabilities.

## Benchmarks & evals (134–141)
134. ⭐ **Benchmark diff report** — pick two runs → side-by-side table with tok/s, TTFT, pass rate deltas. Flag regressions red, wins green.
135. **Eval-suite failure gallery** — for a failed eval item, show the model response + expected substring + why it failed. Good for prompt debugging.
136. **Persistent bench scheduler UI** — `/benchmark/schedules` page (API exists).
137. **Benchmark CSV / PDF export** — download any run as a shareable report.
138. **Gold-standard designation** — mark one model as "gold"; all benchmark tables show delta from gold so you can see +/- at a glance.
139. **Prompt regression detector** — same prompt + same model + different params → show what changed in the output.
140. **Latency histogram** — per-model TTFT and tok/s distributions rather than just averages.
141. **Public leaderboard share** — opt-in publish of your arena leaderboard to a shareable URL (just a static JSON dump behind the tunnel).

## Observability & ops (142–148)
142. ⭐ **Prometheus metrics endpoint** — `/metrics` in OpenMetrics format so external monitoring (Prometheus, Grafana Cloud) can scrape without building a custom integration.
143. **Structured audit log** — every admin action (delete model, change engine, install MCP) recorded with actor / timestamp / before-after.
144. **Download ETA prediction** — use historical throughput per-domain to predict remaining time more accurately than "bytes/sec * remaining".
145. **Disk-space warning banner** — global banner when `/Volumes/DataNVME` drops below 10GB. Click → jump to /disk for bulk-reclaim.
146. **Uptime chart** — per-hour up/down history for the last 30 days, green/red bars.
147. **Error rate dashboard** — bucketed error counts per hour by taxonomy category (OOM, auth, network, etc.). Quick answer to "is something broken today?".
148. **Per-adapter health ping** — active probe every 60s: is oMLX responsive? mlx_lm? llama-server? Surface on the Ops page.

## Privacy & security (149–153)
149. ⭐ **API-key route scoping** — per-key allow-list of routes (e.g. key X can only hit `/v1/chat/completions`, not `/api/models/delete`). For shared tunnel use.
150. **Request audit trail** — per-key log of which endpoints were called, when, by IP. Complement to the audit log.
151. ⭐ **Chat history encryption-at-rest** — opt-in SQLite encryption for the chat history DB.
152. **Per-session ephemeral mode** — turn on "don't persist" for a specific chat; turns vanish on close.
153. **GDPR-style data export** — button that dumps all of a user's data (chat, snippets, benchmarks) into a single zip.

## Integrations (154–158)
154. ⭐ **GitHub discussion drafter** — same pattern as Reddit watcher but for GitHub repo discussions. Auth via fine-grained PAT.
155. **Linear issue drafting** — model reads recent commits + open PRs, drafts Linear issue titles/descriptions.
156. **Obsidian vault dumper** — one-click export of chat history or snippets into an Obsidian vault as linked markdown.
157. **Slack DM assistant** — Slack bot that proxies to a workflow, returns the result inline.
158. **Notion page creator** — pipe a chat or snippet to a new Notion page with proper heading/code block structure.

## Accessibility & help (159–161)
159. **Keyboard shortcut cheat sheet** — `?` key opens a modal listing every keyboard shortcut across the app.
160. **Screen-reader-friendly tables** — audit benchmark / arena / snippet tables for proper ARIA markup.
161. **Large-text mode** — one-click zoom all text +20% for long reading sessions.

## Onboarding (162–163)
162. ⭐ **First-run wizard** — when `/models` is empty, walk the user through: pick model dir → download first model → chat. Takes someone from clone to working in <5 minutes.
163. **In-app "What's new" bump** — on version change, show a dismissible panel listing the last release's shipped items from CHANGELOG.md.

## Follow-ups surfaced during 2026-04-21 eval
164. **Leaderboard: split metric + window toggles** — current UI mixes "Tokens / Hours / Chat / Bench / …" (what to measure) with "(lifetime) / (24h)" (time window) in one button group. Separate into two rows: top row = metric, second row = window (Lifetime / 24h / 7d / 30d). Also add 7d + 30d rollups to the backend.
165. **Benchmark diff — UX rework** — shipped as per-model tables, then merged into a single table with A / B / A+B source pills, but still confusing when the two runs don't overlap on (model, prompt). Want: default to only showing shared rows + a "show A-only / show B-only" toggle; maybe separate "new in this run" and "dropped since last run" callouts; consider whether this page should require overlap to be useful, or whether it should be renamed "runs compared" and explicitly admit the no-overlap case.
166. **oMLX DFlash breakage — better error surfacing** — current installed oMLX has a broken DFlash code path (`generate_dflash_once() got an unexpected keyword argument 'temperature'`); warmup crash surfaces as generic "peer closed connection without sending complete message body." Crucible should pattern-match oMLX warmup failures that mention DFlash / `generate_dflash_once` and surface actionable guidance: "DFlash is currently broken on this oMLX build — disable DFlash for this model in Notes, or upgrade/rebuild oMLX." Optionally offer a one-click disable on the error banner. Track upstream oMLX fix separately.
167. **Load-error UX: restore previous active model + show error banner** — today, `loadModel` nulls `activeModelId` at the start and leaves it null on failure. Result: after a bad load the chat page says "No model loaded" even though the previous model is still warm on oMLX (or cleanly recoverable). Keep a `prevActiveModelId` in the store; on SSE error event, restore it, and render a dismissible error banner with the failure message. Should also clear gracefully on the next successful load.
