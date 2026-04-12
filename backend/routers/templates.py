"""Prompt template CRUD endpoints."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

import prompt_templates as pt

router = APIRouter()


class TemplateCreate(BaseModel):
    name: str
    content: str
    description: Optional[str] = ""


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    content: Optional[str] = None
    description: Optional[str] = None


@router.get("/templates")
def list_templates() -> list[dict]:
    return pt.list_templates()


@router.post("/templates", status_code=201)
def create_template(body: TemplateCreate) -> dict:
    if not body.name.strip():
        raise HTTPException(400, "name is required")
    if not body.content.strip():
        raise HTTPException(400, "content is required")
    return pt.add_template(name=body.name.strip(), content=body.content, description=body.description or "")


@router.put("/templates/{template_id}")
def update_template(template_id: str, body: TemplateUpdate) -> dict:
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    result = pt.update_template(template_id, **updates)
    if not result:
        raise HTTPException(404, "Template not found")
    return result


@router.delete("/templates/{template_id}")
def delete_template(template_id: str) -> dict:
    if not pt.delete_template(template_id):
        raise HTTPException(404, "Template not found")
    return {"status": "deleted"}
