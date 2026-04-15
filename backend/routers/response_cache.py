"""Response Caching — cache responses for identical prompts."""
import hashlib, json, time
from pathlib import Path
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

router = APIRouter()
CACHE_FILE = Path.home() / ".config" / "crucible" / "response_cache.json"
MAX_ENTRIES = 500

def _load():
    if CACHE_FILE.exists():
        try: return json.loads(CACHE_FILE.read_text())
        except: pass
    return {}

def _save(cache):
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    # Evict oldest if over limit
    if len(cache) > MAX_ENTRIES:
        sorted_keys = sorted(cache.keys(), key=lambda k: cache[k].get("ts", 0))
        for k in sorted_keys[:len(cache) - MAX_ENTRIES]:
            del cache[k]
    CACHE_FILE.write_text(json.dumps(cache, indent=2))

def _hash(model: str, messages: list[dict], temp: float) -> str:
    content = json.dumps({"model": model, "messages": messages, "temp": temp}, sort_keys=True)
    return hashlib.sha256(content.encode()).hexdigest()[:16]

class CacheLookup(BaseModel):
    model: str; messages: list[dict]; temperature: float = 0.7

@router.post("/cache/lookup")
async def lookup(body: CacheLookup) -> dict:
    key = _hash(body.model, body.messages, body.temperature)
    cache = _load()
    if key in cache:
        return {"hit": True, "key": key, **cache[key]}
    return {"hit": False, "key": key}

class CacheStore(BaseModel):
    model: str; messages: list[dict]; temperature: float; response: str; tps: Optional[float] = None

@router.post("/cache/store")
async def store(body: CacheStore) -> dict:
    key = _hash(body.model, body.messages, body.temperature)
    cache = _load()
    cache[key] = {"response": body.response, "tps": body.tps, "ts": time.time(), "model": body.model}
    _save(cache)
    return {"key": key, "status": "cached"}

@router.get("/cache/stats")
async def cache_stats() -> dict:
    cache = _load()
    return {"entries": len(cache), "max": MAX_ENTRIES}

@router.delete("/cache")
async def clear_cache() -> dict:
    _save({})
    return {"status": "cleared"}
