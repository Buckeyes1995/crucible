"""Agent runner (Roadmap v4 #1) — a ReAct loop that asks the active local
model to pick MCP tools, execute them, observe results, and iterate until
it produces a final answer or a budget runs out.

Why ReAct instead of OpenAI tool-use API? Small local models don't emit
tool_calls reliably. A hand-rolled JSON protocol on top of instruct
prompting works across every Qwen/Llama/Mistral variant.

Protocol the model follows (spec embedded in the system prompt):

  {"thought": "...", "tool": "<name>", "args": {...}}      # take an action
  {"thought": "...", "final": "the user-facing answer"}    # finish

Anything else is treated as a final plain-text answer (graceful fallback
for models that drift). Each event goes to the DB and out via SSE.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Optional

import aiosqlite
import httpx

from db.database import DB_PATH

log = logging.getLogger(__name__)

PROXY_URL = "http://127.0.0.1:7777/v1/chat/completions"

SYSTEM_PROMPT_TEMPLATE = """You are an autonomous agent. Solve the user's GOAL step-by-step using the available TOOLS.

Respond with EXACTLY ONE json object per turn and nothing else. Two shapes:

To take an action:
{"thought": "<one short sentence about what you're about to do>", "tool": "<tool_name>", "args": {<args>}}

To finish:
{"thought": "<short wrap-up>", "final": "<the answer for the user>"}

Rules:
- The tool name must match one from TOOLS EXACTLY (e.g. "fs.read_file", not "read_file").
- Emit ONE json object, no prose before or after, no code fences.
- If a tool errors, read the error and try a corrected call — don't repeat the same failure.
- When you have enough information, emit the "final" form.
- Keep thoughts short. Never invent tool names or tools not in TOOLS.

TOOLS:
{tool_catalog}

GOAL:
{goal}
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── DB helpers ──────────────────────────────────────────────────────────────

async def _insert_run(run: dict) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO agent_runs
               (id, goal, model_id, project_id, status, tool_allowlist_json,
                max_steps, max_tokens, created_at)
               VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?)""",
            (
                run["id"], run["goal"], run.get("model_id"), run.get("project_id"),
                json.dumps(run.get("tool_allowlist")) if run.get("tool_allowlist") else None,
                run.get("max_steps", 12), run.get("max_tokens", 2048),
                run["created_at"],
            ),
        )
        await db.commit()


async def _append_step(run_id: str, step_index: int, kind: str,
                        name: Optional[str] = None,
                        input_obj: Any = None, output_obj: Any = None,
                        error: Optional[str] = None, tokens: int = 0) -> dict:
    started = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            """INSERT INTO agent_steps
               (run_id, step_index, kind, name, input_json, output_json, error, started_at, finished_at, tokens)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                run_id, step_index, kind, name,
                json.dumps(input_obj) if input_obj is not None else None,
                json.dumps(output_obj) if output_obj is not None else None,
                error, started, _now(), tokens,
            ),
        )
        await db.commit()
        step_id = cur.lastrowid
    return {
        "id": step_id, "run_id": run_id, "step_index": step_index, "kind": kind,
        "name": name, "input": input_obj, "output": output_obj, "error": error,
        "started_at": started, "tokens": tokens,
    }


async def _finish_run(run_id: str, status: str, final_answer: Optional[str] = None,
                       error: Optional[str] = None, total_tokens: int = 0,
                       elapsed_ms: float = 0.0) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """UPDATE agent_runs
               SET status = ?, final_answer = ?, error = ?,
                   total_tokens = ?, elapsed_ms = ?, finished_at = ?
               WHERE id = ?""",
            (status, final_answer, error, total_tokens, elapsed_ms, _now(), run_id),
        )
        await db.commit()


# ── Tool catalog ────────────────────────────────────────────────────────────
# We compose the catalog string from every installed MCP's tools. Tool names
# are namespaced `<mcp_id>.<tool_name>` to avoid collisions and so the runner
# can route the call to the right server.

async def _build_tool_catalog(allowlist: Optional[list[str]]) -> tuple[str, dict[str, tuple[str, dict]]]:
    """Returns (human-readable catalog string, dispatch map: qualified_name →
    (mcp_id, tool_schema))."""
    import mcps as mcps_mod
    import mcp_host

    installed = mcps_mod.list_installed()
    if allowlist is not None:
        installed = [m for m in installed if m.get("id") in allowlist]

    lines: list[str] = []
    dispatch: dict[str, tuple[str, dict]] = {}
    for m in installed:
        mcp_id = m["id"]
        try:
            tools = await mcp_host.list_tools(mcp_id)
        except Exception as e:
            log.warning("agent_runner: couldn't list tools for %s (%s)", mcp_id, e)
            continue
        for t in tools:
            qname = f"{mcp_id}.{t['name']}"
            dispatch[qname] = (mcp_id, t)
            desc = (t.get("description") or "").strip()
            lines.append(f"- {qname}: {desc[:160]}")
    if not lines:
        lines.append("(none available — no MCPs installed or allowed)")
    return "\n".join(lines), dispatch


