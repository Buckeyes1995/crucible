"""macOS powermetrics sampler — captures average CPU+GPU watts during a window."""
import asyncio
import json
import re
import sys
from typing import Optional

# Matches lines like: "CPU Power: 1234 mW" or "GPU Power: 567 mW"
_CPU_RE = re.compile(r"CPU Power:\s*(\d+)\s*mW", re.IGNORECASE)
_GPU_RE = re.compile(r"GPU Power:\s*(\d+)\s*mW", re.IGNORECASE)
_ANE_RE = re.compile(r"ANE Power:\s*(\d+)\s*mW", re.IGNORECASE)

_IS_MACOS = sys.platform == "darwin"


class PowerSampler:
    """Context-manager: starts powermetrics in background, stop() returns avg watts."""

    def __init__(self, interval_ms: int = 500):
        self._interval_ms = interval_ms
        self._proc: Optional[asyncio.subprocess.Process] = None
        self._cpu_samples: list[float] = []
        self._gpu_samples: list[float] = []
        self._ane_samples: list[float] = []
        self._task: Optional[asyncio.Task] = None

    async def start(self) -> bool:
        """Start sampling. Returns True if powermetrics is available."""
        if not _IS_MACOS:
            return False
        try:
            self._proc = await asyncio.create_subprocess_exec(
                "sudo", "-n", "powermetrics",
                "--samplers", "cpu_power",
                "-i", str(self._interval_ms),
                "-f", "json",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
        except FileNotFoundError:
            return False

        if self._proc.returncode is not None:
            return False

        self._task = asyncio.create_task(self._collect())
        return True

    async def _collect(self) -> None:
        assert self._proc and self._proc.stdout
        buf = b""
        async for chunk in self._proc.stdout:
            buf += chunk
            # powermetrics -f json emits one JSON object per sample, separated by newlines
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    # Try JSON path first
                    cpu_pkg = data.get("processor", {}).get("package_watts")
                    if cpu_pkg is not None:
                        self._cpu_samples.append(float(cpu_pkg) * 1000)  # W → mW
                    gpu_pkg = data.get("gpu", {}).get("gpu_watts")
                    if gpu_pkg is not None:
                        self._gpu_samples.append(float(gpu_pkg) * 1000)
                except Exception:
                    # Fall back to regex on text output
                    text = line.decode("utf-8", errors="replace")
                    m = _CPU_RE.search(text)
                    if m:
                        self._cpu_samples.append(float(m.group(1)))
                    m = _GPU_RE.search(text)
                    if m:
                        self._gpu_samples.append(float(m.group(1)))
                    m = _ANE_RE.search(text)
                    if m:
                        self._ane_samples.append(float(m.group(1)))

    async def stop(self) -> dict:
        """Stop sampling and return averaged power stats in watts."""
        if self._proc and self._proc.returncode is None:
            self._proc.terminate()
            try:
                await asyncio.wait_for(self._proc.wait(), timeout=3.0)
            except asyncio.TimeoutError:
                self._proc.kill()

        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

        def _avg(samples: list[float]) -> Optional[float]:
            return round(sum(samples) / len(samples) / 1000, 2) if samples else None  # mW → W

        return {
            "cpu_watts": _avg(self._cpu_samples),
            "gpu_watts": _avg(self._gpu_samples),
            "ane_watts": _avg(self._ane_samples),
            "sample_count": len(self._cpu_samples),
        }
