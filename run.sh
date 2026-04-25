#!/usr/bin/env bash
set -e

REPO="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$REPO/backend"
FRONTEND="$REPO/frontend"

# ── Mode ─────────────────────────────────────────────────────────────────────
# Pass --dev for development mode (hot reload). Default is production.
MODE="production"
if [[ "$1" == "--dev" ]]; then
  MODE="dev"
fi

# ── Refuse to start if a healthy Crucible is already running ────────────────
# Two parallel run.sh instances will race on :7777 — both call _free_port
# below (killing each other's listeners), then both try to bind, and one
# wins by exiting the OTHER's listener. Net result: backend dies, frontend
# stays up, and every API call returns 500. Detect this case up front by
# probing /api/status with a short timeout. If something answers cleanly,
# stop. Use restart-crucible.sh to deliberately replace it.
if curl -fsS -o /dev/null --max-time 2 http://127.0.0.1:7777/api/status 2>/dev/null; then
  echo "[crucible] Already running and healthy on :7777 — refusing to start a second instance."
  echo "[crucible] To restart cleanly, run scripts/restart-crucible.sh"
  exit 1
fi

# ── Kill zombies before starting ─────────────────────────────────────────────
# Any listener on 7777 / 3000 is stale from a previous run (different --host
# binds can coexist on macOS, producing "ghost" API responses). Clean first.
_free_port() {
  local port=$1
  local pids
  pids=$(lsof -ti ":$port" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "[crucible] Killing stale listener(s) on :$port — PIDs: $pids"
    kill -9 $pids 2>/dev/null || true
    sleep 0.5
  fi
}
_free_port 7777
_free_port 3000

# ── Backend ──────────────────────────────────────────────────────────────────
if [ ! -d "$BACKEND/.venv" ]; then
  echo "[crucible] Creating backend venv…"
  /opt/homebrew/bin/python3.13 -m venv "$BACKEND/.venv"
fi

if [ -f "$BACKEND/requirements.txt" ]; then
  echo "[crucible] Installing backend deps…"
  "$BACKEND/.venv/bin/pip" install -q -r "$BACKEND/requirements.txt"
fi

echo "[crucible] Starting backend on :7777…"
cd "$BACKEND"
source .venv/bin/activate
# Read bind_host from config (default 127.0.0.1)
BIND_HOST=$(python3 -c "
import json,pathlib
p = pathlib.Path.home() / '.config/crucible/config.json'
print(json.loads(p.read_text()).get('bind_host','127.0.0.1') if p.exists() else '127.0.0.1')
" 2>/dev/null || echo "127.0.0.1")

if [[ "$MODE" == "dev" ]]; then
  uvicorn main:app --reload --port 7777 --host "$BIND_HOST" &
else
  uvicorn main:app --port 7777 --host "$BIND_HOST" &
fi
BACKEND_PID=$!

# ── Frontend ─────────────────────────────────────────────────────────────────
if [ ! -d "$FRONTEND/node_modules" ]; then
  echo "[crucible] Installing frontend deps…"
  cd "$FRONTEND" && /opt/homebrew/bin/pnpm install
fi

cd "$FRONTEND"
if [[ "$MODE" == "dev" ]]; then
  echo "[crucible] Starting frontend (dev) on :3000…"
  /opt/homebrew/bin/pnpm dev &
else
  echo "[crucible] Building frontend…"
  /opt/homebrew/bin/pnpm build
  echo "[crucible] Starting frontend (production) on :3000…"
  /opt/homebrew/bin/pnpm start &
fi
FRONTEND_PID=$!

# ── Cleanup ───────────────────────────────────────────────────────────────────
# Kill both children AND anything that ended up on our ports, so launchd
# restarts always start clean (no zombie bound to 127.0.0.1 alongside 0.0.0.0).
_cleanup() {
  echo "[crucible] Shutting down…"
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
  _free_port 7777
  _free_port 3000
}
trap _cleanup EXIT INT TERM

echo ""
echo "  Crucible running ($MODE):"
echo "    Web UI  → http://localhost:3000"
echo "    API     → http://localhost:7777"
echo ""
echo "  Ctrl+C to stop."
echo ""

wait