# ── Model call ─────────────────────────────────────────────────────────────

async def _call_model(messages: list[dict], model_id: Optional[str]) -> tuple[str, int]:
    """One round-trip to the OpenAI-compat proxy. Returns (content, output_tokens)."""
    payload = {
        "model": (model_id or "auto").replace("mlx:", ""),
        "messages": messages,
        "max_tokens": 512,
        "temperature": 0.2,
        "stream": False,
        # Thinking output burns budget before the JSON we need — suppress.
        "chat_template_kwargs": {"enable_thinking": False},
    }
    async with httpx.AsyncClient(timeout=300.0) as client:
        r = await client.post(PROXY_URL, json=payload)
        r.raise_for_status()
        data = r.json()
    content = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
    output_tokens = int((data.get("usage") or {}).get("completion_tokens") or 0)
    return content, output_tokens


# ── JSON extraction ────────────────────────────────────────────────────────

def _extract_json_obj(text: str) -> Optional[dict]:
    """Pull the first {...} out of a model response, tolerating fences + prose."""
    m = re.search(r"```(?:json)?\s*({[\s\S]*?})\s*```", text)
    raw = m.group(1) if m else None
    if not raw:
        m = re.search(r"{[\s\S]*}", text)
        raw = m.group(0) if m else None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


# ── Main loop ───────────────────────────────────────────────────────────────

