#!/usr/bin/env bash
# Force Crucible to rewrite opencode + pi config blocks from the current
# registry + per-model params. Useful after tweaking a model's context
# window or max_tokens in the Crucible UI and wanting it to land in
# the external clients immediately. Non-destructive — preserves any
# hand-authored `parameters: {...}` sampling tweaks in opencode.json.
#
# Usage:
#   scripts/sync-clients.sh
set -euo pipefail
HOST="${CRUCIBLE_HOST:-http://localhost:7777}"
curl -s -X POST "$HOST/api/clients/sync-configs" | python3 -m json.tool
