"""Benchmark Scheduler — schedule recurring benchmark runs."""
import json, uuid, time
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

router = APIRouter()
SCHEDULES_FILE = Path.home() / ".config" / "crucible" / "bench_schedules.json"

def _load():
    if SCHEDULES_FILE.exists():
        try: return json.loads(SCHEDULES_FILE.read_text())
        except: pass
    return []

def _save(schedules):
    SCHEDULES_FILE.parent.mkdir(parents=True, exist_ok=True)
    SCHEDULES_FILE.write_text(json.dumps(schedules, indent=2))

class ScheduleCreate(BaseModel):
    name: str
    cron: str  # e.g. "0 2 * * *" for daily at 2am
    model_ids: list[str]
    prompt_ids: list[str] = []
    preset: str = "quick"
    enabled: bool = True

@router.get("/benchmark/schedules")
async def list_schedules(): return _load()

@router.post("/benchmark/schedules", status_code=201)
async def create_schedule(body: ScheduleCreate):
    schedules = _load()
    s = {"id": str(uuid.uuid4()), **body.model_dump(), "created_at": time.time(), "last_run": None}
    schedules.append(s); _save(schedules); return s

@router.put("/benchmark/schedules/{schedule_id}")
async def update_schedule(schedule_id: str, body: ScheduleCreate):
    schedules = _load()
    for s in schedules:
        if s["id"] == schedule_id:
            s.update(body.model_dump())
            _save(schedules); return s
    raise HTTPException(404)

@router.delete("/benchmark/schedules/{schedule_id}", status_code=204)
async def delete_schedule(schedule_id: str):
    schedules = _load()
    new = [s for s in schedules if s["id"] != schedule_id]
    if len(new) == len(schedules): raise HTTPException(404)
    _save(new)
