#!/bin/bash
# Launchd entry point for Forge backend.
# Reads bind_host from ~/.config/forge/config.json so the plist
# doesn't need to be edited when the setting changes.

BACKEND="/Users/jim/projects/forge/backend"

BIND_HOST=$("$BACKEND/.venv/bin/python3.13" -c "
import json, pathlib
p = pathlib.Path.home() / '.config/forge/config.json'
print(json.loads(p.read_text()).get('bind_host','127.0.0.1') if p.exists() else '127.0.0.1')
" 2>/dev/null || echo "127.0.0.1")

exec "$BACKEND/.venv/bin/uvicorn" main:app \
    --port 7777 \
    --host "$BIND_HOST"
