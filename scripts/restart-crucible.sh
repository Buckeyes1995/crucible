#!/usr/bin/env bash
# restart-crucible — graceful Crucible restart.
#
# Sends SIGTERM to uvicorn and waits until it actually exits, which is how
# we know FastAPI's lifespan shutdown finished (stops adapters, stops MCP
# hosts, calls session_persist.mark_clean_shutdown). Without this wait a
# plain `kill` can exit the process before those handlers complete,
# leaving the "previous session didn't shut down cleanly" banner.
#
# Usage:
#   restart-crucible            # graceful restart (default)
#   restart-crucible --status   # show what's running, no changes

set -euo pipefail

REPO="$HOME/projects/crucible"
RUN_SH="$REPO/run.sh"
LOG="/tmp/crucible.log"
STATE_FILE="$HOME/.config/crucible/session.json"

GRACEFUL_TIMEOUT=25   # seconds to wait for uvicorn SIGTERM to land.
                      # OMLXAdapter.stop() waits up to 10s on process.wait,
                      # plus HTTP unload + MCP shutdown. 25s is comfortable.

_pids_listening() {
  local port=$1
  lsof -ti ":$port" -sTCP:LISTEN 2>/dev/null || true
}

_uvicorn_pid() {
  pgrep -f "uvicorn main:app --port 7777" | head -1 || true
}

cmd_status() {
  local upid fpid
  upid=$(_uvicorn_pid)
  fpid=$(pgrep -f "next-server" | head -1 || true)
  [ -n "${upid:-}" ] && echo "backend  PID $upid" || echo "backend  not running"
  [ -n "${fpid:-}" ] && echo "frontend PID $fpid" || echo "frontend not running"
  if [ -f "$STATE_FILE" ]; then
    local clean
    clean=$(/usr/bin/python3 -c "import json; print(json.load(open('$STATE_FILE')).get('clean_shutdown', False))" 2>/dev/null || echo "?")
    echo "last shutdown: $( [ "$clean" = "True" ] && echo clean || echo DIRTY )"
  fi
}

cmd_restart() {
  # 1. Graceful stop of uvicorn — SIGTERM, wait for process exit up to GRACEFUL_TIMEOUT
  local upid
  upid=$(_uvicorn_pid)
  if [ -n "${upid:-}" ]; then
    echo "→ sending SIGTERM to uvicorn (PID $upid)"
    kill -TERM "$upid" 2>/dev/null || true

    # Poll until the PID is gone or we hit the timeout.
    local waited=0
    while kill -0 "$upid" 2>/dev/null; do
      if [ "$waited" -ge "$GRACEFUL_TIMEOUT" ]; then
        echo "  ⚠ uvicorn didn't exit in ${GRACEFUL_TIMEOUT}s — falling back to SIGKILL"
        kill -9 "$upid" 2>/dev/null || true
        break
      fi
      sleep 1
      waited=$((waited + 1))
    done
    echo "✓ uvicorn stopped (${waited}s)"
  else
    echo "· no uvicorn running"
  fi

  # 2. Frontend — no critical state, kill directly.
  local fpids
  fpids=$(pgrep -f "next-server" 2>/dev/null || true)
  if [ -n "${fpids:-}" ]; then
    echo "→ stopping frontend (PID(s) $fpids)"
    kill -TERM $fpids 2>/dev/null || true
    sleep 1
    # Anything still alive gets SIGKILL.
    pgrep -f "next-server" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
    echo "✓ frontend stopped"
  else
    echo "· no next-server running"
  fi

  # 3. Belt-and-suspenders: free the ports in case anything else is holding them.
  for port in 7777 3000; do
    local leftover
    leftover=$(_pids_listening "$port")
    if [ -n "$leftover" ]; then
      echo "→ freeing :$port (PID(s) $leftover)"
      echo "$leftover" | xargs kill -9 2>/dev/null || true
    fi
  done

  # 4. Verify the clean-shutdown marker was set by the lifespan handler.
  if [ -f "$STATE_FILE" ]; then
    local clean
    clean=$(/usr/bin/python3 -c "import json; print(json.load(open('$STATE_FILE')).get('clean_shutdown', False))" 2>/dev/null || echo "?")
    if [ "$clean" = "True" ]; then
      echo "✓ clean_shutdown flag set — no recovery banner next boot"
    else
      echo "⚠ clean_shutdown flag NOT set — recovery banner will appear on next boot"
    fi
  fi

  # 5. Launch fresh. Detached so it survives this script's exit.
  echo "→ starting crucible (logs: $LOG)"
  nohup bash "$RUN_SH" > "$LOG" 2>&1 &
  disown

  # 6. Wait for backend to respond. Cap at 60s.
  echo -n "→ waiting for backend "
  local waited=0
  while ! curl -fsS http://127.0.0.1:7777/api/status >/dev/null 2>&1; do
    if [ "$waited" -ge 60 ]; then
      echo
      echo "✗ backend did not come up within 60s — check $LOG"
      exit 1
    fi
    echo -n "."
    sleep 1
    waited=$((waited + 1))
  done
  echo " up (${waited}s)"

  # 7. Frontend takes longer because of pnpm build. Don't block on it —
  #    print its state and return.
  if curl -fsS -o /dev/null http://127.0.0.1:3000 2>/dev/null; then
    echo "✓ frontend ready on :3000"
  else
    echo "· frontend still building (pnpm build) — tail $LOG to watch"
  fi
}

case "${1:-restart}" in
  restart) cmd_restart ;;
  --status|status) cmd_status ;;
  *)
    echo "Usage: restart-crucible [restart|--status]"
    exit 1
    ;;
esac
