"""Structured Output — JSON schema validation for model outputs."""
import json
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from arena import stream_to_omlx

router = APIRouter()

class StructuredRequest(BaseModel):
    prompt: str
    json_schema: dict  # The schema the output must conform to
    model_id: str | None = None
    temperature: float = 0.7
    max_tokens: int = 1024

@router.post("/structured/generate")
async def generate_structured(body: StructuredRequest, request: Request) -> dict:
    """Generate output constrained to a JSON schema."""
    cfg = request.app.state.config
    base_url = cfg.mlx_external_url or "http://127.0.0.1:8000"
    api_key = cfg.omlx_api_key

    if body.model_id:
        m = request.app.state.registry.get(body.model_id)
        if not m: raise HTTPException(404, "Model not found")
        from pathlib import Path
        model_name = Path(m.path).name if m.path else m.name
    else:
        adapter = request.app.state.active_adapter
        if not adapter: raise HTTPException(400, "No model loaded")
        model_name = getattr(adapter, "_server_model_id", None) or adapter.model_id

    schema_str = json.dumps(body.json_schema, indent=2)
    system = f"You must respond with valid JSON that conforms to this schema:\n```json\n{schema_str}\n```\nRespond ONLY with the JSON, no other text."
    messages = [{"role": "system", "content": system}, {"role": "user", "content": body.prompt}]

    tokens = []
    async for chunk in stream_to_omlx(model_name, messages, base_url, api_key, body.temperature, body.max_tokens):
        if chunk.get("token"):
            tokens.append(chunk["token"])

    raw = "".join(tokens).strip()
    # Try to extract JSON from response
    if raw.startswith("```"):
        raw = raw.split("```")[1].strip()
        if raw.startswith("json"): raw = raw[4:].strip()

    try:
        parsed = json.loads(raw)
        # Basic schema validation
        import jsonschema
        jsonschema.validate(parsed, body.json_schema)
        return {"valid": True, "data": parsed, "raw": raw}
    except json.JSONDecodeError:
        return {"valid": False, "data": None, "raw": raw, "error": "Invalid JSON"}
    except Exception as e:
        try:
            parsed = json.loads(raw)
            return {"valid": False, "data": parsed, "raw": raw, "error": str(e)}
        except:
            return {"valid": False, "data": None, "raw": raw, "error": str(e)}
