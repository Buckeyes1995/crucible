"""OpenAI SDK drop-in compatibility smoke test.

Run against a live Crucible instance with a loaded model. Exits non-zero on any
failure so it can be wired into a precommit or CI later.

Usage:
    cd backend && .venv/bin/python -m tests.test_openai_compat
Env:
    CRUCIBLE_BASE  — Crucible proxy base (default http://localhost:7777/v1)
    CRUCIBLE_KEY   — bearer token if you've set one (default 'none')
"""
from __future__ import annotations

import os
import sys
import time

try:
    from openai import OpenAI
except ImportError:
    print("install openai first: .venv/bin/pip install openai", file=sys.stderr)
    sys.exit(2)


BASE = os.environ.get("CRUCIBLE_BASE", "http://localhost:7777/v1")
KEY = os.environ.get("CRUCIBLE_KEY", "none")

client = OpenAI(base_url=BASE, api_key=KEY)

passed = 0
failed = 0


def check(label: str, cond: bool, extra: str = ""):
    global passed, failed
    mark = "✓" if cond else "✗"
    print(f"  {mark} {label}{('  — ' + extra) if extra else ''}")
    if cond:
        passed += 1
    else:
        failed += 1


def _ensure_model() -> str:
    models = client.models.list()
    if not models.data:
        print("No models available — load one in Crucible first.", file=sys.stderr)
        sys.exit(2)
    return models.data[0].id


def test_models_list():
    print("\n[models.list]")
    ml = client.models.list()
    check("returns objects with id + object", all(m.id and m.object == "model" for m in ml.data))
    check("at least one model", len(ml.data) >= 1, f"{len(ml.data)} models")


def test_chat_completion_nonstream(model: str):
    print("\n[chat.completions — non-streaming]")
    t0 = time.monotonic()
    r = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": "Reply with only the word OK"}],
        max_tokens=16,
        temperature=0.0,
    )
    elapsed = time.monotonic() - t0
    check("has one choice", len(r.choices) == 1)
    msg = r.choices[0].message
    check("choice.message.role == assistant", msg.role == "assistant")
    check("choice.message.content is a string", isinstance(msg.content, str) and len(msg.content) > 0)
    check("finish_reason set", r.choices[0].finish_reason is not None)
    check("usage.total_tokens set", r.usage is not None and r.usage.total_tokens is not None, f"{elapsed:.2f}s")


def test_chat_completion_stream(model: str):
    print("\n[chat.completions — streaming]")
    stream = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": "count 1 to 3"}],
        max_tokens=40,
        temperature=0.0,
        stream=True,
    )
    chunk_count = 0
    content_parts: list[str] = []
    finish = None
    for chunk in stream:
        chunk_count += 1
        if chunk.choices:
            delta = chunk.choices[0].delta
            if delta.content:
                content_parts.append(delta.content)
            if chunk.choices[0].finish_reason:
                finish = chunk.choices[0].finish_reason
    check("received > 1 chunk", chunk_count > 1, f"{chunk_count} chunks")
    check("collected content", len("".join(content_parts)) > 0)
    check("finish_reason on last chunk", finish is not None)


def test_chat_multiturn(model: str):
    print("\n[chat.completions — multi-turn context]")
    r = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "user", "content": "My favorite color is purple."},
            {"role": "assistant", "content": "Got it — purple."},
            {"role": "user", "content": "What's my favorite color? Answer in one word."},
        ],
        max_tokens=16,
        temperature=0.0,
    )
    txt = (r.choices[0].message.content or "").lower()
    check("response mentions 'purple'", "purple" in txt, txt[:40])


def test_system_prompt(model: str):
    print("\n[chat.completions — system prompt]")
    r = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "Reply in all caps regardless of the question."},
            {"role": "user", "content": "hello"},
        ],
        max_tokens=16,
        temperature=0.0,
    )
    txt = r.choices[0].message.content or ""
    check("system prompt had some effect", txt.strip() == txt.strip().upper() or len(txt) > 0, txt[:40])


def main():
    print(f"Crucible OpenAI-compat smoke test — base={BASE}")
    test_models_list()
    model = _ensure_model()
    print(f"  using model: {model}")
    test_chat_completion_nonstream(model)
    test_chat_completion_stream(model)
    test_chat_multiturn(model)
    test_system_prompt(model)
    total = passed + failed
    print(f"\n{'✓' if failed == 0 else '✗'} {passed}/{total} checks passed")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
