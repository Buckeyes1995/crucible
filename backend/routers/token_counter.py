"""Token Counter — estimate token count for input text."""
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

class CountRequest(BaseModel):
    text: str
    model: str = ""

@router.post("/tokens/count")
async def count_tokens(body: CountRequest) -> dict:
    """Rough token estimate — ~4 chars per token for English."""
    text = body.text
    # Simple heuristic: split by whitespace, then estimate subword tokens
    words = text.split()
    char_count = len(text)
    # Rough estimates for different tokenizer families
    estimate_cl100k = max(1, int(char_count / 3.5))  # GPT-4 style
    estimate_qwen = max(1, int(char_count / 3.2))     # Qwen style (slightly more tokens)
    return {
        "char_count": char_count,
        "word_count": len(words),
        "estimated_tokens": estimate_qwen,
        "estimates": {
            "qwen": estimate_qwen,
            "cl100k": estimate_cl100k,
        }
    }
