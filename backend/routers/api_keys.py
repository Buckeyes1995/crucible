"""API Key Manager — manage multiple API keys with permissions."""
import json, uuid, hashlib, time
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

router = APIRouter()
KEYS_FILE = Path.home() / ".config" / "crucible" / "api_keys.json"

def _load():
    if KEYS_FILE.exists():
        try: return json.loads(KEYS_FILE.read_text())
        except: pass
    return []

def _save(keys):
    KEYS_FILE.parent.mkdir(parents=True, exist_ok=True)
    KEYS_FILE.write_text(json.dumps(keys, indent=2))

def _hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()[:16]


# ── Route-scoped auth helpers ──────────────────────────────────────────────
# Required scope inferred from (path, method). The middleware in main.py calls
# authorize_key() to decide whether a given raw API key has the right scope.

def scope_for(path: str, method: str) -> str:
    """Map request → required permission. Falls back to 'admin' for safety
    so newly-added routes are locked down until classified."""
    m = method.upper()
    if path.startswith("/v1/") or path.startswith("/api/chat"):
        return "chat"
    if path.startswith("/api/benchmark") or path.startswith("/api/humaneval"):
        return "benchmark"
    if path.startswith("/api/arena") or path.startswith("/api/dflash"):
        return "benchmark"
    if m == "GET":
        return "read"
    # mutation on /api — require admin
    return "admin"


def authorize_key(raw_key: str, path: str, method: str) -> bool:
    """Return True if the provided key grants the scope needed for this route.
    'admin' implies all lesser scopes."""
    required = scope_for(path, method)
    h = _hash(raw_key)
    keys = _load()
    now = time.time()
    for k in keys:
        if k.get("key_hash") != h:
            continue
        if k.get("expires_at") and k["expires_at"] < now:
            return False
        perms = set(k.get("permissions") or [])
        if "admin" in perms:
            # best-effort: mark last_used without blocking
            try:
                k["last_used"] = now
                _save(keys)
            except Exception:
                pass
            return True
        if required in perms:
            try:
                k["last_used"] = now
                _save(keys)
            except Exception:
                pass
            return True
        return False
    return False

class KeyCreate(BaseModel):
    name: str
    permissions: list[str] = ["read", "chat"]  # read, chat, benchmark, admin
    expires_at: Optional[float] = None

@router.get("/api-keys")
async def list_keys():
    keys = _load()
    return [{"id": k["id"], "name": k["name"], "prefix": k["prefix"], "permissions": k["permissions"],
             "created_at": k["created_at"], "expires_at": k.get("expires_at"), "last_used": k.get("last_used")}
            for k in keys]

@router.post("/api-keys", status_code=201)
async def create_key(body: KeyCreate):
    keys = _load()
    raw_key = f"cruc_{uuid.uuid4().hex}"
    k = {"id": str(uuid.uuid4()), "name": body.name, "key_hash": _hash(raw_key), "prefix": raw_key[:12] + "…",
         "permissions": body.permissions, "created_at": time.time(), "expires_at": body.expires_at, "last_used": None}
    keys.append(k); _save(keys)
    return {"id": k["id"], "name": k["name"], "key": raw_key, "prefix": k["prefix"],
            "permissions": k["permissions"], "note": "Save this key — it won't be shown again"}

@router.delete("/api-keys/{key_id}", status_code=204)
async def delete_key(key_id: str):
    keys = _load()
    new = [k for k in keys if k["id"] != key_id]
    if len(new) == len(keys): raise HTTPException(404)
    _save(new)
