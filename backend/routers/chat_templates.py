"""Chat quick-insert templates."""
import json, uuid
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

router = APIRouter()
TEMPLATES_FILE = Path.home() / ".config" / "crucible" / "chat_templates.json"

BUILTIN = [
    {"id": "code-review", "name": "Code Review", "category": "coding", "content": "Review the following code for bugs, performance issues, and best practices:\n\n```\n{code}\n```", "builtin": True},
    {"id": "explain", "name": "Explain Code", "category": "coding", "content": "Explain the following code step by step:\n\n```\n{code}\n```", "builtin": True},
    {"id": "debug", "name": "Debug", "category": "coding", "content": "I'm getting the following error. Help me debug it:\n\nError: {error}\n\nCode:\n```\n{code}\n```", "builtin": True},
    {"id": "summarize", "name": "Summarize", "category": "general", "content": "Summarize the following text in 3-5 bullet points:\n\n{text}", "builtin": True},
    {"id": "translate", "name": "Translate", "category": "general", "content": "Translate the following to {language}:\n\n{text}", "builtin": True},
    {"id": "refactor", "name": "Refactor", "category": "coding", "content": "Refactor the following code to be cleaner and more maintainable:\n\n```\n{code}\n```", "builtin": True},
    {"id": "unit-test", "name": "Write Tests", "category": "coding", "content": "Write comprehensive unit tests for the following code:\n\n```\n{code}\n```", "builtin": True},
    {"id": "eli5", "name": "ELI5", "category": "general", "content": "Explain like I'm 5: {topic}", "builtin": True},
]

def _load():
    custom = []
    if TEMPLATES_FILE.exists():
        try: custom = json.loads(TEMPLATES_FILE.read_text())
        except: pass
    return BUILTIN + custom

def _save(custom):
    TEMPLATES_FILE.parent.mkdir(parents=True, exist_ok=True)
    TEMPLATES_FILE.write_text(json.dumps(custom, indent=2))

class TemplateCreate(BaseModel):
    name: str; category: str = "custom"; content: str

@router.get("/chat-templates")
async def list_templates(): return _load()

@router.post("/chat-templates", status_code=201)
async def create_template(body: TemplateCreate):
    custom = [t for t in _load() if not t.get("builtin")]
    t = {"id": str(uuid.uuid4()), "name": body.name, "category": body.category, "content": body.content, "builtin": False}
    custom.append(t); _save(custom); return t

@router.delete("/chat-templates/{template_id}", status_code=204)
async def delete_template(template_id: str):
    custom = [t for t in _load() if not t.get("builtin")]
    new = [t for t in custom if t["id"] != template_id]
    if len(new) == len(custom): raise HTTPException(404)
    _save(new)
