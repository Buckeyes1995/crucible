"""oMLX adapter — spawns oMLX as a subprocess if not already running,
then delegates model loading and chat to it.
"""

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import AsyncGenerator, Optional

import httpx

from adapters.base import BaseAdapter
from adapters.port_utils import kill_port
from model_params import get_params
from models.schemas import ModelEntry, ChatMessage

log = logging.getLogger(__name__)

API_KEY = "123456"
OMLX_BINARY = Path.home() / ".venvs" / "omlx" / "bin" / "omlx"
OMLX_CACHE_DIR = "/Volumes/DataNVME/omlx-cache"


class OMLXAdapter(BaseAdapter):
    def __init__(self, base_url: str = "http://127.0.0.1:8000", model_dir: str = ""):
        self._base_url = base_url
        self._model_dir = model_dir
        self._port = int(base_url.rstrip("/").rsplit(":", 1)[-1])
        self._process: Optional[asyncio.subprocess.Process] = None
        self._model: Optional[ModelEntry] = None
        self._server_model_id: Optional[str] = None

    @property
    def model_id(self) -> str | None:
        return self._model.id if self._model else None

    def is_loaded(self) -> bool:
        return self._model is not None

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {API_KEY}"}

    async def _is_running(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                r = await client.get(f"{self._base_url}/health")
                return r.status_code == 200
        except Exception:
            return False

    async def _spawn(self) -> bool:
        """Start oMLX as a subprocess. Returns True if healthy within timeout."""
        if not OMLX_BINARY.exists():
            return False
        await kill_port(self._port)
        cmd = [
            str(OMLX_BINARY), "serve",
            "--model-dir", self._model_dir,
            "--port", str(self._port),
            "--paged-ssd-cache-dir", OMLX_CACHE_DIR,
            "--api-key", API_KEY,
        ]
        self._process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        # Wait up to 30s for oMLX to become healthy
        t0 = time.monotonic()
        while time.monotonic() - t0 < 30:
            if self._process.returncode is not None:
                return False
            if await self._is_running():
                return True
            await asyncio.sleep(1.0)
        return False

    async def load(self, model: ModelEntry) -> AsyncGenerator[dict, None]:
        model_name = Path(model.path).name if model.path else model.name

        yield {"event": "stage", "data": {"stage": "starting", "message": "Starting oMLX…"}}

        if not await self._is_running():
            yield {"event": "stage", "data": {"stage": "starting", "message": "Launching oMLX server…"}}
            if not await self._spawn():
                yield {"event": "error", "data": {"message": f"Failed to start oMLX (binary: {OMLX_BINARY})"}}
                return

        yield {
            "event": "stage",
            "data": {"stage": "loading", "message": f"Loading {model_name} into oMLX…"},
        }

        # Unload previous model if different
        if (
            self._model
            and self._server_model_id
            and self._server_model_id != model_name
        ):
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    await client.post(
                        f"{self._base_url}/v1/models/{self._server_model_id}/unload",
                        headers=self._headers(),
                    )
            except Exception:
                pass

        # Trigger load by sending a warmup request — oMLX loads on first use
        t0 = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=600.0) as client:
                r = await client.post(
                    f"{self._base_url}/v1/chat/completions",
                    headers=self._headers(),
                    json={
                        "model": model_name,
                        "messages": [{"role": "user", "content": "hi"}],
                        "max_tokens": 1,
                        "temperature": 0.0,
                    },
                )
                if r.status_code not in (200, 201):
                    yield {
                        "event": "error",
                        "data": {"message": f"oMLX load failed: {r.text[:300]}"},
                    }
                    return
        except Exception as e:
            yield {"event": "error", "data": {"message": f"oMLX warmup failed: {e}"}}
            return

        self._model = model
        self._server_model_id = model_name
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        yield {
            "event": "done",
            "data": {"model_id": model.id, "elapsed_ms": elapsed_ms},
        }

    async def stop(self) -> None:
        if self._model and self._server_model_id:
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    await client.post(
                        f"{self._base_url}/v1/models/{self._server_model_id}/unload",
                        headers=self._headers(),
                    )
            except Exception:
                pass
        if self._process and self._process.returncode is None:
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=10.0)
            except asyncio.TimeoutError:
                self._process.kill()
        self._process = None
        self._model = None
        self._server_model_id = None

    async def chat(
        self,
        messages: list[ChatMessage],
        temperature: float,
        max_tokens: int,
    ) -> AsyncGenerator[dict, None]:
        import time

        p = get_params(self._model.id) if self._model else {}
        payload: dict = {
            "model": self._server_model_id,
            "messages": [m.model_dump() for m in messages],
            "temperature": p.get("temperature", temperature),
            "max_tokens": p.get("max_tokens", max_tokens),
            "stream": True,
        }
        for key in (
            "top_k",
            "top_p",
            "min_p",
            "repetition_penalty",
            "presence_penalty",
        ):
            if p.get(key) is not None:
                payload[key] = p[key]

        t0 = time.monotonic()
        first_token_time = None
        total_tokens = 0

        async with httpx.AsyncClient(timeout=300.0) as client:
            async with client.stream(
                "POST",
                f"{self._base_url}/v1/chat/completions",
                headers=self._headers(),
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
                        delta = data["choices"][0]["delta"]
                        content = delta.get("content") or delta.get("reasoning") or ""
                        if content:
                            if first_token_time is None:
                                first_token_time = time.monotonic()
                            total_tokens += 1
                            yield {"token": content, "done": False}
                    except Exception:
                        continue

        t1 = time.monotonic()
        elapsed_s = t1 - t0

        if first_token_time:
            ttft_ms = (first_token_time - t0) * 1000
            self.last_ttft_ms = round(ttft_ms, 2)

        if total_tokens > 0 and elapsed_s > 0:
            tps = total_tokens / elapsed_s
            self.last_tps = round(tps, 2)

        yield {"token": "", "done": True}
