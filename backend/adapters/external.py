"""External adapter — uses an already-running OpenAI-compatible server (e.g. oMLX).

oMLX is a multi-model LRU server: send a chat request with a model ID and it
automatically loads that model, evicting the current one if memory is needed.
Crucible just needs to trigger the load via a warmup request and wait.
"""
import asyncio
import json
import logging
import time
from pathlib import Path
from typing import AsyncGenerator, Optional

import httpx

from adapters.base import BaseAdapter
from models.schemas import ModelEntry, ChatMessage

log = logging.getLogger(__name__)


def _external_model_id(model: ModelEntry) -> str:
    """Map a Crucible model entry to its ID as known by the external server.

    oMLX identifies models by their directory/file name under --model-dir:
      mlx:Qwen3-Coder-Next-MLX-4bit  →  Qwen3-Coder-Next-MLX-4bit
      gguf:subdir/Model-Q4_K_M        →  Model-Q4_K_M.gguf  (if path available)
    """
    if model.path:
        p = Path(model.path)
        # For GGUF files, include the extension; MLX dirs have none.
        return p.name
    return model.name


class ExternalAdapter(BaseAdapter):
    """
    Wraps an existing multi-model OpenAI-compatible inference server.
    Triggers model loading by sending a warmup request with the target model ID,
    then waits until the server responds successfully.
    """

    def __init__(self, base_url: str):
        self._base_url = base_url.rstrip("/")
        self._model: Optional[ModelEntry] = None
        self._ext_model_id: Optional[str] = None

    @property
    def model_id(self) -> str | None:
        return self._model.id if self._model else None

    def is_loaded(self) -> bool:
        return self._model is not None

    async def load(self, model: ModelEntry) -> AsyncGenerator[dict, None]:
        ext_id = _external_model_id(model)

        yield {"event": "stage", "data": {"stage": "connecting", "message": f"Connecting to {self._base_url}…"}}

        # Verify server is reachable
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{self._base_url}/v1/models")
                r.raise_for_status()
        except Exception as e:
            yield {"event": "error", "data": {"message": f"Cannot reach {self._base_url}: {e}"}}
            return

        yield {"event": "stage", "data": {"stage": "loading", "message": f"Requesting {model.name} from {self._base_url}…"}}

        # Send a warmup request with the target model ID.
        # oMLX will evict the current model and load the new one automatically.
        t0 = time.monotonic()
        warmup_ok = False
        last_ping = t0

        async with httpx.AsyncClient(timeout=600.0) as client:
            while time.monotonic() - t0 < 600:
                try:
                    r = await client.post(
                        f"{self._base_url}/v1/chat/completions",
                        json={
                            "model": ext_id,
                            "messages": [{"role": "user", "content": "hi"}],
                            "max_tokens": 16,
                            "temperature": 0.0,
                        },
                        timeout=60.0,
                    )
                    if r.status_code == 200:
                        data = r.json()
                        if data.get("choices"):
                            warmup_ok = True
                            break
                        # choices present but empty — still loading
                    elif r.status_code == 404:
                        yield {"event": "error", "data": {"message": f"Model '{ext_id}' not found on {self._base_url}."}}
                        return
                except httpx.TimeoutException:
                    pass
                except Exception:
                    pass

                now = time.monotonic()
                if now - last_ping >= 5:
                    elapsed = int(now - t0)
                    yield {"event": "stage", "data": {"stage": "loading", "message": f"Loading {model.name}… ({elapsed}s)"}}
                    last_ping = now
                await asyncio.sleep(2.0)

        if not warmup_ok:
            yield {"event": "error", "data": {"message": f"Timed out waiting for {self._base_url} to load '{ext_id}'"}}
            return

        self._model = model
        self._ext_model_id = ext_id
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        yield {"event": "done", "data": {"model_id": model.id, "elapsed_ms": elapsed_ms}}

    async def stop(self) -> None:
        # We don't own the server. Just clear local tracking.
        self._model = None
        self._ext_model_id = None


class ManagedExternalAdapter(ExternalAdapter):
    """ExternalAdapter that kills the server process on stop (e.g. MLX Studio/vMLX)."""

    def __init__(self, base_url: str):
        super().__init__(base_url)
        # Parse port from base_url for process cleanup
        from urllib.parse import urlparse
        parsed = urlparse(base_url)
        self._port = parsed.port or 80

    async def stop(self) -> None:
        from adapters.port_utils import kill_port
        await kill_port(self._port)
        self._model = None
        self._ext_model_id = None

    async def chat(
        self,
        messages: list[ChatMessage],
        temperature: float,
        max_tokens: int,
    ) -> AsyncGenerator[dict, None]:
        ext_id = self._ext_model_id or (
            _external_model_id(self._model) if self._model else "local"
        )
        payload = {
            "model": ext_id,
            "messages": [m.model_dump() for m in messages],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }
        t0 = time.monotonic()
        first_token_time: float | None = None
        total_tokens = 0
        prompt_tokens: int | None = None
        # Reset metrics so stale values don't persist if this chat fails
        self.last_prompt_tps = None

        async with httpx.AsyncClient(timeout=300.0) as client:
            async with client.stream(
                "POST",
                f"{self._base_url}/v1/chat/completions",
                json=payload,
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

                    # Usage/stats chunk (oMLX sends this as a final chunk with choices:[])
                    usage = data.get("usage") or {}
                    if usage:
                        if usage.get("prompt_tokens_per_second"):
                            self.last_prompt_tps = round(usage["prompt_tokens_per_second"], 2)
                        if usage.get("generation_tokens_per_second"):
                            self.last_tps = round(usage["generation_tokens_per_second"], 2)
                        if usage.get("time_to_first_token"):
                            self.last_ttft_ms = round(usage["time_to_first_token"] * 1000, 2)
                        # llama-server compat
                        if usage.get("prompt_tokens") and not usage.get("prompt_tokens_per_second"):
                            prompt_tokens = usage["prompt_tokens"]
                    # llama-server timings block
                    timings = data.get("timings") or {}
                    if timings.get("prompt_per_second"):
                        self.last_prompt_tps = round(timings["prompt_per_second"], 2)

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

        # Fallback timing from local wall clock if server didn't send usage stats
        if first_token_time and not self.last_ttft_ms:
            self.last_ttft_ms = round((first_token_time - t0) * 1000, 2)
        if first_token_time and not self.last_tps and total_tokens > 0:
            gen_time = t1 - first_token_time
            if gen_time > 0:
                self.last_tps = round(total_tokens / gen_time, 2)
        if prompt_tokens and first_token_time and not self.last_prompt_tps:
            ttft_s = first_token_time - t0
            if ttft_s > 0:
                self.last_prompt_tps = round(prompt_tokens / ttft_s, 2)

        yield {"token": "", "done": True}
