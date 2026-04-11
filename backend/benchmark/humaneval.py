"""HumanEval benchmark executor.

Runs the 164 OpenAI HumanEval problems against the active model.
Each problem: model completes a Python function, output is executed
against the problem's unit tests in a sandboxed subprocess.

pass@1 = fraction of problems the model solves on the first attempt.
"""
import asyncio
import logging
import re
import sys
import time
import uuid
from dataclasses import dataclass, field
from typing import AsyncGenerator

from benchmark.humaneval_data import HUMANEVAL_PROBLEMS

log = logging.getLogger(__name__)

# Broad categories inferred from task_id numbering (HumanEval/0 .. /163)
# Hand-labeled groupings matching common analyses of the dataset
CATEGORIES: dict[int, str] = {
    **{i: "Strings" for i in [1, 2, 5, 6, 7, 8, 9, 10, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 25, 26, 54, 55, 58, 59, 61, 67, 74, 76, 82, 83, 84, 86, 90, 91, 93, 95, 96, 99, 108, 110, 112, 114, 119, 121, 122, 125, 130, 132, 140, 141, 143, 145, 148, 154, 159, 163]},
    **{i: "Math" for i in [0, 3, 4, 11, 23, 24, 31, 33, 34, 37, 38, 39, 40, 43, 44, 46, 47, 48, 49, 50, 51, 52, 53, 56, 57, 60, 62, 63, 64, 65, 66, 68, 69, 70, 71, 72, 73, 77, 78, 79, 80, 81, 85, 87, 88, 89, 92, 94, 97, 98, 102, 103, 104, 105, 106, 107, 118, 120, 123, 124, 126, 127, 128, 133, 134, 135, 136, 137, 138, 139, 142, 144, 147, 149, 150, 151, 152, 153, 155, 156, 157, 158, 160, 161, 162]},
    **{i: "Algorithms" for i in [27, 28, 29, 30, 32, 35, 36, 41, 42, 45, 75, 100, 101, 109, 111, 113, 115, 116, 117, 129, 131, 146]},
    **{i: "Data Structures" for i in [12, 53, 146]},
}


def get_category(task_id: str) -> str:
    try:
        idx = int(task_id.split("/")[1])
        return CATEGORIES.get(idx, "Algorithms")
    except Exception:
        return "Algorithms"


def extract_completion(prompt: str, raw: str) -> str:
    """Extract a clean, complete function definition from model output.

    The model is asked to write the full function. We:
    1. Strip <think> blocks
    2. Extract from markdown fence if present
    3. Find the def line and return from there onward
    4. Fallback: return cleaned raw output
    """
    # 1. Strip Qwen3 thinking blocks
    raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()

    # 2. Prefer code inside a markdown fence
    fence_match = re.search(r"```(?:python)?\n?(.*?)```", raw, re.DOTALL)
    if fence_match:
        raw = fence_match.group(1).strip()
    else:
        raw = re.sub(r"```(?:python)?", "", raw).replace("```", "").strip()

    # 3. Find the first `def` line — start from there
    lines = raw.splitlines()
    for i, line in enumerate(lines):
        if re.match(r"^def \w+", line):
            return "\n".join(lines[i:])

    # 4. Fallback: return as-is
    return raw


def is_code_complete(code: str) -> tuple[bool, str]:
    """Check if code is syntactically complete. Returns (ok, error_msg)."""
    try:
        compile(code, "<string>", "exec")
        return True, ""
    except SyntaxError as e:
        return False, str(e)


def fix_truncated_code(code: str) -> str:
    """Best-effort repair of truncated code before sandbox execution."""
    ok, _ = is_code_complete(code)
    if ok:
        return code

    # Close unterminated triple-quoted strings
    for q in ('"""', "'''"):
        if code.count(q) % 2 == 1:
            code = code.rstrip() + f'\n    {q}\n'
            break

    # If last line is incomplete (no colon at end of def/if/for, or dangling operator)
    lines = code.rstrip().splitlines()
    if lines:
        last = lines[-1].rstrip()
        # Dangling: line ends with operator, open bracket, or keyword
        if last and last[-1] in "([{,\\":
            code = code.rstrip() + "\n        pass\n"

    return code


async def run_in_sandbox(code: str, timeout: float = 10.0) -> tuple[bool, str]:
    """Execute code in a subprocess sandbox. Returns (passed, stderr)."""
    try:
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-c", code,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            passed = proc.returncode == 0
            err = stderr.decode(errors="replace").strip()
            return passed, err
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except Exception:
                pass
            return False, "Timed out"
    except Exception as e:
        return False, str(e)


