# Hermes Agent Integration — Plan

Option 2 from the research doc: a small HTTP control sidecar on the Mac Mini that runs alongside stock hermes-agent, plus a new "Agents" section in Crucible that talks to it.

## Goals

- **One place to see whether hermes is alive** — status dot + last heartbeat on the Crucible dashboard.
- **Tail logs remotely** — no ssh'ing into the Mac Mini to debug a stuck session.
- **Trigger scheduled jobs on demand** — run a cron job out of schedule from the Crucible UI.
- **Pause / resume the agent** — stop hermes from picking up new work without killing its memory state.
- **Generalize to other agents** — Frigate event handler, Servarr, etc. — "Agent" is a first-class Crucible concept.

## Non-goals (for v1)

- Editing hermes config, skills, or prompts from Crucible.
- Live chat passthrough (you can already hit the platform gateway via Telegram/Signal/etc.).
- Modifying hermes internals. The sidecar reads its state; it does not write to `hermes_state.db`.
- Multi-user auth. LAN-only + shared bearer token.

## Architecture

```
┌──────────────────────┐        ┌────────────────────────────────────────┐
│  Mac Studio          │        │  Mac Mini (192.168.1.50)               │
│  ┌────────────────┐  │        │  ┌──────────────────┐                  │
│  │ Crucible       │  │ HTTP   │  │ hermes-control   │  reads  ┌──────┐ │
│  │ /agents page   │──┼────────┼─>│ (FastAPI, :7878) │────────>│~/.hermes│
│  │ routers/agents │  │        │  └──────────────────┘         │ .db/logs│
│  └────────────────┘  │        │        ▲                      └──────┘ │
│                      │        │        │ same process-user            │
│                      │        │        │ same filesystem              │
│                      │        │  ┌──────────────────┐                  │
│                      │        │  │ hermes-agent     │                  │
│                      │        │  │ (stock, gateway) │                  │
│                      │        │  └──────────────────┘                  │
│                      │        └────────────────────────────────────────┘
└──────────────────────┘
```

Two processes on the Mac Mini, both managed by launchd, both run as the same user so they share `~/.hermes/`:
1. **hermes-agent** — unchanged, stock install.
2. **hermes-control** — new sidecar project, ~100 lines of FastAPI.

## Sidecar: `hermes-control`

### Location

- Repo: new directory `~/projects/hermes-control/` on the Mac Mini (own git repo, pushed to GitHub separately from Crucible).
- Venv: `~/.venvs/hermes-control/`.
- launchd plist: `~/Library/LaunchAgents/com.jim.hermes-control.plist`.
- Port: **7878** (unused so far; 7777 is Crucible, 8000 is oMLX, 8090 is MLX Studio).

### File paths it reads

All inherited from stock hermes-agent layout:
- `~/.hermes/config.yaml` — current config (read-only surface for /status).
- `~/.hermes/hermes_state.db` — SQLite, SessionDB with FTS5. Queried with `SELECT * FROM sessions ORDER BY updated_at DESC LIMIT N`. Schema validated on sidecar startup; falls back gracefully if columns change upstream.
- `~/.hermes/logs/` — rolling log files. Tailed via `tail -n N` for the `/logs` endpoint.

### Files it writes (v2 only)

- `~/.hermes/control.pause` — touch-file for pause/resume. Hermes patch reads this on every loop tick. PR this to upstream once stable.

### HTTP endpoints

All responses JSON. All protected by shared bearer token in `~/.config/hermes-control/token` (matching `api_key` on the Crucible side).

```
GET  /health
     → { "status": "ok", "uptime_s": 12345, "hermes_pid": 8234 }

GET  /status
     → {
         "hermes_running": true,
         "hermes_pid": 8234,
         "last_session_at": "2026-04-18T...",
         "active_session_id": "abc123" | null,
         "recent_sessions": [{ id, title, updated_at, message_count }, ...],
         "paused": false,
         "config_path": "~/.hermes/config.yaml",
         "db_size_bytes": 12345678
       }

GET  /logs?tail=500&file=gateway.log
     → { "file": "gateway.log", "lines": ["...", "..."] }

GET  /logs/stream?file=gateway.log  (SSE — v2)
     → data: {"line": "..."}\n\n
     Tail -f equivalent.

GET  /cron
     → { "jobs": [{ "id", "name", "schedule", "last_run", "next_run", "last_status" }, ...] }

POST /cron/{id}/run
     → Triggers the job out-of-band. Writes a row to hermes's job-trigger table
       OR calls a small hermes API endpoint (depends on what stock exposes).
       Returns { "triggered": true, "job_id": "..." }.

POST /pause   (v2 — requires hermes patch)
     → Writes ~/.hermes/control.pause. Hermes sees flag, finishes current turn,
       stops picking up new work.

POST /resume  (v2)
     → Removes the pause file.

POST /restart
     → Calls `launchctl kickstart -k gui/<uid>/com.user.hermes-agent`.
       Returns { "restarted": true, "old_pid": 8234, "new_pid": 8310 }.
```

