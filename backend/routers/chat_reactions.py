"""Chat Reactions — thumbs up/down per message for quality tracking."""
import json
from pathlib import Path
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()
REACTIONS_FILE = Path.home() / ".config" / "crucible" / "chat_reactions.json"

def _load():
    if REACTIONS_FILE.exists():
        try: return json.loads(REACTIONS_FILE.read_text())
        except: pass
    return {}

def _save(data):
    REACTIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    REACTIONS_FILE.write_text(json.dumps(data, indent=2))

class Reaction(BaseModel):
    session_id: str; message_index: int; reaction: str  # "up" or "down"

@router.post("/chat/reactions")
async def add_reaction(body: Reaction):
    data = _load()
    key = f"{body.session_id}:{body.message_index}"
    data[key] = body.reaction
    _save(data)
    return {"status": "ok"}

@router.get("/chat/reactions/{session_id}")
async def get_reactions(session_id: str):
    data = _load()
    return {k.split(":")[1]: v for k, v in data.items() if k.startswith(session_id + ":")}

@router.get("/chat/reactions/stats")
async def reaction_stats():
    data = _load()
    up = sum(1 for v in data.values() if v == "up")
    down = sum(1 for v in data.values() if v == "down")
    return {"total": len(data), "up": up, "down": down, "satisfaction_rate": round(up / (up + down) * 100, 1) if (up + down) > 0 else 0}