async def run(goal: str, *, model_id: Optional[str] = None,
              tool_allowlist: Optional[list[str]] = None,
              max_steps: int = 12, max_tokens: int = 2048,
              project_id: Optional[str] = None) -> AsyncIterator[dict]:
    """Drive the ReAct loop; yield one event per observable step.

    Event shapes (all have {"event": "<kind>", ...}):
      run_started {run_id}
      step {step_index, kind, name?, input?, output?, error?}
      run_finished {status, final_answer?, error?, total_tokens, elapsed_ms}
    """
    run_id = uuid.uuid4().hex[:12]
    created_at = _now()
    t0 = time.monotonic()
    total_tokens = 0

    await _insert_run({
        "id": run_id, "goal": goal, "model_id": model_id,
        "project_id": project_id, "tool_allowlist": tool_allowlist,
        "max_steps": max_steps, "max_tokens": max_tokens,
        "created_at": created_at,
    })
    yield {"event": "run_started", "run_id": run_id, "created_at": created_at}

    catalog, dispatch = await _build_tool_catalog(tool_allowlist)
    sysprompt = SYSTEM_PROMPT_TEMPLATE.format(goal=goal, tool_catalog=catalog)

    transcript: list[dict] = [{"role": "system", "content": sysprompt}]
    # Seed the first turn with a user nudge so the model actually replies.
    transcript.append({"role": "user", "content": "Begin. Respond with the first JSON action or your final answer."})

    step_index = 0
    final_answer: Optional[str] = None
    error: Optional[str] = None
    status = "running"

    for _ in range(max_steps):
        if total_tokens > max_tokens:
            error = f"max_tokens budget exceeded ({total_tokens} > {max_tokens})"
            status = "error"
            break
        try:
            content, out_toks = await _call_model(transcript, model_id)
        except Exception as e:
            error = f"model call failed: {e}"
            status = "error"
            break
        total_tokens += out_toks

        parsed = _extract_json_obj(content)
        if not parsed:
            # Graceful fallback — treat free-form text as a final answer.
            step_index += 1
            step = await _append_step(run_id, step_index, "final",
                                       output_obj={"text": content.strip()},
                                       tokens=out_toks)
            yield {"event": "step", **step}
            final_answer = content.strip()
            status = "done"
            break

        if "final" in parsed:
            step_index += 1
            step = await _append_step(run_id, step_index, "final",
                                       input_obj={"thought": parsed.get("thought")},
                                       output_obj={"text": parsed.get("final")},
                                       tokens=out_toks)
            yield {"event": "step", **step}
            final_answer = str(parsed.get("final") or "")
            status = "done"
            break

        tool_name = parsed.get("tool")
        args = parsed.get("args") or {}
        thought = parsed.get("thought") or ""

        if not tool_name:
            # Model emitted something else — log as thought, nudge it.
            step_index += 1
            step = await _append_step(run_id, step_index, "thought",
                                       output_obj={"text": thought or content.strip()},
                                       tokens=out_toks)
            yield {"event": "step", **step}
            transcript.append({"role": "assistant", "content": content})
            transcript.append({"role": "user", "content": "Pick a tool from TOOLS or emit a final answer. Respond with ONE json object."})
            continue

        step_index += 1
        call_step = await _append_step(run_id, step_index, "tool_call",
                                        name=tool_name,
                                        input_obj={"thought": thought, "args": args},
                                        tokens=out_toks)
        yield {"event": "step", **call_step}
        transcript.append({"role": "assistant", "content": content})

        # Dispatch
        if tool_name not in dispatch:
            err = f"unknown tool {tool_name!r}; allowed: {list(dispatch)[:20]}"
            step_index += 1
            rs = await _append_step(run_id, step_index, "tool_result",
                                     name=tool_name, error=err)
            yield {"event": "step", **rs}
            transcript.append({"role": "user", "content": f"Tool {tool_name} failed: {err}. Pick a valid tool or emit final."})
            continue

        mcp_id, _tool_schema = dispatch[tool_name]
        bare_name = tool_name.split(".", 1)[1]
        try:
            import mcp_host
            result = await mcp_host.call_tool(mcp_id, bare_name, args)
            output = result.get("result") or result
        except Exception as e:
            err = str(e)
            step_index += 1
            rs = await _append_step(run_id, step_index, "tool_result",
                                     name=tool_name, error=err)
            yield {"event": "step", **rs}
            transcript.append({"role": "user", "content": f"Tool {tool_name} errored: {err}. Try a different approach or emit final."})
            continue

        # Serialize result for the trace and the transcript. Trim for the model.
        result_text = json.dumps(output, default=str)[:2000]
        step_index += 1
        rs = await _append_step(run_id, step_index, "tool_result",
                                 name=tool_name, output_obj=output)
        yield {"event": "step", **rs}
        transcript.append({"role": "user", "content": f"Result of {tool_name}: {result_text}"})
    else:
        # for/else — loop exhausted without break
        error = f"max_steps reached ({max_steps}) without final answer"
        status = "error"

    elapsed_ms = (time.monotonic() - t0) * 1000
    await _finish_run(run_id, status, final_answer=final_answer, error=error,
                       total_tokens=total_tokens, elapsed_ms=elapsed_ms)
    yield {
        "event": "run_finished",
        "status": status, "final_answer": final_answer, "error": error,
        "total_tokens": total_tokens, "elapsed_ms": elapsed_ms,
    }


# ── Queries ─────────────────────────────────────────────────────────────────

async def list_runs(limit: int = 50, project_id: Optional[str] = None) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        if project_id == "__none__":
            q = "SELECT * FROM agent_runs WHERE project_id IS NULL ORDER BY datetime(created_at) DESC LIMIT ?"
            args: tuple = (limit,)
        elif project_id:
            q = "SELECT * FROM agent_runs WHERE project_id = ? ORDER BY datetime(created_at) DESC LIMIT ?"
            args = (project_id, limit)
        else:
            q = "SELECT * FROM agent_runs ORDER BY datetime(created_at) DESC LIMIT ?"
            args = (limit,)
        async with db.execute(q, args) as cur:
            rows = [dict(r) async for r in cur]
    return rows


async def get_run(run_id: str) -> Optional[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM agent_runs WHERE id = ?", (run_id,)) as cur:
            row = await cur.fetchone()
        if not row:
            return None
        async with db.execute(
            "SELECT * FROM agent_steps WHERE run_id = ? ORDER BY step_index", (run_id,),
        ) as cur:
            steps_raw = [dict(r) async for r in cur]
    def _decode(s: dict) -> dict:
        out = dict(s)
        for k in ("input_json", "output_json"):
            if out.get(k):
                try:
                    out[k.replace("_json", "")] = json.loads(out[k])
                except Exception:
                    out[k.replace("_json", "")] = out[k]
            out.pop(k, None)
        return out
    return {**dict(row), "steps": [_decode(s) for s in steps_raw]}


async def delete_run(run_id: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        cur = await db.execute("DELETE FROM agent_runs WHERE id = ?", (run_id,))
        await db.commit()
        return (cur.rowcount or 0) > 0
