# Contributing to Crucible

Crucible is a local-first LLM workbench targeting Apple Silicon. PRs welcome
for bug fixes, small features, docs, and catalog entries.

## Catalog entries (models / prompts / workflows / MCPs)

Catalog lives in its own repo so everyone can contribute without needing
write access to the main codebase: **https://github.com/Buckeyes1995/crucible-store**

Use the "Propose entry" dropdown in the Store UI, or open an issue directly
with one of the structured templates in that repo.

## Code changes

**Layout**
- `backend/` — FastAPI app. One router per feature area in `routers/`. Modules
  outside routers are logic/state — they shouldn't import FastAPI.
- `frontend/` — Next.js 16 App Router. TypeScript, Tailwind, Zustand.

**Style**
- Python: type hints + docstrings. No `pip install` at import time.
- TypeScript: strict mode is on; prefer readable props over cleverness.
- CSS: Tailwind only; no CSS modules or styled-components.
- No ORM — raw SQL via `aiosqlite` for all DB access.

**Before submitting**
- `cd frontend && pnpm tsc --noEmit` — must pass.
- `cd frontend && pnpm build` — must succeed.
- If the change touches `backend/`, restart the backend and hit the relevant
  endpoint once with `curl`.
- If the change touches chat, arena, or /v1 proxy, give it one real prompt
  before calling it done.

**Commit style**
- Conventional-ish: `feat(area): short summary`, `fix(area): …`, `docs: …`.
- Commit messages explain the **why** in the body. The diff shows the what.
- Trailer: `Co-Authored-By:` is fine; respect others' boundaries on this one.

**Scope**
- Bundle related changes in one PR (chat slash commands + regenerate, yes).
- Split unrelated ones (chat feature + catalog seed, no).
- Touching API shapes? Update `docs/API.md` in the same commit.

## Testing

A full walkthrough lives at `docs/TEST_PLAN_2026_04_20.md`. Smoke-check the
area you touched; we don't gate PRs on running the whole plan.

## Running locally

```bash
cd backend && uv sync && source .venv/bin/activate && uvicorn main:app --port 7777
cd frontend && pnpm install && pnpm dev   # or pnpm build && pnpm start
```

You'll need an MLX backend (oMLX or mlx_lm.server) and at least one model in
`/Volumes/DataNVME/models/mlx/` (or whatever `mlx_dir` in
`~/.config/crucible/config.json` points to).

## Questions

Open a discussion. Crucible is built for one-person productivity first; we're
happy to generalize when PRs show up.
