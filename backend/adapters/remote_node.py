"""Remote node adapter — proxies to a remote Crucible instance."""

import json
import logging
import time
from typing import AsyncGenerator, Optional

import httpx

from adapters.base import BaseAdapter
from models.schemas import ModelEntry, ChatMessage

log = logging.getLogger(__name__)


class RemoteNodeAdapter(BaseAdapter):
    """Proxy adapter for models on a remote Crucible node."""

    def __init__(self, node_url: str, remote_model_id: str, api_key: str = ""):
        self._node_url = node_url.rstrip("/")
        self._remote_model_id = remote_model_id
        self._api_key = api_key
        self._model: Optional[ModelEntry] = None
        # For proxy.py compatibility
        self._base_url = node_url.rstrip("/")
        self._server_model_id: Optional[str] = None

    @property
    def model_id(self) -> str | None:
        return self._model.id if self._model else None

    def is_loaded(self) -> bool:
        return self._model is not None

    def _headers(self) -> dict:
        h = {}
        if self._api_key:
            h["X-API-Key"] = self._api_key
        return h

    async def load(self, model: ModelEntry) -> AsyncGenerator[dict, None]:
        yield {"event": "stage", "data": {"stage": "connecting", "message": f"Connecting to remote node {self._node_url}…"}}

        # Verify the remote Crucible is reachable
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{self._node_url}/api/status", headers=self._headers())
                if r.status_code != 200:
                    yield {"event": "error", "data": {"message": f"Remote node returned {r.status_code}"}}
                    return
        except Exception as e:
            yield {"event": "error", "data": {"message": f"Cannot reach remote node: {e}"}}
            return

        yield {"event": "stage", "data": {"stage": "loading", "message": f"Loading {model.name} on remote node…"}}

        # Trigger model load on the remote Crucible via its SSE endpoint
        t0 = time.monotonic()
        load_url = f"{self._node_url}/api/models/{self._remote_model_id}/load"
        try:
            async with httpx.AsyncClient(timeout=600.0) as client:
                async with client.stream("POST", load_url, json={}, headers=self._headers()) as resp:
                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        try:
                            data = json.loads(line[6:])
                        except Exception:
                            continue
                        event = data.get("event", "stage")
                        if event == "error":
                            yield {"event": "error", "data": data.get("data", {"message": "Remote load failed"})}
                            return
                        if event == "stage":
                            yield {"event": "stage", "data": data.get("data", {})}
                        if event == "done":
                            break
        except Exception as e:
            yield {"event": "error", "data": {"message": f"Remote load failed: {e}"}}
            return

        # Discover the server model ID from the remote's /v1/models
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{self._node_url}/v1/models", headers=self._headers())
                if r.status_code == 200:
                    models_data = r.json().get("data", [])
                    if models_data:
                        self._server_model_id = models_data[0]["id"]
        except Exception:
            pass

        self._model = model
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        yield {"event": "done", "data": {"model_id": model.id, "elapsed_ms": elapsed_ms}}

    async def stop(self) -> None:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post(f"{self._node_url}/api/models/stop", headers=self._headers())
        except Exception:
            pass
        self._model = None
        self._server_model_id = None

    async def chat(
        self,
        messages: list[ChatMessage],
        temperature: float,
        max_tokens: int,
    ) -> AsyncGenerator[dict, None]:
        payload = {
            "model": self._server_model_id or "default",
            "messages": [m.model_dump() for m in messages],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }
        t0 = time.monotonic()
        first_token_time: float | None = None
        total_tokens = 0
        self.last_prompt_tps = None

        async with httpx.AsyncClient(timeout=300.0) as client:
            async with client.stream(
                "POST",
                f"{self._node_url}/v1/chat/completions",
                json=payload,
                headers={"Content-Type": "application/json", **self._headers()},
            ) as resp:
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    chunk = line[6:]
                    if chunk.strip() == "[DONE]":
                        break
                    try:
                        data = json.loads(chunk)
                    except Exception:
                        continue

                    # Server-reported metrics
                    usage = data.get("usage") or {}
                    if usage:
                        if usage.get("prompt_tokens_per_second"):
                            self.last_prompt_tps = round(usage["prompt_tokens_per_second"], 2)
                        if usage.get("generation_tokens_per_second"):
                            self.last_tps = round(usage["generation_tokens_per_second"], 2)
                        if usage.get("time_to_first_token"):
                            self.last_ttft_ms = round(usage["time_to_first_token"] * 1000, 2)

                    choices = data.get("choices") or []
                    if not choices:
                        continue
                    try:
                        delta = choices[0]["delta"]
                        content = delta.get("content") or delta.get("reasoning_content") or delta.get("reasoning") or ""
                        if content:
                            if first_token_time is None:
                                first_token_time = time.monotonic()
                            total_tokens += 1
                            yield {"token": content, "done": False}
                    except Exception:
                        continue

        t1 = time.monotonic()
        if first_token_time and not self.last_ttft_ms:
            self.last_ttft_ms = round((first_token_time - t0) * 1000, 2)
        if first_token_time and not self.last_tps and total_tokens > 0:
            gen_time = t1 - first_token_time
            if gen_time > 0:
                self.last_tps = round(total_tokens / gen_time, 2)

        yield {"token": "", "done": True}
