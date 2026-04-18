# Hermes Agent Integration — Plan (revised after Mac Mini discovery)

Option 2 from the research doc. After SSH'ing into the Mac Mini, the real setup is **much friendlier** than we first assumed — hermes runs in Docker (OrbStack) with its state bind-mounted to the host filesystem. That means Crucible's integration can run as a small native process that reads JSON/SQLite files directly and drives the container via `docker` CLI. No hermes fork, no upstream patch, no in-container sidecar.

## Actual setup on the Mac Mini

- **Runtime**: OrbStack (Docker) at `/Applications/OrbStack.app`, CLI at `/usr/local/bin/docker`
- **Container**: `hermes-agent` (image `nousresearch/hermes-agent:latest`), up ~31h, restart policy `unless-stopped`
- **Compose file**: `~/docker-projects/hermes-agent/docker-compose.yml`
- **Command**: `gateway` (the messaging daemon)
- **LLM endpoint**: `OPENAI_BASE_URL=http://192.168.1.25:7777/v1` — already points at Crucible
- **Port 3000** exposed — non-HTTP (JSON-RPC used by the TUI). Not useful for control.
- **Bind-mounted state** at `~/docker-projects/hermes-agent/data/`:

| Path | What |
|---|---|
| `data/state.db` | SQLite session/memory DB |
| `data/config.yaml` | Hermes config (10 KB) |
| `data/cron/jobs.json` | Cron job definitions (readable JSON, ~4 KB) |
| `data/cron/output/` | Per-run output files |
| `data/cron/.tick.lock` | Cron tick lockfile (updates every cycle → heartbeat) |
| `data/sessions/session_*.json` | Session transcripts, incl. `session_cron_*.json` |
| `data/logs/agent.log`, `errors.log`, `gateway.log` | 1 MB each, tailable |
| `data/gateway_state.json` | Gateway runtime state |
| `data/channel_directory.json` | Platform channel registry |
| `data/.env` | Secrets (mode 0600) — never read/expose |

**Known noise**: 4 orphan `hermes-agent-hermes-agent-run-*` containers from past `docker compose run` invocations have been up 3–8 days. Sidecar should surface them so we can prune.

**Known issue**: gateway.log is spamming `[Email] IMAP fetch error: AUTHENTICATIONFAILED`. Not ours to fix, but we'll want a "filter noise" toggle on the log viewer.

## Revised architecture

```
┌──────────────────────┐        ┌──────────────────────────────────────────────┐
│  Mac Studio          │        │  Mac Mini (192.168.1.50)                     │
│                      │        │                                              │
│  ┌────────────────┐  │  HTTP  │  ┌────────────────────┐                      │
│  │ Crucible       │  │        │  │ hermes-control     │                      │
│  │ /agents page   │──┼────────┼─>│ (FastAPI, :7878)   │                      │
│  │ routers/agents │  │  bearer│  └──────────────────┬─┘                      │
│  └────────────────┘  │        │       │ reads bind  │ docker CLI             │
│                      │        │       │ mount files │                        │
│                      │        │       ▼             ▼                        │
│                      │        │  ┌──────────────┐  ┌────────────────────┐   │
│                      │        │  │ ~/docker-    │  │ OrbStack /         │   │
│                      │        │  │ projects/    │  │ Docker daemon      │   │
│                      │        │  │ hermes-agent/│  │                    │   │
│                      │        │  │ data/        │  │ container:         │   │
│                      │        │  │  state.db    │◄─┤ hermes-agent       │   │
│                      │        │  │  cron/       │  │ (image:            │   │
│                      │        │  │  logs/       │  │ nousresearch/...)  │   │
│                      │        │  │  sessions/   │  └────────────────────┘   │
│                      │        │  └──────────────┘                            │
└──────────────────────┘        └──────────────────────────────────────────────┘
```

The sidecar runs **natively on the Mac Mini** (not inside a container). It has two data sources:

1. **Filesystem** — read-only access to `~/docker-projects/hermes-agent/data/` for status, cron, sessions.
2. **Docker CLI** — `docker logs`, `docker pause/unpause`, `docker restart` for container lifecycle.

