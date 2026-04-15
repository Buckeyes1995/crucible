"""Benchmark Presets Manager — save/load custom benchmark configs."""
import json, uuid
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

router = APIRouter()
PRESETS_FILE = Path.home() / ".config" / "crucible" / "bench_presets.json"

def _load():
    if PRESETS_FILE.exists():
        try: return json.loads(PRESETS_FILE.read_text())
        except: pass
    return []

def _save(presets):
    PRESETS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PRESETS_FILE.write_text(json.dumps(presets, indent=2))

class PresetCreate(BaseModel):
    name: str
    model_ids: list[str] = []
    prompt_ids: list[str] = []
    reps: int = 1
    max_tokens: int = 2048
    temperature: float = 0.7

@router.get("/benchmark/custom-presets")
async def list_presets(): return _load()

@router.post("/benchmark/custom-presets", status_code=201)
async def create_preset(body: PresetCreate):
    presets = _load()
    p = {"id": str(uuid.uuid4()), **body.model_dump()}
    presets.append(p); _save(presets); return p

@router.delete("/benchmark/custom-presets/{preset_id}", status_code=204)
async def delete_preset(preset_id: str):
    presets = _load()
    new = [p for p in presets if p["id"] != preset_id]
    if len(new) == len(presets): raise HTTPException(404)
    _save(new)
