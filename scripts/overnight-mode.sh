#!/usr/bin/env bash
# overnight-mode — prep the Mac for unattended pi.dev / Crucible runs.
#
# Usage:
#   overnight-mode start [model_id]    # cap context, sync, sleep display, caffeinate
#   overnight-mode stop                 # restore context, release caffeinate
#   overnight-mode status               # show current state
#
# Model defaults to whatever is currently loaded in Crucible. Falls back to
# mlx:Qwen3-Coder-Next-MLX-6bit if nothing is loaded.
#
# What "start" does:
#   1. Caps the model's context_window / max_tokens so pi auto-compacts well
#      before oMLX's prefill starts triggering Metal's interactivity watchdog.
#   2. Syncs the cap into pi + opencode configs.
#   3. Launches `caffeinate -i` (idle-sleep prevention, display can still sleep).
#   4. Sleeps the display (no display refresh = no interactivity preemption).
#
# Existing sampling params (temperature, top_p, cache_limit_gb, etc.) are
# preserved — only context_window + max_tokens are touched.

set -euo pipefail

CRUCIBLE="http://127.0.0.1:7777"
PIDFILE="$HOME/.config/crucible/overnight.caffeinate.pid"
STATEFILE="$HOME/.config/crucible/overnight.state.json"

# Overnight caps: empirically the Metal watchdog starts firing at ~65K tokens
# of accumulated prefill on Qwen3-Coder-Next-MLX-6bit. Capping declared context
# at 65K → pi auto-compacts at ~49K (65K − 16K reserve), well clear of the zone.
OVERNIGHT_CONTEXT=65536
OVERNIGHT_OUTPUT=16384

# Restore values on stop. Matches Crucible's normal declared cap.
NORMAL_CONTEXT=131072
NORMAL_OUTPUT=32768

FALLBACK_MODEL="mlx:Qwen3-Coder-Next-MLX-6bit"

_crucible_up() {
  curl -fsS "$CRUCIBLE/api/status" >/dev/null 2>&1
}

_active_model() {
  curl -fsS "$CRUCIBLE/api/status" 2>/dev/null \
    | /usr/bin/python3 -c "import json,sys; d=json.loads(sys.stdin.read() or '{}'); print(d.get('active_model_id') or '')" 2>/dev/null || true
}

_resolve_model() {
  local arg="${1:-}"
  if [ -n "$arg" ]; then echo "$arg"; return; fi
  local active
  active=$(_active_model)
  if [ -n "$active" ]; then echo "$active"; return; fi
  echo "$FALLBACK_MODEL"
}

# GET current params → merge context_window + max_tokens → PUT back.
_set_caps() {
  local model="$1" ctx="$2" out="$3"
  local current body
  current=$(curl -fsS "$CRUCIBLE/api/models/${model}/params" 2>/dev/null || echo '{}')
  body=$(
    /usr/bin/python3 <<PY
import json, sys
try:
    d = json.loads("""$current""")
    if not isinstance(d, dict): d = {}
except Exception:
    d = {}
d["context_window"] = $ctx
d["max_tokens"] = $out
print(json.dumps(d))
PY
  )
  curl -fsS -X PUT "$CRUCIBLE/api/models/${model}/params" \
    -H 'content-type: application/json' \
    -d "$body" >/dev/null
  curl -fsS -X POST "$CRUCIBLE/api/clients/sync-configs" >/dev/null
  echo "✓ ${model}: context_window=${ctx}, max_tokens=${out} (synced to pi + opencode)"
}

cmd_start() {
  if ! _crucible_up; then
    echo "✗ Crucible unreachable at $CRUCIBLE — start it first (bash run.sh)" >&2
    exit 1
  fi

  local model
  model=$(_resolve_model "${1:-}")
  echo "→ Overnight mode: $model"

  # Remember the model we touched so `stop` restores the same one even if a
  # different model gets loaded overnight.
  mkdir -p "$(dirname "$STATEFILE")"
  printf '{"model":"%s"}\n' "$model" > "$STATEFILE"

  _set_caps "$model" "$OVERNIGHT_CONTEXT" "$OVERNIGHT_OUTPUT"

  # Kill any caffeinate we launched previously.
  if [ -f "$PIDFILE" ]; then
    local old_pid
    old_pid=$(cat "$PIDFILE" 2>/dev/null || true)
    if [ -n "${old_pid:-}" ] && kill -0 "$old_pid" 2>/dev/null; then
      kill "$old_pid" 2>/dev/null || true
    fi
    rm -f "$PIDFILE"
  fi

  # `caffeinate -i` blocks idle sleep; display can still sleep independently.
  caffeinate -i &
  local pid=$!
  disown $pid 2>/dev/null || true
  echo "$pid" > "$PIDFILE"
  echo "✓ caffeinate -i (PID $pid) — machine will not idle-sleep"

  pmset displaysleepnow
  echo "✓ display sleeping"

  echo ""
  echo "Overnight mode active. Run 'overnight-mode stop' to restore."
}

cmd_stop() {
  if ! _crucible_up; then
    echo "⚠ Crucible unreachable — skipping param restore." >&2
  fi

  local model=""
  if [ -f "$STATEFILE" ]; then
    model=$(/usr/bin/python3 -c "import json; print(json.load(open('$STATEFILE')).get('model',''))" 2>/dev/null || true)
  fi
  if [ -z "$model" ]; then
    model=$(_resolve_model)
  fi

  echo "→ Exiting overnight mode"

  if [ -f "$PIDFILE" ]; then
    local pid
    pid=$(cat "$PIDFILE" 2>/dev/null || true)
    if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid"
      echo "✓ caffeinate stopped (PID $pid)"
    else
      echo "· caffeinate already gone"
    fi
    rm -f "$PIDFILE"
  else
    echo "· no caffeinate pidfile"
  fi

  if _crucible_up && [ -n "$model" ]; then
    _set_caps "$model" "$NORMAL_CONTEXT" "$NORMAL_OUTPUT"
  fi
  rm -f "$STATEFILE"
}

cmd_status() {
  if [ -f "$PIDFILE" ] && [ -n "$(cat "$PIDFILE" 2>/dev/null || true)" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "overnight: ACTIVE (caffeinate PID $(cat "$PIDFILE"))"
  else
    echo "overnight: inactive"
  fi

  if _crucible_up; then
    local model params ctx out
    model=$(_resolve_model)
    params=$(curl -fsS "$CRUCIBLE/api/models/${model}/params" 2>/dev/null || echo '{}')
    ctx=$(/usr/bin/python3 -c "import json; print(json.loads('$params').get('context_window','?'))" 2>/dev/null || echo '?')
    out=$(/usr/bin/python3 -c "import json; print(json.loads('$params').get('max_tokens','?'))" 2>/dev/null || echo '?')
    echo "model:     $model"
    echo "context:   $ctx"
    echo "max_out:   $out"
  else
    echo "crucible:  unreachable"
  fi
}

case "${1:-}" in
  start)  shift; cmd_start "${1:-}" ;;
  stop)   cmd_stop ;;
  status) cmd_status ;;
  *)
    echo "Usage: overnight-mode {start|stop|status} [model_id]"
    exit 1
    ;;
esac