## Why this is better than the first plan

| What | Original plan | Revised plan |
|---|---|---|
| Pause/resume | Required hermes fork + upstream PR | `docker pause hermes-agent` — built in, free |
| Restart | Needed launchd kickstart command | `docker restart hermes-agent` — clean |
| Logs | Read log files directly | Either file tail OR `docker logs --tail N` (prefer latter — handles log rotation automatically) |
| Session state | SQLite with guessed schema | Session JSON files are easy + `state.db` is SQLite we read read-only |
| Cron | Unknown storage format | `cron/jobs.json` is plain JSON ✓ |
| Trigger cron on-demand | Needed upstream API | Write a marker file into `cron/` or append to `jobs.json`, then signal container (`docker kill -s SIGUSR1` if supported; otherwise a scheduled tick picks it up) — still TBD, but more leverage |
| Auth / bearer token | Same | Same |

Pause/resume and restart are now free. Cron on-demand trigger is the last unknown — we may need to read hermes's cron code to see how it ingests new jobs mid-run.

## Sidecar: `hermes-control`

### Project location (on Mac Mini)

- Repo: `~/projects/hermes-control/` (separate git repo from Crucible)
- Venv: `~/.venvs/hermes-control/`
- launchd plist: `~/Library/LaunchAgents/com.jim.hermes-control.plist`
- Listening port: **7878**
- Config/token: `~/.config/hermes-control/` (mode 0700)

### Shape

```
hermes-control/
├── pyproject.toml
├── README.md
├── packaging/
│   └── com.jim.hermes-control.plist
└── hermes_control/
    ├── __init__.py
    ├── main.py              # FastAPI app + routes
    ├── auth.py              # bearer token dependency
    ├── docker_ctl.py        # wraps `docker` subprocess for pause/unpause/restart/logs
    ├── state_reader.py      # reads data/state.db (ro), cron/jobs.json, sessions/*.json
    └── config.py            # reads ~/.config/hermes-control/config.json
```

### Endpoints (full v1+v2 — phased below)

All require `Authorization: Bearer $TOKEN`. All JSON.

```
GET  /health
     → { status, uptime_s, host, container_exists, container_running }

GET  /status
     → {
         container: { name, status, image, started_at, uptime_s, restart_count },
         hermes: {
           paused: bool,                  # from docker state
           last_tick_at: iso8601 | null,  # from cron/.tick.lock mtime
           active_sessions: int,          # session_*.json without "ended_at"
           recent_session_ids: [...]      # last 20
         },
         cron: { job_count, next_run_at },
         logs: { agent_bytes, errors_bytes, gateway_bytes },
         orphans: [{ name, uptime_s }]    # hermes-agent-*-run-* containers
       }

GET  /sessions?limit=50&offset=0
     → [{ id, started_at, ended_at, message_count, source, title }]
     # "source" = "chat" | "cron" | platform name

GET  /sessions/{id}
     → full session JSON (read-only)

GET  /cron
     → { jobs: [{ id, name, schedule, command, last_run, next_run, last_status }] }
     # parsed from cron/jobs.json + last output timestamps from cron/output/

POST /cron/{id}/run                # v2 — pending hermes feasibility check
     → triggers out-of-schedule. Implementation TBD (signal vs. file flag).

GET  /logs?tail=500&file=gateway.log&filter=ERROR
     → { file, lines: [...] }
     # backed by `docker logs --tail N hermes-agent` (preferred) or file tail

GET  /logs/stream?file=gateway.log  # v2 — SSE live tail

POST /pause                        # v1 — docker pause
POST /resume                       # v1 — docker unpause
POST /restart                      # v1 — docker restart

POST /orphans/prune                # v2 — docker rm $(docker ps -aq --filter "name=hermes-agent-*-run-")
                                   # (stopped ones only; guard against removing the active one)
```

### Bearer token

- Generated once: `openssl rand -hex 32 > ~/.config/hermes-control/token`
- Sidecar reads on startup, requires the header on every request
- Same token goes into Crucible's `config.json` alongside the agent URL
- Rotate by regenerating both sides