FAIL_REASONS = {
    "syntax":    "SyntaxError",       # code didn't parse — extraction/truncation bug
    "truncated": "Truncated",         # model output cut off mid-code
    "assertion": "AssertionError",    # code ran but got wrong answer — legitimate fail
    "timeout":   "Timeout",           # code timed out (infinite loop, etc.)
    "runtime":   "RuntimeError",      # other runtime error (NameError, TypeError, etc.)
    "adapter":   "AdapterError",      # model inference failed
}


def classify_failure(error: str, completion: str) -> str:
    """Classify why a problem failed."""
    if not error:
        return "assertion"
    e = error.lower()
    if "timed out" in e:
        return "timeout"
    if "syntaxerror" in e:
        # Check if it looks like truncation
        last_lines = completion.strip().splitlines()
        last = last_lines[-1].strip() if last_lines else ""
        if last and last[-1] in "([{,\\" or not last.endswith((":", ")", "]", "}")):
            return "truncated"
        return "syntax"
    if "assertionerror" in e:
        return "assertion"
    if any(x in e for x in ("nameerror", "typeerror", "valueerror", "attributeerror", "runtimeerror", "indexerror")):
        return "runtime"
    if "adapter" in e:
        return "adapter"
    return "runtime"


@dataclass
class ProblemResult:
    task_id: str
    entry_point: str
    category: str
    passed: bool
    error: str
    fail_reason: str   # "" if passed, else one of FAIL_REASONS keys
    completion: str
    prompt_tokens: int
    elapsed_ms: int


@dataclass
class HumanEvalRun:
    run_id: str
    model_id: str
    started_at: float = field(default_factory=time.monotonic)
    results: list[ProblemResult] = field(default_factory=list)
    status: str = "running"  # running | done | error
    error: str = ""

    @property
    def total(self) -> int:
        return len(HUMANEVAL_PROBLEMS)

    @property
    def completed(self) -> int:
        return len(self.results)

    @property
    def passed(self) -> int:
        return sum(1 for r in self.results if r.passed)

    @property
    def pass_at_1(self) -> float:
        if not self.results:
            return 0.0
        return self.passed / len(self.results)

    def summary(self) -> dict:
        by_cat: dict[str, dict] = {}
        by_fail: dict[str, int] = {}
        for r in self.results:
            cat = r.category
            if cat not in by_cat:
                by_cat[cat] = {"passed": 0, "total": 0}
            by_cat[cat]["total"] += 1
            if r.passed:
                by_cat[cat]["passed"] += 1
            elif r.fail_reason:
                by_fail[r.fail_reason] = by_fail.get(r.fail_reason, 0) + 1

        infra_fails = sum(by_fail.get(k, 0) for k in ("syntax", "truncated", "adapter"))
        legit_fails = sum(by_fail.get(k, 0) for k in ("assertion", "runtime", "timeout"))

        return {
            "run_id": self.run_id,
            "model_id": self.model_id,
            "total": self.total,
            "completed": self.completed,
            "passed": self.passed,
            "pass_at_1": round(self.pass_at_1, 4),
            "elapsed_s": round(time.monotonic() - self.started_at, 1),
            "by_category": by_cat,
            "by_fail_reason": by_fail,
            "infra_fails": infra_fails,
            "legit_fails": legit_fails,
            "status": self.status,
            "error": self.error,
        }


# In-memory store of recent runs
_runs: dict[str, HumanEvalRun] = {}


def get_run(run_id: str) -> HumanEvalRun | None:
    return _runs.get(run_id)


def list_runs() -> list[dict]:
    return [r.summary() for r in sorted(_runs.values(), key=lambda x: -x.started_at)]


async def start_run(
    adapter,
    model_id: str,
    problem_ids: list[str] | None = None,
    temperature: float = 0.0,
    max_tokens: int = 512,
) -> str:
    run_id = str(uuid.uuid4())[:8]
    run = HumanEvalRun(run_id=run_id, model_id=model_id)
    _runs[run_id] = run

    problems = HUMANEVAL_PROBLEMS
    if problem_ids:
        problems = [p for p in problems if p["task_id"] in problem_ids]

    asyncio.create_task(_execute_run(run, adapter, problems, temperature, max_tokens))
    return run_id


