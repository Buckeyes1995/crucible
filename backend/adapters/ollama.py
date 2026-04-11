"""Ollama adapter — external daemon, HTTP only."""
import json
import time
from typing import AsyncGenerator, Optional

import httpx

from adapters.base import BaseAdapter
from models.schemas import ModelEntry, ChatMessage


class OllamaAdapter(BaseAdapter):
    def __init__(self, host: str = "http://localhost:11434"):
        self._host = host.rstrip("/")
        self._model: Optional[ModelEntry] = None

    @property
    def model_id(self) -> str | None:
        return self._model.id if self._model else None

    def is_loaded(self) -> bool:
        return self._model is not None

    async def load(self, model: ModelEntry) -> AsyncGenerator[dict, None]:
        yield {"event": "stage", "data": {"stage": "starting", "message": "Pulling model in Ollama…"}}

        tag = model.name  # Ollama tag is the full model name
        t0 = time.monotonic()

        # Use Ollama pull to ensure the model is available
        try:
            async with httpx.AsyncClient(timeout=300.0) as client:
                async with client.stream(
                    "POST",
                    f"{self._host}/api/pull",
                    json={"name": tag, "stream": True},
                ) as resp:
                    async for line in resp.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            data = json.loads(line)
                            status = data.get("status", "")
                            yield {"event": "stage", "data": {"stage": "loading", "message": status}}
                        except Exception:
                            continue
        except Exception as e:
            yield {"event": "error", "data": {"message": str(e)}}
            return

        yield {"event": "stage", "data": {"stage": "warmup", "message": "Warming up…"}}

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                await client.post(
                    f"{self._host}/api/generate",
                    json={"model": tag, "prompt": "hi", "stream": False, "options": {"num_predict": 1}},
                )
        except Exception:
            pass

        self._model = model
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        yield {"event": "done", "data": {"model_id": model.id, "elapsed_ms": elapsed_ms}}

    async def stop(self) -> None:
        # Ollama manages its own lifecycle; just clear our reference
        self._model = None

    async def chat(
        self,
        messages: list[ChatMessage],
        temperature: float,
        max_tokens: int,
    ) -> AsyncGenerator[dict, None]:
        if not self._model:
            yield {"token": "", "done": True, "error": "No model loaded"}
            return

        payload = {
            "model": self._model.name,
            "messages": [m.model_dump() for m in messages],
            "stream": True,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }
        async with httpx.AsyncClient(timeout=300.0) as client:
            async with client.stream(
                "POST",
                f"{self._host}/api/chat",
                json=payload,
            ) as resp:
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        data = json.loads(line)
                        content = data.get("message", {}).get("content", "")
                        done = data.get("done", False)
                        if content:
                            yield {"token": content, "done": False}
                        if done:
                            break
                    except Exception:
                        continue
        yield {"token": "", "done": True}
