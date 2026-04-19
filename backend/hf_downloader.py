"""HuggingFace download manager — concurrent downloads with SSE progress."""
import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import AsyncGenerator, Optional

log = logging.getLogger(__name__)

JOBS_FILE = Path.home() / ".config" / "crucible" / "downloads.json"


@dataclass
class DownloadJob:
    job_id: str
    repo_id: str
    dest_dir: str
    kind: str  # "mlx" | "gguf"
    status: str = "queued"  # queued | downloading | done | error | cancelled
    progress: float = 0.0   # 0.0 – 1.0
    message: str = ""
    error: str = ""
    started_at: float = field(default_factory=time.time)  # wall clock for persistence
    finished_at: Optional[float] = None
    total_bytes: int = 0
    downloaded_bytes: int = 0
    local_dir: str = ""
    # When set, this download is replacing an existing model. To avoid the
    # data-loss race (downloader claims "done" in seconds because existing
    # files match hashes → frontend deletes what it thinks is the old copy
    # but is actually the in-place model), replacements stage into a
    # sibling .staging-<id> dir and atomically swap on success. The old
    # directory is only removed after the swap lands, so a failed download
    # leaves the existing model untouched.
    replace_model_id: Optional[str] = None


class DownloadManager:
    # Cap concurrent downloads to prevent one from starving the other.
    # HF snapshot_download opens ~16 parallel workers per repo, so two
    # running simultaneously produces ~30+ connections competing for
    # bandwidth and TCP slots — smaller downloads get throttled to crawl.
    MAX_CONCURRENT = 1

    def __init__(self) -> None:
        self._jobs: dict[str, DownloadJob] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        self._slots = asyncio.Semaphore(self.MAX_CONCURRENT)

    def load_persisted(self) -> None:
        """Load jobs from disk on startup. In-flight jobs are flagged for
        auto-resume — call resume_interrupted() once the event loop is running."""
        if not JOBS_FILE.exists():
            return
        try:
            data = json.loads(JOBS_FILE.read_text())
            for d in data:
                job = DownloadJob(
                    job_id=d["job_id"],
                    repo_id=d["repo_id"],
                    dest_dir=d["dest_dir"],
                    kind=d["kind"],
                    status=d["status"],
                    progress=d.get("progress", 0.0),
                    message=d.get("message", ""),
                    error=d.get("error", ""),
                    started_at=d.get("started_at", time.time()),
                    finished_at=d.get("finished_at"),
                    total_bytes=d.get("total_bytes", 0),
                    downloaded_bytes=d.get("downloaded_bytes", 0),
                    local_dir=d.get("local_dir", ""),
                    replace_model_id=d.get("replace_model_id"),
                )
                # Any unfinished job is re-queued so resume_interrupted() can
                # respawn it. This includes "error" state because most errors on
                # startup are from a previous interrupted restart (OOM, crash),
                # not a permanent failure. huggingface_hub.snapshot_download is
                # content-addressed, so resuming is cheap — already-downloaded
                # files are skipped. "cancelled" and "done" are left alone.
                if job.status in ("queued", "downloading", "error"):
                    job.status = "queued"
                    job.message = "Queued for auto-resume after restart…"
                    job.error = ""
                    job.finished_at = None
                self._jobs[job.job_id] = job
            log.info("Loaded %d download jobs from disk", len(self._jobs))
        except Exception as e:
            log.warning("Failed to load downloads.json: %s", e)

    def resume_interrupted(self) -> int:
        """Respawn tasks for any jobs left in "queued" state by load_persisted.
        Must be called after the event loop is running. Returns count resumed."""
        count = 0
        for job in self._jobs.values():
            if job.status == "queued" and job.job_id not in self._tasks:
                log.info("Auto-resuming download %s (%s)", job.job_id, job.repo_id)
                task = asyncio.create_task(self._run(job))
                self._tasks[job.job_id] = task
                count += 1
        if count:
            self._persist()
        return count

    def _persist(self) -> None:
        """Save all jobs to disk."""
        try:
            JOBS_FILE.parent.mkdir(parents=True, exist_ok=True)
            data = []
            for job in self._jobs.values():
                data.append({
                    "job_id": job.job_id,
                    "repo_id": job.repo_id,
                    "dest_dir": job.dest_dir,
                    "kind": job.kind,
                    "status": job.status,
                    "progress": job.progress,
                    "message": job.message,
                    "error": job.error,
                    "started_at": job.started_at,
                    "finished_at": job.finished_at,
                    "total_bytes": job.total_bytes,
                    "downloaded_bytes": job.downloaded_bytes,
                    "local_dir": job.local_dir,
                    "replace_model_id": job.replace_model_id,
                })
            JOBS_FILE.write_text(json.dumps(data, indent=2))
        except Exception as e:
            log.warning("Failed to persist downloads.json: %s", e)

    def list_jobs(self) -> list[dict]:
        return [self._job_dict(j) for j in self._jobs.values()]

    def clear_finished(self) -> int:
        """Drop every completed / errored / cancelled job from the history.
        In-flight jobs (queued, downloading) are left alone. Returns the count
        of removed jobs so the caller can report it back to the UI.
        """
        finished = {"done", "error", "cancelled"}
        to_remove = [jid for jid, j in self._jobs.items() if j.status in finished]
        for jid in to_remove:
            self._jobs.pop(jid, None)
            self._tasks.pop(jid, None)
        if to_remove:
            self._persist()
        return len(to_remove)

    def get_job(self, job_id: str) -> Optional[DownloadJob]:
        return self._jobs.get(job_id)

    def _job_dict(self, job: DownloadJob) -> dict:
        now = time.time()
        elapsed = (job.finished_at or now) - job.started_at
        return {
            "job_id": job.job_id,
            "repo_id": job.repo_id,
            "dest_dir": job.dest_dir,
            "local_dir": job.local_dir,
            "kind": job.kind,
            "status": job.status,
            "progress": round(job.progress, 4),
            "message": job.message,
            "error": job.error,
            "elapsed_s": round(max(elapsed, 0), 1),
            "total_bytes": job.total_bytes,
            "downloaded_bytes": job.downloaded_bytes,
            "replace_model_id": job.replace_model_id,
        }

    def start_download(
        self, repo_id: str, dest_dir: str, kind: str,
        replace_model_id: Optional[str] = None,
    ) -> str:
        job_id = str(uuid.uuid4())[:8]
        job = DownloadJob(
            job_id=job_id, repo_id=repo_id, dest_dir=dest_dir, kind=kind,
            replace_model_id=replace_model_id,
        )
        self._jobs[job_id] = job
        self._persist()
        task = asyncio.create_task(self._run(job))
        self._tasks[job_id] = task
        return job_id

    def resume_job(self, job_id: str) -> bool:
        """Restart a failed or cancelled job from where it left off."""
        job = self._jobs.get(job_id)
        if not job or job.status not in ("error", "cancelled"):
            return False
        job.status = "queued"
        job.error = ""
        job.progress = 0.0
        job.message = "Resuming…"
        job.started_at = time.time()
        job.finished_at = None
        self._persist()
        task = asyncio.create_task(self._run(job))
        self._tasks[job_id] = task
        return True

    def cancel_job(self, job_id: str) -> bool:
        task = self._tasks.get(job_id)
        if task and not task.done():
            task.cancel()
            job = self._jobs.get(job_id)
            if job:
                job.status = "cancelled"
                job.error = "Cancelled"
                job.finished_at = time.time()
                self._persist()
            return True
        return False

    def scan_partial(self, mlx_dir: str, gguf_dir: str) -> list[dict]:
        """Scan model dirs for incomplete directories not tracked by any job."""
        known_local_dirs = {j.local_dir for j in self._jobs.values() if j.local_dir}
        results = []

        def _check_dir(d: Path, kind: str):
            if not d.is_dir() or str(d) in known_local_dirs:
                return
            if kind == "mlx":
                complete = (d / "config.json").exists()
            else:
                complete = bool(list(d.rglob("*.gguf"))) and not list(d.rglob("*.incomplete"))
            if not complete:
                size = sum(f.stat().st_size for f in d.rglob("*") if f.is_file())
                results.append({
                    "local_dir": str(d),
                    "repo_id": d.name,
                    "kind": kind,
                    "size_bytes": size,
                })

        for parent, kind in [(Path(mlx_dir), "mlx"), (Path(gguf_dir), "gguf")]:
            if parent.is_dir():
                for child in parent.iterdir():
                    _check_dir(child, kind)

        return results

    async def _run(self, job: DownloadJob) -> None:
        try:
            # Respect concurrency cap — other jobs wait here while one runs
            if self._slots.locked():
                job.message = "Waiting for another download to finish…"
                self._persist()
            async with self._slots:
                job.status = "downloading"
                job.message = f"Starting download of {job.repo_id}…"
                self._persist()
                await self._download_repo(job)
            job.status = "done"
            job.progress = 1.0
            job.message = f"Downloaded to {job.dest_dir}"
            job.finished_at = time.time()
            self._persist()
            log.info("Download complete: %s → %s", job.repo_id, job.dest_dir)
            import webhooks as wh
            asyncio.create_task(wh.fire("download.done", {
                "repo_id": job.repo_id, "kind": job.kind, "dest_dir": job.dest_dir,
            }))
            # Auto-benchmark: refresh registry and queue a quick benchmark
            try:
                from auto_bench import on_download_complete
                asyncio.create_task(on_download_complete(job))
            except Exception as e:
                log.warning("Auto-benchmark hook failed: %s", e)
        except asyncio.CancelledError:
            job.status = "cancelled"
            job.error = "Cancelled"
            job.finished_at = time.time()
            self._persist()
        except Exception as e:
            job.status = "error"
            job.error = str(e)
            job.finished_at = time.time()
            self._persist()
            log.exception("Download failed: %s", job.repo_id)

    async def _download_repo(self, job: DownloadJob) -> None:
        """Run huggingface_hub snapshot_download in a thread with progress tracking."""
        import shutil
        from huggingface_hub import snapshot_download, list_repo_tree

        dest = Path(job.dest_dir)
        dest.mkdir(parents=True, exist_ok=True)
        final_dir = dest / Path(job.repo_id).name
        # Replacement downloads stage into a sibling to avoid the data-loss
        # race where snapshot_download reports "done" in seconds because
        # all files already exist on disk — the frontend then deletes what
        # it thinks is the old copy but is actually the live one.
        if job.replace_model_id:
            download_dir = dest / f"{Path(job.repo_id).name}.staging-{job.job_id}"
            # Ensure staging is fresh — an aborted prior attempt shouldn't
            # leak bytes into the "downloaded" count.
            if download_dir.exists():
                shutil.rmtree(download_dir, ignore_errors=True)
        else:
            download_dir = final_dir
        job.local_dir = str(download_dir)

        # Measure already-downloaded bytes (resume case). Replacement jobs
        # always start from empty because the staging dir was just cleared.
        existing_bytes = 0
        if download_dir.exists():
            existing_bytes = sum(f.stat().st_size for f in download_dir.rglob("*") if f.is_file())
            if existing_bytes > 0:
                job.message = f"Resuming — {_fmt_bytes(existing_bytes)} already on disk…"

        # Estimate total size
        try:
            total = 0
            files = []
            for item in list_repo_tree(job.repo_id, recursive=True):
                if hasattr(item, "size") and item.size:
                    total += item.size
                    files.append(item)
            job.total_bytes = total
            job.downloaded_bytes = existing_bytes
            job.message = (
                f"Resuming {len(files)} files ({_fmt_bytes(total)})…"
                if existing_bytes > 0
                else f"Fetching {len(files)} files ({_fmt_bytes(total)})…"
            )
        except Exception:
            job.message = "Fetching file list…"

        ignore = []
        if job.kind == "mlx":
            ignore = ["*.gguf", "*.bin", "original/*"]
        elif job.kind == "gguf":
            ignore = ["*.safetensors", "*.msgpack", "flax_model*", "tf_model*"]

        loop = asyncio.get_event_loop()

        def _do_download():
            return snapshot_download(
                repo_id=job.repo_id,
                local_dir=str(download_dir),
                ignore_patterns=ignore,
                local_files_only=False,
            )

        download_fut = loop.run_in_executor(None, _do_download)

        # Windowed speed: track bytes over the last ~10s instead of cumulative
        # since start. Resume baselines otherwise make "speed since resume"
        # show 0 forever when download is actively progressing.
        prev_bytes = existing_bytes
        prev_t = time.monotonic()
        while not download_fut.done():
            await asyncio.sleep(2.0)
            try:
                downloaded = sum(
                    f.stat().st_size for f in download_dir.rglob("*") if f.is_file()
                ) if download_dir.exists() else existing_bytes
                job.downloaded_bytes = downloaded
                if job.total_bytes > 0:
                    job.progress = min(downloaded / job.total_bytes, 0.99)
                now = time.monotonic()
                dt = now - prev_t
                speed = max(downloaded - prev_bytes, 0) / dt if dt > 0 else 0
                prev_bytes = downloaded
                prev_t = now
                job.message = (
                    f"Downloading… {_fmt_bytes(downloaded)} / {_fmt_bytes(job.total_bytes)} "
                    f"({_fmt_bytes(speed)}/s)"
                )
            except Exception:
                pass

        await download_fut

        # Atomic swap for replacement downloads. os.rename within the same
        # filesystem is atomic on POSIX, so there's no window where the model
        # is partially visible. Failures up to this point left the existing
        # model untouched; failures here are rare (rename on same fs) but if
        # they occur, the staging dir is left in place so nothing is lost.
        if job.replace_model_id:
            try:
                backup_dir: Optional[Path] = None
                if final_dir.exists():
                    backup_dir = dest / f"{Path(job.repo_id).name}.old-{job.job_id}"
                    final_dir.rename(backup_dir)
                download_dir.rename(final_dir)
                job.local_dir = str(final_dir)
                if backup_dir and backup_dir.exists():
                    shutil.rmtree(backup_dir, ignore_errors=True)
                # Refresh registry so the replaced model picks up the new
                # mtime / size without a manual /api/models/refresh.
                registry = getattr(self, "_registry", None)
                if registry is not None:
                    asyncio.create_task(registry.refresh())
            except Exception as e:
                job.error = f"swap failed: {e}"
                raise

    async def stream_job(self, job_id: str) -> AsyncGenerator[dict, None]:
        while True:
            job = self._jobs.get(job_id)
            if not job:
                yield {"event": "error", "message": f"Job {job_id} not found"}
                return
            yield {"event": "progress", **self._job_dict(job)}
            if job.status in ("done", "error", "cancelled"):
                yield {"event": job.status, **self._job_dict(job)}
                return
            await asyncio.sleep(1.0)


def _fmt_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


# Singleton
download_manager = DownloadManager()
