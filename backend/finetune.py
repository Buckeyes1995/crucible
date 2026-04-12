"""MLX LoRA fine-tuning job manager."""
import asyncio
import json
import os
import re
import time
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import AsyncGenerator, Optional

JOBS_FILE = Path.home() / ".config" / "crucible" / "finetune_jobs.json"

# Regex to pull training loss from mlx_lm.lora stdout lines like:
# Iter 10: Train loss 2.345, ...
_LOSS_RE = re.compile(r"Iter\s+(\d+).*?Train loss\s+([\d.]+)", re.IGNORECASE)
_VAL_RE = re.compile(r"Iter\s+(\d+).*?Val loss\s+([\d.]+)", re.IGNORECASE)


@dataclass
class FinetuneJob:
    id: str
    model_id: str
    data_path: str
    output_dir: str
    num_iters: int
    learning_rate: float
    lora_rank: int
    batch_size: int
    grad_checkpoint: bool
    status: str = "queued"  # queued | running | done | error | cancelled
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    error: str = ""
    loss_log: list = field(default_factory=list)  # [{iter, loss, val_loss}]
    pid: Optional[int] = None


_jobs: dict[str, FinetuneJob] = {}
_processes: dict[str, asyncio.subprocess.Process] = {}


def _load_jobs():
    if not JOBS_FILE.exists():
        return
    try:
        raw = json.loads(JOBS_FILE.read_text())
        for item in raw:
            j = FinetuneJob(**{k: v for k, v in item.items() if k != "pid"})
            j.pid = None
            if j.status == "running":
                j.status = "error"
                j.error = "Process was interrupted (server restart)"
            _jobs[j.id] = j
    except Exception:
        pass


def _save_jobs():
    JOBS_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = []
    for j in _jobs.values():
        d = asdict(j)
        d.pop("pid", None)
        data.append(d)
    JOBS_FILE.write_text(json.dumps(data, indent=2))


_load_jobs()


def list_jobs() -> list[dict]:
    return [_job_to_dict(j) for j in sorted(_jobs.values(), key=lambda x: -x.created_at)]


def get_job(job_id: str) -> Optional[FinetuneJob]:
    return _jobs.get(job_id)


def _job_to_dict(j: FinetuneJob) -> dict:
    d = asdict(j)
    d.pop("pid", None)
    return d


def create_job(
    model_id: str,
    data_path: str,
    output_dir: str,
    num_iters: int = 1000,
    learning_rate: float = 1e-4,
    lora_rank: int = 8,
    batch_size: int = 4,
    grad_checkpoint: bool = True,
) -> FinetuneJob:
    job = FinetuneJob(
        id=str(uuid.uuid4()),
        model_id=model_id,
        data_path=data_path,
        output_dir=output_dir,
        num_iters=num_iters,
        learning_rate=learning_rate,
        lora_rank=lora_rank,
        batch_size=batch_size,
        grad_checkpoint=grad_checkpoint,
    )
    _jobs[job.id] = job
    _save_jobs()
    return job


def cancel_job(job_id: str) -> bool:
    job = _jobs.get(job_id)
    if not job:
        return False
    proc = _processes.get(job_id)
    if proc and proc.returncode is None:
        proc.terminate()
    job.status = "cancelled"
    job.finished_at = time.time()
    _save_jobs()
    return True


async def run_job(job_id: str, mlx_python: str = "python") -> AsyncGenerator[dict, None]:
    """Run the job and stream SSE-compatible dicts."""
    job = _jobs.get(job_id)
    if not job:
        yield {"event": "error", "message": "Job not found"}
        return
    if job.status not in ("queued",):
        yield {"event": "error", "message": f"Job is in state '{job.status}', cannot start"}
        return

    job.status = "running"
    job.started_at = time.time()
    job.loss_log = []
    _save_jobs()

    yield {"event": "started", "job_id": job_id}

    # Build command
    cmd = [
        mlx_python, "-m", "mlx_lm.lora",
        "--model", job.model_id,
        "--data", job.data_path,
        "--adapter-path", job.output_dir,
        "--num-iters", str(job.num_iters),
        "--learning-rate", str(job.learning_rate),
        "--lora-rank", str(job.lora_rank),
        "--batch-size", str(job.batch_size),
    ]
    if job.grad_checkpoint:
        cmd.append("--grad-checkpoint")

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env={**os.environ},
        )
        _processes[job_id] = proc
        job.pid = proc.pid

        assert proc.stdout is not None
        async for raw_line in proc.stdout:
            line = raw_line.decode("utf-8", errors="replace").rstrip()
            if not line:
                continue

            m = _LOSS_RE.search(line)
            if m:
                entry = {"iter": int(m.group(1)), "loss": float(m.group(2)), "val_loss": None}
                vm = _VAL_RE.search(line)
                if vm:
                    entry["val_loss"] = float(vm.group(2))
                job.loss_log.append(entry)
                yield {"event": "progress", "iter": entry["iter"], "loss": entry["loss"],
                       "val_loss": entry["val_loss"], "log": line}
            else:
                yield {"event": "log", "log": line}

        await proc.wait()
        if proc.returncode == 0:
            job.status = "done"
            yield {"event": "done", "job_id": job_id}
        elif job.status == "cancelled":
            yield {"event": "cancelled", "job_id": job_id}
        else:
            job.status = "error"
            job.error = f"Process exited with code {proc.returncode}"
            yield {"event": "error", "message": job.error}

    except Exception as e:
        job.status = "error"
        job.error = str(e)
        yield {"event": "error", "message": str(e)}
    finally:
        job.finished_at = time.time()
        _processes.pop(job_id, None)
        _save_jobs()
