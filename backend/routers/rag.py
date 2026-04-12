"""RAG / context injection endpoints."""
import os
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional

import rag as r

router = APIRouter()


class AddTextRequest(BaseModel):
    session_id: str
    name: str
    text: str


class GetContextRequest(BaseModel):
    session_id: str
    query: str
    top_k: int = 4


class AddPathRequest(BaseModel):
    session_id: str
    path: str


@router.get("/rag/{session_id}/info")
def session_info(session_id: str) -> dict:
    return r.session_info(session_id)


@router.delete("/rag/{session_id}")
def clear_session(session_id: str) -> dict:
    r.clear_session(session_id)
    return {"status": "cleared"}


@router.post("/rag/add-text")
def add_text(body: AddTextRequest) -> dict:
    if not body.text.strip():
        raise HTTPException(400, "text is required")
    count = r.add_text_to_session(body.session_id, body.name or "pasted", body.text)
    return {"status": "ok", "chunks_added": count, **r.session_info(body.session_id)}


@router.post("/rag/add-path")
def add_path(body: AddPathRequest) -> dict:
    try:
        count = r.add_file_to_session(body.session_id, body.path)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"status": "ok", "chunks_added": count, **r.session_info(body.session_id)}


@router.post("/rag/upload")
async def upload_file(session_id: str, file: UploadFile = File(...)) -> dict:
    """Upload a file and add it to the session context."""
    suffix = Path(file.filename or "upload.txt").suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        count = r.add_file_to_session(session_id, tmp_path)
        # Re-key by original filename in meta
        # (already stored under tmp name — re-add with real name)
        r.clear_session(session_id)
        text = content.decode("utf-8", errors="replace")
        count = r.add_text_to_session(session_id, file.filename or "upload", text)
    finally:
        os.unlink(tmp_path)

    return {"status": "ok", "filename": file.filename, "chunks_added": count, **r.session_info(session_id)}


@router.post("/rag/context")
def get_context(body: GetContextRequest) -> dict:
    ctx = r.get_context(body.session_id, body.query, top_k=body.top_k)
    return {"context": ctx, **r.session_info(body.session_id)}
