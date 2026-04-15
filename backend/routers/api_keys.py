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