### Authentication

Shared bearer token:
- Generated once: `openssl rand -hex 32 > ~/.config/hermes-control/token`.
- Sidecar reads on start; requires `Authorization: Bearer $TOKEN` on every request.
- Crucible stores the same token in its config, sends it when calling the agent.
- Rotate by regenerating on both sides.

### Error handling

- Any endpoint returns `503 { "error": "hermes not running" }` if hermes PID isn't found.
- Schema mismatches on SessionDB return `{ "recent_sessions": [], "warning": "schema_unknown" }` rather than 500. Future-proof against hermes upstream changes.
- SQLite is opened read-only (`mode=ro`) to guarantee sidecar can't corrupt hermes state.

### Deployment

1. `git clone <hermes-control repo> ~/projects/hermes-control`
2. `/opt/homebrew/bin/python3.13 -m venv ~/.venvs/hermes-control`
3. `~/.venvs/hermes-control/bin/pip install -r requirements.txt` (FastAPI + uvicorn + aiosqlite)
4. `mkdir -p ~/.config/hermes-control && openssl rand -hex 32 > ~/.config/hermes-control/token`
5. Copy `packaging/com.jim.hermes-control.plist` to `~/Library/LaunchAgents/`
6. `launchctl load -w ~/Library/LaunchAgents/com.jim.hermes-control.plist`
7. Verify: `curl -H "Authorization: Bearer $(cat ~/.config/hermes-control/token)" http://localhost:7878/health`

## Crucible side

### Backend

**New file: `backend/routers/agents.py`**

```
GET  /api/agents              # list configured agents + their live status
POST /api/agents              # register an agent (body: name, url, token)
DELETE /api/agents/{name}     # remove
POST /api/agents/{name}/pause
POST /api/agents/{name}/resume
POST /api/agents/{name}/restart
POST /api/agents/{name}/cron/{job_id}/run
GET  /api/agents/{name}/logs?tail=500
GET  /api/agents/{name}/logs/stream  (SSE passthrough)
```

Internally: thin proxy. Crucible doesn't parse hermes's JSON shapes beyond what's needed for the summary status. Log streams are plain pass-throughs of the sidecar's SSE.

**Config addition to `config.py`:**

```python
class AgentConfig(BaseModel):
    name: str
    url: str           # http://192.168.1.50:7878
    api_key: str       # bearer token
    kind: str = "hermes"  # future: "frigate", "servarr", etc.

class CrucibleConfig(BaseModel):
    ...
    agents: list[AgentConfig] = []
```

**Storage:** lives in `~/.config/crucible/config.json` alongside everything else.

### Frontend

**New file: `frontend/app/agents/page.tsx`**

Grid of agent cards:

```
┌─────────────────────────────────────────────┐
│ hermes                        ● Running      │
│ 192.168.1.50:7878                           │
│ PID 8234 · uptime 3d 14h · paused: no       │
│ ───────────────────────────────────────────  │
│ Recent sessions                              │
│   - "remind me tomorrow"     2 min ago      │
│   - "Discord #bots"          14 min ago     │
│ ───────────────────────────────────────────  │
│ Cron (4)                                     │
│   ● daily-summary   09:00   ran 8h ago  ▶  │
│   ● check-inbox     */15    ran 3m ago  ▶  │
│ ───────────────────────────────────────────  │
│ [ Pause ]  [ Restart ]  [ View logs ]       │
└─────────────────────────────────────────────┘
```

**Sidebar entry:** add "Agents" section under Manage.

**Log viewer:** dedicated panel opened from "View logs" — live-tail via SSE, scroll-follows-output, pause-scroll on mouseover, keyword filter.

### Settings

Settings page gets a new **Agents** card:

```
┌─── Agents ────────────────────────────┐
│  Registered agents:                    │
│  • hermes                       [ edit ] [ remove ]
│    http://192.168.1.50:7878            │
│                                        │
│  [ + Add agent ]                       │
└────────────────────────────────────────┘
```

Add dialog: name, URL, bearer token fields. Test button verifies `/health` before saving.

## Phased delivery

### Phase 1 — read-only MVP (2 days)

