"""Scheduled model switching endpoints."""
import uuid
from typing import Any
from fastapi import APIRouter
from pydantic import BaseModel

from scheduler import load_schedules, save_schedules

router = APIRouter()

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


class ScheduleRule(BaseModel):
    model_id: str
    days: list[int] = []  # 0=Mon..6=Sun; empty = every day
    hour: int = 9
    minute: int = 0
    enabled: bool = True
    label: str = ""


@router.get("/schedules")
async def list_schedules() -> list[dict]:
    return load_schedules()


@router.post("/schedules")
async def create_schedule(rule: ScheduleRule) -> dict[str, Any]:
    schedules = load_schedules()
    entry = {"id": str(uuid.uuid4())[:8], **rule.model_dump()}
    schedules.append(entry)
    save_schedules(schedules)
    return entry


@router.put("/schedules/{schedule_id}")
async def update_schedule(schedule_id: str, rule: ScheduleRule) -> dict[str, Any]:
    schedules = load_schedules()
    for i, s in enumerate(schedules):
        if s["id"] == schedule_id:
            schedules[i] = {"id": schedule_id, **rule.model_dump()}
            save_schedules(schedules)
            return schedules[i]
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail="Schedule not found")


@router.delete("/schedules/{schedule_id}")
async def delete_schedule(schedule_id: str) -> dict[str, str]:
    schedules = load_schedules()
    schedules = [s for s in schedules if s["id"] != schedule_id]
    save_schedules(schedules)
    return {"status": "deleted"}
