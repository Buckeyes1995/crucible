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
trap "echo '[crucible] Shutting down…'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT INT TERM

echo ""
echo "  Crucible running ($MODE):"
echo "    Web UI  → http://localhost:3000"
echo "    API     → http://localhost:7777"
echo ""
echo "  Ctrl+C to stop."
echo ""

wait