### Error handling

- `container_exists=false` — return 200 with that field false, not 503. Crucible renders "container not found" state.
- `docker` command timeout (10 s default) — return 504 with `{"error": "docker command timed out"}`.
- JSON parse failure on any `data/*.json` — return partial state with `warnings: [...]`.
- `state.db` opened with `mode=ro` URI. Sidecar can never corrupt hermes state.
- Orphan detection is best-effort — if `docker ps` is slow, skip it rather than blocking `/status`.

### Deploy steps

```bash
# On Mac Mini
git clone <repo> ~/projects/hermes-control
cd ~/projects/hermes-control
/opt/homebrew/bin/python3.13 -m venv ~/.venvs/hermes-control
~/.venvs/hermes-control/bin/pip install -e .

# token
mkdir -p ~/.config/hermes-control
openssl rand -hex 32 > ~/.config/hermes-control/token
chmod 600 ~/.config/hermes-control/token

# launchd
cp packaging/com.jim.hermes-control.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.jim.hermes-control.plist

# verify
curl -H "Authorization: Bearer $(cat ~/.config/hermes-control/token)" \
     http://localhost:7878/health
```

## Crucible side

### Backend

**New: `backend/routers/agents.py`**

```python
GET    /api/agents                      # list registered + live status summary
POST   /api/agents                      # register { name, url, api_key, kind }
PUT    /api/agents/{name}               # update
DELETE /api/agents/{name}               # remove

# Proxy-style pass-throughs (add bearer token header from stored config):
GET    /api/agents/{name}/status
GET    /api/agents/{name}/sessions
GET    /api/agents/{name}/sessions/{id}
GET    /api/agents/{name}/cron
POST   /api/agents/{name}/cron/{id}/run
GET    /api/agents/{name}/logs
GET    /api/agents/{name}/logs/stream   # SSE passthrough
POST   /api/agents/{name}/pause
POST   /api/agents/{name}/resume
POST   /api/agents/{name}/restart
POST   /api/agents/{name}/orphans/prune
```

**Config (`backend/config.py`):**

```python
class AgentConfig(BaseModel):
    name: str
    url: str                         # http://192.168.1.50:7878
    api_key: str                     # bearer token
    kind: str = "hermes"             # future: "frigate", "servarr"

class CrucibleConfig(BaseModel):
    ...
    agents: list[AgentConfig] = []
```

Stored in `~/.config/crucible/config.json`.

### Frontend

**New: `frontend/app/agents/page.tsx`** + **`layout.tsx`** (same `dynamic = "force-dynamic"` pattern as /diff to avoid the cache issue we just hit).

Grid of agent cards:

```
┌────────────────────────────────────────────────────────┐
│ hermes                                   ● Running     │
│ 192.168.1.50:7878 · nousresearch/hermes-agent:latest   │
│ uptime 31h · 3 orphan containers [ prune ]             │
│ ──────────────────────────────────────────────────────── │
│ Recent sessions                                         │
│   chat  "remind me tomorrow"          2m ago  (12 msgs)│
│   cron  session_cron_d794...          8h ago  (4 msgs) │
│   chat  Discord #bots                14m ago  (3 msgs) │
│                                        [ view all → ]  │
│ ──────────────────────────────────────────────────────── │
│ Cron (6)                                                │
│   ● daily-summary       09:00   ran 8h ago     ▶ run   │
│   ● check-inbox         */15    ran 3m ago     ▶ run   │
│   ● weekly-digest       Mon 09  ran 3d ago     ▶ run   │
│                                        [ view all → ]  │
│ ──────────────────────────────────────────────────────── │
│ [ Pause ]  [ Restart ]  [ Logs ]  [ Settings ]         │
└────────────────────────────────────────────────────────┘
```

**Log viewer** — modal or dedicated page, live-tail via SSE, filter box (pre-populated with "ERROR" to cut the IMAP spam), pause-on-hover, follow-scroll toggle.

**Sessions list** — paginated, click to view full transcript (read-only).

