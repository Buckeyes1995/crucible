"""vLLM adapter — manages `vllm serve` subprocess (vllm-metal on Apple Silicon)."""
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


class VLLMAdapter(BaseAdapter):
    def __init__(self, port: int = 8020, vllm_bin: str = "~/.venv-vllm-metal/bin/vllm"):
        self._port = port
        self._vllm_bin = str(Path(vllm_bin).expanduser())
        self._process: Optional[asyncio.subprocess.Process] = None
        self._model: Optional[ModelEntry] = None
        self._server_model_id: Optional[str] = None
        self._base_url = f"http://127.0.0.1:{port}"
        self._stderr_buf: list[bytes] = []

    @property
    def port(self) -> int:
        return self._port

    @property
    def model_id(self) -> str | None:
        return self._model.id if self._model else None

    def is_loaded(self) -> bool:
        return self._process is not None and self._process.returncode is None

    async def _drain_stderr(self) -> None:
        if not self._process or not self._process.stderr:
            return
        try:
            while True:
                line = await self._process.stderr.readline()
                if not line:
                    break
                self._stderr_buf.append(line)
                if len(self._stderr_buf) > 80:
                    self._stderr_buf = self._stderr_buf[-80:]
        except Exception:
            pass

    async def load(self, model: ModelEntry) -> AsyncGenerator[dict, None]:
        await self.stop()
        await kill_port(self._port)

        p = get_params(model.id)
        ctx = p.get("context_window") or model.context_window

        # vLLM accepts either an HF repo ID or a local path. Our registry sets
        # `path` to the local directory containing config.json + safetensors.
        model_arg = model.path or model.name

        cmd = [
            self._vllm_bin, "serve", model_arg,
            "--port", str(self._port),
            "--host", "127.0.0.1",
        ]
        if ctx:
            cmd += ["--max-model-len", str(ctx)]
        if p.get("dtype"):
            cmd += ["--dtype", str(p["dtype"])]
        if p.get("gpu_memory_utilization") is not None:
            cmd += ["--gpu-memory-utilization", str(p["gpu_memory_utilization"])]
        if p.get("extra_args"):
            cmd += list(p["extra_args"])

        yield {"event": "stage", "data": {"stage": "starting", "message": f"Starting vllm serve on :{self._port}…"}}

        self._stderr_buf = []
        try:
            self._process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError:
            yield {"event": "error", "data": {"message": f"vllm binary not found at {self._vllm_bin}. Install with: curl -fsSL https://raw.githubusercontent.com/vllm-project/vllm-metal/main/install.sh | bash"}}
            return

        asyncio.create_task(self._drain_stderr())

        yield {"event": "stage", "data": {"stage": "loading", "message": "Loading weights…"}}

        await asyncio.sleep(2.0)
        if self._process.returncode is not None:
            stderr_tail = b"".join(self._stderr_buf).decode(errors="replace")[-600:]
            yield {"event": "error", "data": {"message": f"vllm serve failed to start: {stderr_tail.strip() or 'unknown error'}"}}
            return

        t0 = time.monotonic()
        ready = False
        last_ping = t0
        async with httpx.AsyncClient() as client:
            # vLLM cold-start on Apple Silicon can be slow (MLX kernel compile + weights)
            while time.monotonic() - t0 < 900:
                if self._process.returncode is not None:
                    yield {"event": "error", "data": {"message": "vllm serve exited unexpectedly"}}
                    return
                try:
                    r = await client.get(f"{self._base_url}/v1/models", timeout=2.0)
                    if r.status_code == 200:
                        ready = True
                        data = r.json()
                        items = data.get("data", [])
                        if items:
                            self._server_model_id = items[0].get("id", model_arg)
                        else:
                            self._server_model_id = model_arg
                        break
                except Exception:
                    pass
                await asyncio.sleep(1.5)
                now = time.monotonic()
                if now - last_ping >= 10:
                    elapsed = int(now - t0)
                    stderr_tail = b"".join(self._stderr_buf[-3:]).decode(errors="replace").strip()
                    msg = f"Loading weights… ({elapsed}s)"
                    if stderr_tail:
                        last_line = stderr_tail.splitlines()[-1][:140]
                        msg += f" — {last_line}"
                    yield {"event": "stage", "data": {"stage": "loading", "message": msg}}
                    last_ping = now

        if not ready:
            await self.stop()
            yield {"event": "error", "data": {"message": "Timed out waiting for vllm serve"}}
            return

        self._model = model
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        yield {"event": "done", "data": {"model_id": model.id, "elapsed_ms": elapsed_ms}}

    async def stop(self) -> None:
        if self._process and self._process.returncode is None:
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=15.0)
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
        model_id = self._server_model_id or (self._model.path if self._model else "local")
        p = get_params(self._model.id) if self._model else {}
        payload = {
            "model": model_id,
            "messages": [m.model_dump() for m in messages],
            "temperature": p.get("temperature", temperature),
            "max_tokens": p.get("max_tokens", max_tokens),
            "stream": True,
        }
        if p.get("top_p") is not None:
            payload["top_p"] = p["top_p"]
        if p.get("top_k") is not None:
            payload["top_k"] = p["top_k"]
        if p.get("presence_penalty") is not None:
            payload["presence_penalty"] = p["presence_penalty"]
        if p.get("frequency_penalty") is not None:
            payload["frequency_penalty"] = p["frequency_penalty"]

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
                        content = delta.get("content") or delta.get("reasoning_content") or delta.get("reasoning") or ""
                        if content:
                            yield {"token": content, "done": False}
                    except Exception:
                        continue
        yield {"token": "", "done": True}
