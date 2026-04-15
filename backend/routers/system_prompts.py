"""System Prompt Library — categorized system prompts with CRUD."""
import json, uuid
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

router = APIRouter()
PROMPTS_FILE = Path.home() / ".config" / "crucible" / "system_prompts.json"

BUILTIN = [
    {"id": "helpful", "name": "Helpful Assistant", "category": "general", "content": "You are a helpful, concise assistant.", "builtin": True},
    {"id": "coder", "name": "Senior Developer", "category": "coding", "content": "You are a senior software engineer. Write clean, efficient, well-documented code. Prefer simple solutions.", "builtin": True},
    {"id": "teacher", "name": "Patient Teacher", "category": "education", "content": "You are a patient teacher. Explain concepts clearly using analogies. Check understanding before moving on.", "builtin": True},
    {"id": "reviewer", "name": "Code Reviewer", "category": "coding", "content": "You are a thorough code reviewer. Focus on bugs, security issues, performance problems, and maintainability. Be constructive.", "builtin": True},
    {"id": "creative", "name": "Creative Writer", "category": "creative", "content": "You are a creative writer with a vivid imagination. Write engaging, original content.", "builtin": True},
    {"id": "concise", "name": "Concise Expert", "category": "general", "content": "You are an expert. Give the shortest correct answer. No preamble, no filler.", "builtin": True},
    {"id": "analyst", "name": "Data Analyst", "category": "analysis", "content": "You are a data analyst. Be precise with numbers, cite sources, present findings clearly.", "builtin": True},
]

def _load():
    custom = []
    if PROMPTS_FILE.exists():
        try: custom = json.loads(PROMPTS_FILE.read_text())
        except: pass
    return BUILTIN + custom

def _save(custom):
    PROMPTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROMPTS_FILE.write_text(json.dumps(custom, indent=2))

class PromptCreate(BaseModel):
    name: str; category: str = "custom"; content: str

@router.get("/system-prompts")
async def list_prompts(): return _load()

@router.post("/system-prompts", status_code=201)
async def create_prompt(body: PromptCreate):
    custom = [p for p in _load() if not p.get("builtin")]
    p = {"id": str(uuid.uuid4()), "name": body.name, "category": body.category, "content": body.content, "builtin": False}
    custom.append(p); _save(custom); return p

@router.delete("/system-prompts/{prompt_id}", status_code=204)
async def delete_prompt(prompt_id: str):
    custom = [p for p in _load() if not p.get("builtin")]
    new = [p for p in custom if p["id"] != prompt_id]
    if len(new) == len(custom): raise HTTPException(404)
    _save(new)
