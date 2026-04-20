"""Git-context helpers — pull git status / diff / log for a user-specified
repo so the chat / workflow layer can feed them to a model as context."""
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any


def _run(args: list[str], cwd: Path, timeout: float = 5.0) -> str:
    try:
        r = subprocess.run(
            args, cwd=str(cwd), capture_output=True, text=True,
            timeout=timeout, check=False,
        )
        return (r.stdout or "") + (r.stderr or "")
    except Exception as e:
        return f"(git command failed: {e})"


def context(repo_path: str, max_diff_lines: int = 400) -> dict[str, Any]:
    """Return a bundle useful for commit-message / PR-description prompts:
    branch, status, staged/unstaged diff, last few commits. Never raises;
    on error the fields come back as error strings so the caller can still
    render something."""
    p = Path(repo_path).expanduser()
    if not p.exists():
        return {"error": f"path does not exist: {p}"}
    if not (p / ".git").exists():
        return {"error": f"not a git repo: {p}"}

    branch = _run(["git", "rev-parse", "--abbrev-ref", "HEAD"], p).strip()
    status = _run(["git", "status", "--short"], p)
    diff = _run(["git", "diff", "--stat", "HEAD"], p)
    diff_unstaged = _run(["git", "diff"], p, timeout=10.0)
    diff_staged = _run(["git", "diff", "--cached"], p, timeout=10.0)
    log = _run(["git", "log", "--oneline", "-n", "10"], p)

    def _clip(text: str, n: int) -> str:
        lines = text.splitlines()
        if len(lines) <= n:
            return text
        return "\n".join(lines[:n]) + f"\n… [truncated {len(lines) - n} more lines]"

    return {
        "path": str(p),
        "branch": branch,
        "status": status,
        "diff_stat": diff,
        "diff_unstaged": _clip(diff_unstaged, max_diff_lines),
        "diff_staged": _clip(diff_staged, max_diff_lines),
        "log": log,
    }
