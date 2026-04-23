# Crucible Menu Bar Companion

A macOS menu bar app that gives you quick model switching, live metrics,
download progress, and notifications without opening the browser. Written
in Python via [rumps](https://rumps.readthedocs.io/).

## What it shows

### Menu bar title

One of:

- `⚗ 27%` — idle, memory used
- `⚗ Qwen3.6-27B 54%` — active model + memory used
- `⚗ ⟳ 54%` — a load is in flight
- `⚗ ↓42% 54%` — an HF download is running at 42%
- `⚗ ✗` — backend is unreachable

### Menu

- Status line + downloads line
- **Recent** — last 8 models you loaded (newest first)
- **All models** — active first, then alphabetical
- Each model expands: Load / Stop (if active) / Enable or Disable DFlash (if eligible) / Open Notes / Open Params
- **Stop active model**
- **Quick open…** submenu → Chat / Agent Runs / Prompts / Evals / RAG / News / Automation / Benchmark history / Models / Settings
- Refresh now / Quit

### Notifications

- Model load completion (the transition — not on app start)
- HF download finished
- DFlash enable/disable confirmation

## Setup

```bash
cd menubar
/opt/homebrew/bin/python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python crucible_menubar.py
```

The app polls `http://127.0.0.1:7777/api` every 6 seconds. It degrades
cleanly when Crucible's backend is offline — you'll see `⚗ ✗` until the
server comes back.

## Auto-start on login

```bash
cat > ~/Library/LaunchAgents/com.jim.crucible-menubar.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.jim.crucible-menubar</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/jim/projects/crucible/menubar/.venv/bin/python</string>
        <string>/Users/jim/projects/crucible/menubar/crucible_menubar.py</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/crucible-menubar.out.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/crucible-menubar.err.log</string>
</dict>
</plist>
EOF

launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.jim.crucible-menubar.plist
```

Stop it: `launchctl bootout "gui/$(id -u)/com.jim.crucible-menubar"`.

## State

Recent-models list persists to `~/.config/crucible/menubar_recent.json`.
No other local state — everything else comes from Crucible's API.

## Tweaks

Constants at the top of `crucible_menubar.py`:

- `POLL_INTERVAL = 6` — seconds between backend polls
- `MAX_RECENT = 8` — how many recent models to keep

## Troubleshooting

- **Icon says `⚗ ✗` forever** — Crucible backend isn't running. Start it
  with `bash run.sh` from the repo root.
- **No notifications appearing** — macOS silences notifications from
  unsigned Python bundles by default. Grant Terminal (or whichever
  shell launched it) notification permission in System Settings →
  Notifications → Terminal.
- **Menu flicker on refresh** — expected. The rumps library rebuilds
  the model submenus each tick; the flicker is hidden when you're not
  actively hovering.

## Design notes

- Load kicks off a background SSE stream but never waits for the
  `done` event — the poll loop detects completion via
  `status.active_model_id` transitions and fires a notification then.
  Keeps the UI responsive even on a 60s Qwen3.6-35B load.
- DFlash toggles go directly at `PUT /api/models/{id}/dflash`. If
  the model isn't DFlash-eligible the option simply doesn't render.
- Download progress reads from `GET /api/hf/downloads`. If multiple
  jobs are live, the title shows the first job's percent and the
  menu lists up to 2 names.