Goal: see if hermes is alive from the Crucible UI.

Sidecar:
- `/health`, `/status` (recent sessions only — skip cron for v1)
- `/logs?tail=N`
- Bearer auth

Crucible:
- `routers/agents.py` with proxy for those three endpoints
- `app/agents/page.tsx` with read-only status card
- Settings UI to register the agent
- Log viewer modal (tail only, no SSE yet)

Ship it. Use for a few days. See what breaks.

### Phase 2 — interactive controls (2 days)

- `/restart` via `launchctl kickstart -k` (no hermes changes — just manages the service).
- `/cron` list by reading SessionDB or tailing log output for cron entries (inspect upstream schema first).
- `/cron/{id}/run` — best-effort; depends on whether stock hermes exposes a job trigger hook. Fallback: document "not yet supported, contribute upstream".
- Frontend: Restart and per-cron "run now" buttons.

### Phase 3 — pause/resume + SSE logs (3 days)

- Submit a tiny hermes PR adding a pause-flag check in the main loop: `if Path.home().joinpath(".hermes/control.pause").exists(): await asyncio.sleep(5); continue`.
- Sidecar: `/pause`, `/resume` that touch/remove the file.
- SSE log streaming endpoint + frontend live-tail viewer.

Phases 2 and 3 can ship out of order or skip if upstream doesn't cooperate.

## Open questions to validate on the Mac Mini

Before coding, confirm these by ssh'ing in and running a few commands:

1. **Exact SQLite schema.**
   ```
   sqlite3 ~/.hermes/hermes_state.db ".schema"
   sqlite3 ~/.hermes/hermes_state.db "SELECT * FROM sessions LIMIT 3"
   ```
   Sidecar queries adapt to whatever columns actually exist.

2. **Log file locations + rotation pattern.**
   ```
   ls -la ~/.hermes/logs/ || ls -la ~/.hermes/ | grep log
   ```

3. **launchd service name.**
   ```
   launchctl list | grep -i hermes
   ```
   So `/restart` knows what to kickstart.

4. **Cron job storage.**
   ```
   sqlite3 ~/.hermes/hermes_state.db "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%cron%'"
   ```
   Or find where `cron/scheduler.py` persists state.

5. **Hermes's main process — can it be queried for status natively?**
   ```
   hermes --help
   hermes status  # might already exist
   ```
   If stock has a status CLI, sidecar can shell out to it instead of reading SQLite directly.

## Future extensions

Once the `Agent` abstraction exists, adding more is cheap:

- **Agent #2: Frigate events router** — runs on Mac Mini, listens to Frigate MQTT, routes interesting clips to a Discord channel. Implements same 6 endpoints.
- **Agent #3: NAS task runner** — Synology scheduled scripts, backup monitoring.
- **Agent #4: External remote node** — connects to another Crucible instance on a different machine, shows as an agent too.

Each one is ~100 lines of FastAPI. Crucible's `agents` page auto-renders them.

## Files to create (summary)

New repo `hermes-control/`:
- `hermes_control/main.py` — FastAPI app
- `hermes_control/state_reader.py` — SQLite + log tail helpers
- `hermes_control/launchd.py` — kickstart / stop helpers
- `hermes_control/auth.py` — bearer token middleware
- `requirements.txt`
- `packaging/com.jim.hermes-control.plist`
- `README.md`

Additions to Crucible:
- `backend/routers/agents.py`
- `backend/models/agent.py` (AgentConfig type + response models)
- Update `backend/config.py` — add `agents: list[AgentConfig]`
- `frontend/app/agents/page.tsx`
- `frontend/app/agents/layout.tsx` (dynamic, same pattern as /diff)
- `frontend/components/Sidebar.tsx` — add "Agents" nav entry under Manage
- Update `frontend/app/settings/page.tsx` — agents card
- Update `frontend/lib/api.ts` — `api.agents.*` functions and types

## Risk & dependencies

- **Hermes schema drift.** If upstream changes SessionDB columns, our SELECT breaks. Mitigate with defensive queries (`SELECT * ... LIMIT 0` to inspect columns at startup) and graceful fallbacks.
- **Pause/resume requires a patch.** Phase 3 is contingent on either NousResearch merging the 15-line patch or on us maintaining a fork. Both fine.
- **Cron trigger requires cooperation.** If stock cron has no "run this job now" hook, we document the limitation and contribute upstream.
- **Security.** LAN-only + bearer token is fine for now; if you ever expose via Cloudflare tunnel, add proper auth (OIDC or Cloudflare Access) like Crucible already does.
