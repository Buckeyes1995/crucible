"""Reddit LLM-channel watcher — scan configured subreddits, generate draft
replies to promising posts via the active Crucible model, store drafts for
user approval. Never auto-posts.

This module ships as a scaffold: the config, storage, draft-generation, and
CRUD are in place. Live Reddit polling requires OAuth2 creds (client id +
secret + user-agent) which the user must configure in Settings. Until creds
exist, the watcher stays idle; the UI surfaces that state.
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger(__name__)

CONFIG_FILE = Path.home() / ".config" / "crucible" / "reddit_watcher.json"
DRAFTS_FILE = Path.home() / ".config" / "crucible" / "reddit_drafts.json"

DEFAULT_CONFIG: dict[str, Any] = {
    "enabled": False,
    "client_id": "",
    "client_secret": "",
    "user_agent": "crucible/1.0 by your-reddit-username",
    "subreddits": ["LocalLLaMA", "LocalLLM", "MachineLearning"],
    # Only consider posts shorter than this (avoid giant walls of text).
    "max_post_chars": 4000,
    # Skip posts older than N hours — no point drafting replies to dead threads.
    "max_post_age_hours": 12,
    # Minimum upvotes to even consider a post worth engaging with.
    "min_score": 3,
    # System prompt the drafter sees — editable by the user. The default is
    # tuned for "technical niche sub where readers fact-check" and pushes the
    # model toward hedged / experience-based framing rather than confident
    # assertions about projects or APIs (which it'll get wrong).
    "draft_system_prompt": (
        "You are drafting a reply on a technical LLM / AI / ML subreddit where "
        "readers fact-check harshly. Rules:\n"
        "- Prefer hedged framing ('I think', 'in my experience', 'as of [date]') "
        "over confident assertions.\n"
        "- Do NOT make specific factual claims about projects, features, APIs, "
        "or version numbers unless you are certain they are accurate. Readers "
        "will check and downvote.\n"
        "- When in doubt, ask a clarifying question or share a first-person "
        "observation instead of making a claim.\n"
        "- No flattery, no 'hope this helps', no meta-commentary about the "
        "reply itself.\n"
        "- Keep it under 150 words.\n"
        "- Output ONLY the reply text — no 'thinking process' preamble."
    ),
    # Per-subreddit free-text dossier. When drafting a reply to a post from
    # one of these subs, the matching dossier is prepended to the system
    # prompt so the model gets community-specific hot-button context it
    # wouldn't otherwise know.
    "subreddit_dossiers": {
        "LocalLLaMA": (
            "r/LocalLLaMA is the biggest local-LLM community. Hot-button facts:\n"
            "- llama.cpp ships llama-server in-tree — it's NOT 'just a library'.\n"
            "- Ollama is controversial for perceived fork-and-rebrand behavior "
            "but has dropdown mindshare. Do NOT defend it reflexively.\n"
            "- MLX is Apple-only; vLLM is effectively Cuda-only.\n"
            "- Users here fact-check harder than almost any other LLM sub. "
            "When unsure, hedge or don't make the claim."
        ),
    },
    "auto_draft_on_scan": True,
    # When true, every fresh draft gets a second pass through the model that
    # identifies shaky claims. Flags are stored on the draft and shown in UI.
    "critique_drafts": True,
}


def load_config() -> dict[str, Any]:
    if not CONFIG_FILE.exists():
        save_config(DEFAULT_CONFIG.copy())
        return DEFAULT_CONFIG.copy()
    try:
        cfg = json.loads(CONFIG_FILE.read_text())
        # Fill in any new defaults that didn't exist when the file was last saved.
        merged = {**DEFAULT_CONFIG, **cfg}
        return merged
    except Exception as e:
        log.warning("reddit_watcher: bad config (%s), using defaults", e)
        return DEFAULT_CONFIG.copy()


def save_config(cfg: dict[str, Any]) -> None:
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2))


def _load_drafts() -> list[dict]:
    if not DRAFTS_FILE.exists():
        return []
    try:
        return json.loads(DRAFTS_FILE.read_text())
    except Exception:
        return []


def _save_drafts(drafts: list[dict]) -> None:
    DRAFTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    DRAFTS_FILE.write_text(json.dumps(drafts, indent=2))


def list_drafts(status: Optional[str] = None) -> list[dict]:
    """Return drafts sorted newest-first. Status filters: 'pending', 'approved',
    'rejected', 'posted'. Omit to return all."""
    rows = _load_drafts()
    if status:
        rows = [d for d in rows if d.get("status") == status]
    return sorted(rows, key=lambda d: -d.get("created_at", 0))


def add_draft(post: dict, draft_text: str, model_id: Optional[str],
              critique: Optional[list[dict]] = None) -> dict:
    drafts = _load_drafts()
    entry = {
        "id": uuid.uuid4().hex[:12],
        "post_id": post.get("id"),
        "post_permalink": post.get("permalink"),
        "post_title": post.get("title"),
        "post_body": post.get("body", "")[:4000],
        "subreddit": post.get("subreddit"),
        "post_score": post.get("score"),
        "post_author": post.get("author"),
        "draft": draft_text,
        "model_id": model_id,
        "status": "pending",          # pending | approved | rejected | posted
        "critique": critique or [],   # [{claim, confidence, note}]
        "created_at": time.time(),
        "edited_at": None,
    }
    drafts.append(entry)
    _save_drafts(drafts)
    return entry


def update_draft(draft_id: str, **fields: Any) -> Optional[dict]:
    drafts = _load_drafts()
    for d in drafts:
        if d["id"] == draft_id:
            for k in ("draft", "status", "critique"):
                if k in fields:
                    d[k] = fields[k]
            d["edited_at"] = time.time()
            _save_drafts(drafts)
            return d
    return None


def get_draft(draft_id: str) -> Optional[dict]:
    for d in _load_drafts():
        if d["id"] == draft_id:
            return d
    return None


def delete_draft(draft_id: str) -> bool:
    drafts = _load_drafts()
    new = [d for d in drafts if d["id"] != draft_id]
    if len(new) == len(drafts):
        return False
    _save_drafts(new)
    return True


# ── Reddit API plumbing (stub) ─────────────────────────────────────────────

async def fetch_candidate_posts(cfg: dict[str, Any]) -> list[dict]:
    """Pull recent posts from each configured subreddit that pass the
    filters. Requires cfg['client_id'] + cfg['client_secret'] to be set;
    returns an empty list when creds are missing so callers can still
    exercise the rest of the pipeline.

    NOTE: this is the one place that actually talks to Reddit. Implemented
    against the public r/{sub}/new.json endpoint which doesn't require
    OAuth for read-only access — but we still expect a user_agent. For
    rate-limit resilience and per-user tracking, upgrade to OAuth later."""
    import httpx

    if not cfg.get("enabled"):
        return []
    ua = cfg.get("user_agent") or "crucible/1.0"
    headers = {"User-Agent": ua}
    cutoff = time.time() - (cfg.get("max_post_age_hours", 12) * 3600)
    posts: list[dict] = []
    async with httpx.AsyncClient(timeout=15.0, headers=headers) as client:
        for sub in cfg.get("subreddits", []):
            try:
                r = await client.get(f"https://www.reddit.com/r/{sub}/new.json?limit=25")
                r.raise_for_status()
                data = r.json()
                for child in data.get("data", {}).get("children", []):
                    d = child.get("data", {})
                    if d.get("created_utc", 0) < cutoff:
                        continue
                    if d.get("score", 0) < cfg.get("min_score", 0):
                        continue
                    body = d.get("selftext") or ""
                    if len(body) > cfg.get("max_post_chars", 4000):
                        continue
                    posts.append({
                        "id": d.get("id"),
                        "subreddit": d.get("subreddit"),
                        "title": d.get("title"),
                        "body": body,
                        "score": d.get("score"),
                        "author": d.get("author"),
                        "permalink": f"https://www.reddit.com{d.get('permalink','')}",
                        "created_utc": d.get("created_utc"),
                    })
            except Exception as e:
                log.warning("reddit_watcher: fetch r/%s failed (%s)", sub, e)
    return posts


def _build_system_prompt(cfg: dict[str, Any], subreddit: str) -> str:
    """Stack the per-sub dossier (if any) on top of the base system prompt.
    Dossier first so it sets the scene; base rules after so they anchor tone."""
    parts: list[str] = []
    dossiers = cfg.get("subreddit_dossiers") or {}
    # Case-insensitive dossier lookup so user-typed sub names still match.
    sub_lower = (subreddit or "").lower()
    for name, body in dossiers.items():
        if name.lower() == sub_lower and body.strip():
            parts.append("=== Context for r/" + name + " ===\n" + body.strip())
            break
    base = cfg.get("draft_system_prompt", "")
    if base.strip():
        parts.append(base.strip())
    return "\n\n".join(parts)


async def draft_reply(post: dict, cfg: dict[str, Any],
                      base_url: str, api_key: str, model_name: str) -> Optional[str]:
    """Ask the active Crucible MLX model to draft a reply to one post.
    Returns the draft text or None on failure."""
    import httpx

    system_prompt = _build_system_prompt(cfg, post.get("subreddit", ""))
    prompt = (
        f"Subreddit: r/{post.get('subreddit','?')}\n"
        f"Title: {post.get('title','')}\n\n"
        f"Body:\n{post.get('body','')}\n\n"
        f"Write a draft reply. Do not include any quoted excerpts of the post."
    )
    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.6,
        "max_tokens": 2048,   # Allow thinking models room to think; we strip below.
        "stream": False,
        # Disable thinking on models that honor it (Qwen3.x family etc.).
        "chat_template_kwargs": {"enable_thinking": False},
    }
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    try:
        async with httpx.AsyncClient(timeout=300.0, headers=headers) as client:
            r = await client.post(f"{base_url}/v1/chat/completions", json=payload)
            r.raise_for_status()
            data = r.json()
            return _strip_thinking_preamble(data["choices"][0]["message"]["content"])
    except Exception as e:
        log.warning("reddit_watcher: draft failed for %s (%s)", post.get("id"), e)
        return None


def _strip_thinking_preamble(text: str) -> str:
    """Remove the Qwen-style 'Here's a thinking process: 1. ...' preamble
    some models emit even when enable_thinking=false is requested. We keep
    everything AFTER the last numbered step (or after a separator line) if
    we detect the preamble, otherwise return the text as-is."""
    if not text:
        return ""
    s = text.strip()
    markers = [
        "here's a thinking process",
        "here is a thinking process",
        "<think>",
        "thinking process:",
    ]
    low = s.lower()
    if any(m in low[:200] for m in markers):
        # Try common separator patterns — '\n---\n', '\n\nDraft:', '\n\nReply:', '\n\n'.
        import re
        for pat in (r"\n---+\n", r"\nReply:\s*\n", r"\nDraft:\s*\n",
                    r"\n\s*Final (answer|reply|response):\s*\n"):
            m = re.split(pat, s, maxsplit=1, flags=re.IGNORECASE)
            if len(m) == 2 and len(m[1].strip()) > 20:
                return m[1].strip()
        # Fallback: drop everything before the last blank line if the text
        # is long enough that the preamble probably isn't the whole response.
        if "\n\n" in s and len(s) > 500:
            parts = s.rsplit("\n\n", 1)
            if len(parts[1].strip()) > 30:
                return parts[1].strip()
    return s


CRITIQUE_SYSTEM_PROMPT = (
    "You are a hostile, fact-checking reader on a technical LLM / AI subreddit. "
    "Your only job is to identify specific factual claims in a draft reply "
    "that would embarrass the author if wrong. Examples: claims about what a "
    "project ships, how an API works, version numbers, feature availability, "
    "performance numbers, exclusivity claims ('X is the only Y').\n\n"
    "Output ONLY a JSON array of objects. Each object has:\n"
    "  claim: the exact phrase from the draft\n"
    "  confidence: HIGH | MEDIUM | LOW\n"
    "    HIGH   = textbook fact, not going to be challenged\n"
    "    MEDIUM = probably true but worth double-checking\n"
    "    LOW    = sounds plausible but could easily be wrong\n"
    "  note: one short sentence explaining why the confidence level is what it is\n\n"
    "If there are no risky claims, output []. Output nothing outside the JSON array."
)


async def critique_draft(draft_text: str, cfg: dict[str, Any],
                          base_url: str, api_key: str, model_name: str) -> list[dict]:
    """Run the draft through a second pass to flag shaky factual claims.
    Returns a list of {claim, confidence, note} dicts. Empty list on failure —
    critique is advisory, never blocks a draft."""
    import httpx
    import json as _json

    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": CRITIQUE_SYSTEM_PROMPT},
            {"role": "user", "content":
             "Draft to critique:\n\n" + draft_text + "\n\nJSON array only."},
        ],
        "temperature": 0.0,
        "max_tokens": 2048,
        "stream": False,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    try:
        async with httpx.AsyncClient(timeout=180.0, headers=headers) as client:
            r = await client.post(f"{base_url}/v1/chat/completions", json=payload)
            r.raise_for_status()
            raw = r.json()["choices"][0]["message"]["content"]
    except Exception as e:
        log.warning("reddit_watcher: critique failed (%s)", e)
        return []
    # Models often wrap the JSON in prose or code fences. Extract the first
    # [...] block and try to parse it.
    import re
    m = re.search(r"\[[\s\S]*\]", raw)
    if not m:
        return []
    try:
        parsed = _json.loads(m.group(0))
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    out: list[dict] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        conf = (item.get("confidence") or "").upper()
        if conf not in ("HIGH", "MEDIUM", "LOW"):
            continue
        out.append({
            "claim": str(item.get("claim", ""))[:400],
            "confidence": conf,
            "note": str(item.get("note", ""))[:300],
        })
    return out


async def scan_and_draft(cfg: dict[str, Any], base_url: str, api_key: str,
                          model_name: Optional[str]) -> dict[str, Any]:
    """One scan pass: fetch posts, skip already-drafted ones, draft the rest.
    Returns counts so the UI can surface what happened."""
    if not cfg.get("enabled"):
        return {"enabled": False, "fetched": 0, "drafted": 0, "skipped_existing": 0}
    if not model_name:
        return {"enabled": True, "fetched": 0, "drafted": 0, "skipped_existing": 0,
                "error": "no active model to draft with"}
    posts = await fetch_candidate_posts(cfg)
    existing_ids = {d["post_id"] for d in _load_drafts()}
    drafted = 0
    skipped = 0
    for post in posts:
        if post["id"] in existing_ids:
            skipped += 1
            continue
        if not cfg.get("auto_draft_on_scan", True):
            continue
        text = await draft_reply(post, cfg, base_url, api_key, model_name)
        if text:
            flags: list[dict] = []
            if cfg.get("critique_drafts", True):
                try:
                    flags = await critique_draft(text, cfg, base_url, api_key, model_name)
                except Exception as e:
                    log.warning("reddit_watcher: critique step errored: %s", e)
            add_draft(post, text, model_name, critique=flags)
            drafted += 1
    return {
        "enabled": True, "fetched": len(posts),
        "drafted": drafted, "skipped_existing": skipped,
    }