async def _execute_run(
    run: HumanEvalRun,
    adapter,
    problems: list[dict],
    temperature: float,
    max_tokens: int,
) -> None:
    from models.schemas import ChatMessage
    try:
        for problem in problems:
            t0 = time.monotonic()
            prompt = problem["prompt"]
            entry_point = problem["entry_point"]
            task_id = problem["task_id"]
            category = get_category(task_id)

            # Build the chat message
            system = (
                "You are an expert Python programmer. "
                "Write a complete, working Python function implementation. "
                "Output ONLY the function — starting with 'def'. "
                "No explanation, no markdown, no example usage, no test code. "
                "Do not add a docstring. Just the def line and body."
            )
            user_msg = (
                f"Implement this Python function:\n\n{prompt}\n\n"
                f"Write only the complete `def {entry_point}(...)` function."
            )

            # Collect completion from adapter
            completion_tokens = []
            try:
                async for chunk in adapter.chat(
                    messages=[
                        ChatMessage(role="system", content=system),
                        ChatMessage(role="user", content=user_msg),
                    ],
                    temperature=temperature,
                    max_tokens=max_tokens,
                ):
                    if chunk.get("token"):
                        completion_tokens.append(chunk["token"])
                    if chunk.get("done"):
                        break
            except Exception as e:
                err = f"Adapter error: {e}"
                run.results.append(ProblemResult(
                    task_id=task_id, entry_point=entry_point, category=category,
                    passed=False, error=err, fail_reason="adapter", completion="",
                    prompt_tokens=len(prompt.split()), elapsed_ms=int((time.monotonic() - t0) * 1000),
                ))
                continue

            raw_completion = "".join(completion_tokens)
            func_code = extract_completion(prompt, raw_completion)

            # Extract imports and helper functions from the prompt preamble.
            # Some problems define helpers before the target function
            # (e.g. is_palindrome before make_palindrome). We must include
            # them or the model's code will get NameError when calling them.
            preamble_lines: list[str] = []
            helper_lines: list[str] = []
            in_helper = False
            for line in prompt.splitlines():
                # Stop when we reach the target function
                if re.match(rf"^def {re.escape(entry_point)}\s*\(", line):
                    break
                if line.startswith("from ") or line.startswith("import "):
                    preamble_lines.append(line)
                    in_helper = False
                elif re.match(r"^def \w+", line):
                    in_helper = True
                    helper_lines.append(line)
                elif in_helper:
                    helper_lines.append(line)

            # Also capture imports the model wrote before its def line.
            # extract_completion() strips these when it starts from the def,
            # so we recover them here from the cleaned raw output.
            cleaned_raw = re.sub(r"<think>.*?</think>", "", raw_completion, flags=re.DOTALL).strip()
            fence_match = re.search(r"```(?:python)?\n?(.*?)```", cleaned_raw, re.DOTALL)
            cleaned_raw = fence_match.group(1).strip() if fence_match else cleaned_raw
            model_import_lines: list[str] = []
            for line in cleaned_raw.splitlines():
                if re.match(r"^def \w+", line):
                    break
                if line.startswith("from ") or line.startswith("import "):
                    model_import_lines.append(line)

            # Merge prompt imports + model imports (dedup, prompt first)
            seen_imports: set[str] = set(preamble_lines)
            for imp in model_import_lines:
                if imp not in seen_imports:
                    preamble_lines.append(imp)
                    seen_imports.add(imp)

            preamble = "\n".join(preamble_lines)
            helpers = "\n".join(helper_lines).strip()

            # Build: imports + helpers + complete function + test harness
            # Do NOT include the original prompt — avoids open-docstring issues
            code = (
                (preamble + "\n\n" if preamble else "")
                + (helpers + "\n\n" if helpers else "")
                + func_code
                + "\n\n"
                + problem["test"]
                + f"\n\ncheck({entry_point})\n"
            )
            code = fix_truncated_code(code)

            passed, error = await run_in_sandbox(code)
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            fail_reason = "" if passed else classify_failure(error, func_code)

            run.results.append(ProblemResult(
                task_id=task_id,
                entry_point=entry_point,
                category=category,
                passed=passed,
                error=error[:600] if error else "",
                fail_reason=fail_reason,
                completion=raw_completion[:1000],
                prompt_tokens=len(prompt.split()),
                elapsed_ms=elapsed_ms,
            ))

            log.info("HumanEval %s: %s (%dms)", task_id, "PASS" if passed else "FAIL", elapsed_ms)

        run.status = "done"
    except Exception as e:
        run.status = "error"
        run.error = str(e)
        log.exception("HumanEval run %s failed", run.run_id)


async def stream_run(run_id: str) -> AsyncGenerator[dict, None]:
    """Stream progress events until the run is done."""
    run = _runs.get(run_id)
    if not run:
        yield {"event": "error", "message": f"Run {run_id} not found"}
        return

    seen = 0
    while True:
        # Emit any new results
        current = run.results
        for r in current[seen:]:
            yield {
                "event": "result",
                "task_id": r.task_id,
                "entry_point": r.entry_point,
                "category": r.category,
                "passed": r.passed,
                "fail_reason": r.fail_reason,
                "error": r.error,
                "elapsed_ms": r.elapsed_ms,
                "completed": run.completed,
                "total": run.total,
                "passed_count": run.passed,
            }
        seen = len(current)

        if run.status in ("done", "error"):
            yield {"event": "done", **run.summary()}
            return

        await asyncio.sleep(0.5)
