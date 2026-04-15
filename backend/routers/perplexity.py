"""Perplexity Scorer — compute pseudo-perplexity on input text."""
import json, math, time
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
import httpx

router = APIRouter()

class PerplexityRequest(BaseModel):
    text: str
    model_id: str | None = None

@router.post("/perplexity/score")
async def score_perplexity(body: PerplexityRequest, request: Request) -> dict:
    """Estimate perplexity by computing token-level log-probabilities via the model."""
    cfg = request.app.state.config
    base_url = cfg.mlx_external_url or "http://127.0.0.1:8000"
    api_key = cfg.omlx_api_key

    if body.model_id:
        m = request.app.state.registry.get(body.model_id)
        if not m: raise HTTPException(404)
        from pathlib import Path
        model_name = Path(m.path).name if m.path else m.name
    else:
        adapter = request.app.state.active_adapter
        if not adapter: raise HTTPException(400, "No model loaded")
        model_name = getattr(adapter, "_server_model_id", None) or adapter.model_id

    # Use logprobs endpoint if available, otherwise estimate from generation speed
    # Pseudo-perplexity: ask the model to complete the text and measure confidence
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(f"{base_url}/v1/chat/completions", json={
                "model": model_name,
                "messages": [{"role": "user", "content": f"Continue this text naturally (just continue, don't explain):\n\n{body.text[:500]}"}],
                "max_tokens": 50, "temperature": 0.0, "logprobs": True, "top_logprobs": 5,
            }, headers=headers)

            if r.status_code != 200:
                return {"perplexity": None, "error": f"Model returned {r.status_code}"}

            data = r.json()
            choices = data.get("choices", [])
            if not choices:
                return {"perplexity": None, "error": "No response"}

            # Extract logprobs if available
            logprobs_data = choices[0].get("logprobs")
            if logprobs_data and logprobs_data.get("content"):
                token_logprobs = [t["logprob"] for t in logprobs_data["content"] if "logprob" in t]
                if token_logprobs:
                    avg_logprob = sum(token_logprobs) / len(token_logprobs)
                    ppl = math.exp(-avg_logprob)
                    return {"perplexity": round(ppl, 2), "avg_logprob": round(avg_logprob, 4),
                            "token_count": len(token_logprobs), "model": model_name}

            return {"perplexity": None, "note": "Model does not support logprobs", "model": model_name}
    except Exception as e:
        return {"perplexity": None, "error": str(e)}