**Settings** — Agents card to add/edit/remove. "Test" button verifies `/health` before saving.

**Sidebar** — add "Agents" entry under Manage.

## Phased delivery

### Phase 1 — Read-only MVP (2–3 days)

Ship status, logs, sessions. No control yet.

**Sidecar:** `/health`, `/status`, `/sessions`, `/sessions/{id}`, `/logs` (polled, no SSE), `/cron` (read-only)

**Crucible:** `routers/agents.py` with proxy passthroughs, `app/agents/page.tsx` with status card + sessions list + cron list + log viewer (polled tail).

**Exit criteria:** from Crucible I can see hermes is alive, see the cron job list, read the last 500 log lines, view a recent session transcript. Deploy, live with it.

### Phase 2 — Lifecycle control (1–2 days)

**Sidecar:** `/pause`, `/resume`, `/restart` (all one-liners — docker CLI), `/orphans/prune`.

**Crucible:** buttons wired up, confirmation dialogs. Status card shows "paused" / "running" from docker state.

**Exit criteria:** I can pause / resume / restart hermes from the dashboard without SSH.

### Phase 3 — Polish (1–2 days)

**Sidecar:** `/logs/stream` (SSE live tail).

**Crucible:** live-tail log viewer, keyword filter, scroll-follow toggle.

**Exit criteria:** live log viewer feels as good as `docker logs -f`.

### Phase 4 — Cron on-demand triggers

Needs upstream investigation. Read hermes's `cron/scheduler.py` to see if the tick loop ever re-reads `jobs.json` mid-run. If so, appending a one-off entry with `next_run = now` works. Otherwise, skip this phase and document manual fallback (`docker exec hermes-agent hermes cron run <id>` if that CLI exists).

## What to validate before coding

Phase 1 is safe to scaffold — we know the file layout. Before Phase 4, we need to:

1. Check if hermes's scheduler watches `cron/jobs.json` for changes at runtime (vs. loads it once on startup).
2. Find the Python module path for cron scheduler inside the container image: `docker exec hermes-agent find / -name "scheduler.py" -path "*/cron/*" 2>/dev/null`.
3. See if there's a `hermes cron` CLI inside the container: `docker exec hermes-agent hermes --help | grep cron`.

## Open considerations

- **Cleanup the orphan containers** before shipping Phase 2 — they're piling up at 1 per few days. Sidecar should surface them, user can prune with one click.
- **Email auth spam** — cosmetic but pollutes logs. User should fix IMAP creds or disable the email platform in hermes config. Sidecar log viewer can filter it.
- **Port 3000** — expose to hermes's TUI if needed, but not our concern. Sidecar ignores it.
- **Security** — sidecar is LAN-only with bearer token. If ever exposed via Cloudflare tunnel, add Cloudflare Access like Crucible already does.

## Future extensions

Once the `Agent` abstraction lands, adding more is cheap:

- **Frigate events router** — runs on Mac Mini, watches `/clips/` directory and Frigate MQTT. Sidecar exposes same 6 endpoints pattern.
- **Servarr stack monitor** — Sonarr/Radarr status, queue, recent grabs.
- **NAS task runner** — Synology cron status.
- **Remote Crucible node** — connect to another Crucible instance; models from there show up as remote, sidecar-style control for it.

Each new agent is ~100 lines of FastAPI. Crucible's `/agents` page auto-renders them.

## Files to create / touch

**New repo `hermes-control/`:** 5 Python files (~400–500 lines total), `pyproject.toml`, `README.md`, launchd plist.

**Crucible additions:**
- `backend/routers/agents.py` (~200 lines)
- `backend/models/agent.py` (types)
- `backend/config.py` — add `agents: list[AgentConfig]`
- `frontend/app/agents/page.tsx` (~300 lines)
- `frontend/app/agents/layout.tsx` (dynamic cache control)
- `frontend/components/Sidebar.tsx` — "Agents" nav entry
- `frontend/app/settings/page.tsx` — Agents card
- `frontend/lib/api.ts` — `api.agents.*`
