# Deferred roadmap items

Features from the 50-item roadmap that need more scoping than a single day.
Captured here so the ideas aren't lost; each has a concrete plan for when
someone picks it up.

## 10 — Voice input (Whisper mic button)

**Scope**: record via `MediaRecorder`, POST audio to a new `/api/whisper/transcribe`,
insert the returned text into the chat input. Backend hosts `whisper.cpp` or
the MLX Whisper build.

**Blockers**: we don't currently ship / manage a Whisper model. Add it to the
Store catalog, a loader adapter, and a transcription endpoint before wiring
the UI button.

## 14 — REPL panel (interactive Python/Node/shell)

**Scope**: long-lived subprocess per chat / arena session, writes stream
back via SSE. The Run-this button in SaveCodeButton is one-shot; this is
persistent-state.

**Blockers**: lifecycle — when does a REPL end? Sandboxing — not every
snippet is safe to pipe into a live shell. Land a session registry + a
user-confirmation-to-start flow before touching the UI.

## 35 — MCP chat integration (real function calling)

**Scope**: surface installed MCP tools (from `mcp_host.py`) as function-calling
tools during chat. Requires:
- A tool-call parser in the chat adapter layer (oMLX emits tool calls in a
  specific shape; adapters would need to canonicalize).
- Multi-turn tool-call loop in the chat store — model says "use tool X",
  Crucible calls it, feeds result back, model continues.
- Per-tool user-confirmation UX (don't silently run destructive tools).

**Blockers**: model support is inconsistent. Qwen3.6 supports a specific
format, Llama 3.3 another. Starting with a single well-supported model is
the practical path; broad adapter-level support is a phase 2.

## 37 — Hermes skill library (browse + toggle)

**Scope**: UI on the Agents page that lists hermes skills and lets the user
flip them on/off per conversation. Crucible already knows how to talk to
hermes; it doesn't currently enumerate its skill set.

**Blockers**: hermes doesn't expose a `/skills` endpoint yet. Either extend
hermes with one, or scrape the config file over SSH. Scope once hermes
ships the endpoint.

## 39 — RAG per-document chunking configs

**Scope**: extend the upload flow so each document carries its own
`{chunk_size, chunk_overlap, retrieval_count, strategy}` — some docs are
better chunked by paragraph, others by markdown heading.

**Blockers**: current RAG index is a flat BM25 over all chunks. Need to tag
chunks with their source config, and re-index on config change. Not a huge
rewrite, but big enough to warrant its own pass.

## 40 — Hybrid BM25 + embedding retrieval

**Scope**: swap (or augment) the current BM25 with a sentence-transformers
embedding index (Qwen3 embeddings or similar). Reciprocal rank fusion to
combine.

**Blockers**: embedding model hosting — do we spawn a second oMLX instance
or pin a specific embedding model? Index persistence. Index invalidation on
document update. Biggest lift in the whole list — plan to do this alongside
#39.
