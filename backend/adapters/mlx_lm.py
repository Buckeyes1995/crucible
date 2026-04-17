"""MLX-LM adapter — manages mlx_lm.server subprocess."""
import asyncio
import json
import time
from pathlib import Path
from typing import AsyncGenerator, Optional

import httpx

from adapters.base import BaseAdapter
from adapters.port_utils import kill_port
from model_params import get_params
from models.schemas import ModelEntry, ChatMessage


class MLXAdapter(BaseAdapter):
    def __init__(self, port: int = 8010, python: str = "~/.venvs/mlx/bin/python"):
        self._port = port
        self._python = str(Path(python).expanduser())
        self._process: Optional[asyncio.subprocess.Process] = None
        self._model: Optional[ModelEntry] = None
        self._server_model_id: Optional[str] = None
        self._base_url = f"http://127.0.0.1:{port}"

    @property
    def model_id(self) -> str | None:
        return self._model.id if self._model else None

    def is_loaded(self) -> bool:
        return self._process is not None and self._process.returncode is None

    async def _drain_stderr(self) -> None:
        """Read stderr continuously so the pipe buffer never fills."""
        if not self._process or not self._process.stderr:
            return
        try:
            while True:
                line = await self._process.stderr.readline()
                if not line:
                    break
                self._stderr_buf.append(line)
                # Keep only the last 50 lines worth
                if len(self._stderr_buf) > 50:
                    self._stderr_buf = self._stderr_buf[-50:]
        except Exception:
            pass

    async def load(self, model: ModelEntry) -> AsyncGenerator[dict, None]:
        await self.stop()
        await kill_port(self._port)

        p = get_params(model.id)
        ctx = p.get("context_window") or model.context_window

        cmd = [
            self._python, "-m", "mlx_lm.server",
            "--model", model.path,
            "--port", str(self._port),
        ]
        if ctx:
            cmd += ["--max-tokens", str(ctx)]
        if p.get("cache_limit_gb"):
            cmd += ["--prompt-cache-bytes", str(int(p["cache_limit_gb"] * 1024 ** 3))]
        if p.get("draft_model"):
            cmd += ["--draft-model", str(p["draft_model"])]
        if p.get("num_draft_tokens"):
            cmd += ["--num-draft-tokens", str(p["num_draft_tokens"])]
        if p.get("extra_args"):
            cmd += p["extra_args"]

        yield {"event": "stage", "data": {"stage": "starting", "message": f"Starting mlx_lm.server on :{self._port}… ({self._python})"}}

        self._stderr_buf: list[bytes] = []
        self._process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        # Drain stderr in background so the pipe doesn't block
        asyncio.create_task(self._drain_stderr())

        yield {"event": "stage", "data": {"stage": "loading", "message": "Loading weights…"}}

        # Brief pause — let the process either bind or fail before health-checking.
        await asyncio.sleep(2.0)
        if self._process.returncode is not None:
            stderr_tail = b"".join(self._stderr_buf).decode(errors="replace")[-400:]
            msg = f"mlx_lm.server failed to start: {stderr_tail.strip() or 'unknown error'}"
            yield {"event": "error", "data": {"message": msg}}
            return

        # Wait for server to be ready (up to 600s — large models can take several minutes)
        t0 = time.monotonic()
        ready = False
        last_ping = t0
        async with httpx.AsyncClient() as client:
            while time.monotonic() - t0 < 600:
                if self._process.returncode is not None:
                    yield {"event": "error", "data": {"message": "mlx_lm.server exited unexpectedly"}}
                    return
                try:
                    r = await client.get(f"{self._base_url}/v1/models", timeout=2.0)
                    if r.status_code == 200:
                        ready = True
                        break
                except Exception:
                    pass
                await asyncio.sleep(1.0)
                # Send a heartbeat every 10s so the UI knows we're still alive
                now = time.monotonic()
                if now - last_ping >= 10:
                    elapsed = int(now - t0)
                    stderr_tail = b"".join(self._stderr_buf[-3:]).decode(errors="replace").strip()
                    msg = f"Loading weights… ({elapsed}s)"
                    if stderr_tail:
                        last_line = stderr_tail.splitlines()[-1][:120]
                        msg += f" — {last_line}"
                    yield {"event": "stage", "data": {"stage": "loading", "message": msg}}
                    last_ping = now

        if not ready:
            await self.stop()
            yield {"event": "error", "data": {"message": "Timed out waiting for mlx_lm.server"}}
            return

        yield {"event": "stage", "data": {"stage": "warmup", "message": "Warming up…"}}

        # Warmup: send a single inference request and wait up to 10 minutes.
        # mlx_lm.server loads weights lazily on the first request, so this may
        # block for the full model-load duration before returning.
        # We run it as a Task so we can yield progress heartbeats while waiting.
        server_model_id = model.path if model.path else model.name

        async def _warmup_request() -> bool:
            try:
                async with httpx.AsyncClient(timeout=600.0) as c:
                    r = await c.post(
                        f"{self._base_url}/v1/chat/completions",
                        json={
                            "model": server_model_id,
                            "messages": [{"role": "user", "content": "hi"}],
                            "max_tokens": 16,
                            "temperature": 0.0,
                        },
                    )
                    if r.status_code == 200 and r.json().get("choices"):
                        return True
            except Exception:
                pass
            return False

        warmup_task = asyncio.create_task(_warmup_request())
        while not warmup_task.done():
            if self._process.returncode is not None:
                warmup_task.cancel()
                yield {"event": "error", "data": {"message": "mlx_lm.server exited during warmup"}}
                return
            elapsed = int(time.monotonic() - t0)
            if elapsed > 600:
                warmup_task.cancel()
                await self.stop()
                yield {"event": "error", "data": {"message": "mlx_lm.server warmup timed out after 10 minutes"}}
                return
            yield {"event": "stage", "data": {"stage": "warmup", "message": f"Warming up… ({elapsed}s)"}}
            await asyncio.sleep(5.0)

        warmup_ok = warmup_task.result()
        if not warmup_ok:
            await self.stop()
            yield {"event": "error", "data": {"message": "mlx_lm.server warmup failed — model may not be compatible"}}
            return

        self._model = model
        self._server_model_id = server_model_id
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        yield {"event": "done", "data": {"model_id": model.id, "elapsed_ms": elapsed_ms}}

    async def stop(self) -> None:
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
        model_id = self._server_model_id or (
            self._model.path if self._model and self._model.path else "local"
        )
        p = get_params(self._model.id) if self._model else {}
        payload = {
            "model": model_id,
            "messages": [m.model_dump() for m in messages],
            "temperature": p.get("temperature", temperature),
            "max_tokens": p.get("max_tokens", max_tokens),
            "stream": True,
        }
        if p.get("top_k") is not None:
            payload["top_k"] = p["top_k"]
        if p.get("top_p") is not None:
            payload["top_p"] = p["top_p"]
        if p.get("min_p") is not None:
            payload["min_p"] = p["min_p"]
        if p.get("repetition_penalty") is not None:
            payload["repetition_penalty"] = p["repetition_penalty"]
        if p.get("presence_penalty") is not None:
            payload["presence_penalty"] = p["presence_penalty"]
        ctk = {}
        if p.get("enable_thinking") is not None:
            ctk["enable_thinking"] = bool(p["enable_thinking"])
        if p.get("preserve_thinking") is not None:
            ctk["preserve_thinking"] = bool(p["preserve_thinking"])
        if ctk:
            payload["chat_template_kwargs"] = ctk
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
                        delta = data["choices"][0]["delta"]
                        content = delta.get("content") or delta.get("reasoning") or ""
                        if content:
                            yield {"token": content, "done": False}
                    except Exception:
                        continue
        yield {"token": "", "done": True}
