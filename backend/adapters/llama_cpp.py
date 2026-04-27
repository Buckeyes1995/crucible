"""llama-server (llama.cpp) adapter."""

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


class LlamaCppAdapter(BaseAdapter):
    def __init__(self, server_path: str, port: int = 8080):
        self._server_path = Path(server_path).expanduser()
        self._port = port
        self._process: Optional[asyncio.subprocess.Process] = None
        self._model: Optional[ModelEntry] = None
        self._base_url = f"http://127.0.0.1:{port}"
        self._server_model_id = "local"  # llama-server accepts any model name

    @property
    def model_id(self) -> str | None:
        return self._model.id if self._model else None

    def is_loaded(self) -> bool:
        return self._process is not None and self._process.returncode is None

    async def load(self, model: ModelEntry) -> AsyncGenerator[dict, None]:
        yield {
            "event": "stage",
            "data": {"stage": "starting", "message": "Starting llama-server…"},
        }

        await self.stop()
        await kill_port(self._port)

        if not self._server_path.exists():
            yield {
                "event": "error",
                "data": {
                    "message": f"llama-server binary not found: {self._server_path}. Update the path in Settings."
                },
            }
            return

        p = get_params(model.id)
        ctx = p.get("context_window") or model.context_window

        cmd = [
            str(self._server_path),
            "--model",
            model.path,
            "--port",
            str(self._port),
            "--host",
            "127.0.0.1",
        ]
        if ctx:
            cmd += ["--ctx-size", str(ctx)]
        if p.get("batch_size"):
            cmd += ["--batch-size", str(p["batch_size"])]
        if p.get("ubatch_size"):
            cmd += ["--ubatch-size", str(p["ubatch_size"])]
        if p.get("threads"):
            cmd += ["--threads", str(p["threads"])]
        if p.get("flash_attn"):
            cmd += ["--flash-attn"]
        if p.get("cache_type_k"):
            cmd += ["--cache-type-k", p["cache_type_k"]]
        if p.get("cache_type_v"):
            cmd += ["--cache-type-v", p["cache_type_v"]]
        # Speculative decoding — pair the target model with a small draft.
        # Flags map cleanly:
        #   draft_model       → --model-draft <path-to-draft.gguf>
        #   num_draft_tokens  → --draft-max <N>   (tokens per draft step,
        #                       default 16; 4–8 is the typical sweet spot)
        # The draft must use the same tokenizer as the target — usually a
        # smaller quant of the same family (e.g. Qwen3-0.6B-Q4 drafting
        # for Qwen3-35B-Q6_K).
        if p.get("draft_model"):
            cmd += ["--model-draft", str(p["draft_model"])]
        if p.get("num_draft_tokens"):
            cmd += ["--draft-max", str(p["num_draft_tokens"])]
        if p.get("extra_args"):
            cmd += p["extra_args"]

        try:
            self._process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError:
            yield {
                "event": "error",
                "data": {
                    "message": f"llama-server binary not found: {self._server_path}. Update the path in Settings."
                },
            }
            return
        except Exception as e:
            yield {
                "event": "error",
                "data": {"message": f"Failed to start llama-server: {e}"},
            }
            return

        # From here on we own a live llama-server subprocess. If the
        # generator exits without reaching the "done" yield (client
        # disconnect, CancelledError, exception, early error return), we
        # MUST kill the subprocess in a finally block — otherwise it
        # keeps holding :8080 as an orphan, Crucible's active_adapter
        # stays None, and the user's UI shows "no model loaded" while
        # llama-server sits there warmed up. `success` flips True only
        # on the final yield.
        success = False
        try:
            yield {
                "event": "stage",
                "data": {"stage": "loading", "message": "Loading weights…"},
            }

            await asyncio.sleep(2.0)
            if self._process.returncode is not None:
                stderr_out = ""
                if self._process.stderr:
                    try:
                        raw = await asyncio.wait_for(self._process.stderr.read(4096), timeout=1.0)
                        stderr_out = raw.decode(errors="replace").strip()
                    except Exception:
                        pass
                msg = f"llama-server exited (code {self._process.returncode})"
                if stderr_out:
                    last_lines = "\n".join(stderr_out.splitlines()[-5:])
                    msg += f":\n{last_lines}"
                yield {"event": "error", "data": {"message": msg}}
                return

            t0 = time.monotonic()
            ready = False
            async with httpx.AsyncClient() as client:
                while time.monotonic() - t0 < 180:
                    if self._process.returncode is not None:
                        stderr_out = ""
                        if self._process.stderr:
                            try:
                                raw = await asyncio.wait_for(self._process.stderr.read(4096), timeout=1.0)
                                stderr_out = raw.decode(errors="replace").strip()
                            except Exception:
                                pass
                        msg = "llama-server exited unexpectedly"
                        if stderr_out:
                            last_lines = "\n".join(stderr_out.splitlines()[-5:])
                            msg += f":\n{last_lines}"
                        yield {"event": "error", "data": {"message": msg}}
                        return
                    try:
                        r = await client.get(f"{self._base_url}/health", timeout=2.0)
                        if r.status_code == 200:
                            ready = True
                            break
                    except Exception:
                        pass
                    await asyncio.sleep(1.0)

            if not ready:
                # stop() handles the kill; mark success so the finally
                # below doesn't double-kill an already-cleaned process.
                await self.stop()
                success = True
                yield {
                    "event": "error",
                    "data": {"message": "Timed out waiting for llama-server"},
                }
                return

            yield {"event": "stage", "data": {"stage": "warmup", "message": "Warming up…"}}

            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    await client.post(
                        f"{self._base_url}/v1/chat/completions",
                        json={
                            "model": "local",
                            "messages": [{"role": "user", "content": "hi"}],
                            "max_tokens": 1,
                            "temperature": 0.0,
                        },
                    )
            except Exception:
                pass

            self._model = model
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            success = True
            yield {
                "event": "done",
                "data": {"model_id": model.id, "elapsed_ms": elapsed_ms},
            }
        finally:
            if not success and self._process is not None and self._process.returncode is None:
                try:
                    self._process.terminate()
                    await asyncio.wait_for(self._process.wait(), timeout=5.0)
                except asyncio.TimeoutError:
                    try:
                        self._process.kill()
                    except Exception:
                        pass
                except Exception:
                    pass
                self._process = None
                self._model = None

    async def stop(self) -> None:
        if self._process and self._process.returncode is None:
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=10.0)
            except asyncio.TimeoutError:
                self._process.kill()
        self._process = None
        self._model = None

    async def chat(
        self,
        messages: list[ChatMessage],
        temperature: float,
        max_tokens: int,
    ) -> AsyncGenerator[dict, None]:
        p = get_params(self._model.id) if self._model else {}
        payload = {
            "model": "local",
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

        t0 = time.monotonic()
        first_token_time = None
        total_tokens = 0

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
                        # Extract prompt eval speed from llama-server timings
                        timings = data.get("timings") or {}
                        if timings.get("prompt_per_second"):
                            self.last_prompt_tps = round(timings["prompt_per_second"], 2)
                        delta = data["choices"][0]["delta"]
                        content = delta.get("content") or delta.get("reasoning_content") or delta.get("reasoning") or ""
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
