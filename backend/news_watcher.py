"""Daily AI news digest — fetch headlines from RSS, Reddit, GitHub releases,
and arXiv, run each item through the currently-loaded model to produce a
2-sentence summary + an impact classification, cache for ~6h.

Parallels ``reddit_watcher.py`` — fetch → filter → summarize → store. No new
dependencies: RSS is parsed with stdlib xml.etree, everything else is JSON.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, AsyncIterator, Optional

import httpx

log = logging.getLogger(__name__)

CONFIG_FILE = Path.home() / ".config" / "crucible" / "news_config.json"
DIGEST_FILE = Path.home() / ".config" / "crucible" / "news_digest.json"

# Per-item TTL. Re-summarize only when older than this.
SUMMARY_TTL_SECONDS = 6 * 60 * 60


DEFAULT_CONFIG: dict[str, Any] = {
    "enabled": True,
    # Feed adapters — each has a kind and a source-specific config.
    "sources": [
        {"id": "hn_front", "kind": "rss", "name": "Hacker News", "url": "https://hnrss.org/frontpage?points=100"},
        {"id": "verge_ai", "kind": "rss", "name": "The Verge · AI", "url": "https://www.theverge.com/ai-artificial-intelligence/rss/index.xml"},
        {"id": "techcrunch_ai", "kind": "rss", "name": "TechCrunch AI", "url": "https://techcrunch.com/category/artificial-intelligence/feed/"},
        {"id": "arxiv_cs_cl", "kind": "rss", "name": "arXiv · cs.CL", "url": "http://export.arxiv.org/rss/cs.CL"},
        {"id": "arxiv_cs_lg", "kind": "rss", "name": "arXiv · cs.LG", "url": "http://export.arxiv.org/rss/cs.LG"},
        {"id": "reddit_localllama", "kind": "reddit", "name": "r/LocalLLaMA", "subreddit": "LocalLLaMA"},
        {"id": "reddit_ml", "kind": "reddit", "name": "r/MachineLearning", "subreddit": "MachineLearning"},
        {"id": "gh_llama_cpp", "kind": "github_releases", "name": "llama.cpp releases", "repo": "ggerganov/llama.cpp"},
        {"id": "gh_mlx", "kind": "github_releases", "name": "mlx releases", "repo": "ml-explore/mlx"},
        {"id": "gh_ollama", "kind": "github_releases", "name": "ollama releases", "repo": "ollama/ollama"},
    ],
    # Filter: only keep items matching any of these lowercased tokens (applied
    # to title + excerpt combined). Empty → keep everything.
    "keyword_filter": [
        "ai", "llm", "gpt", "claude", "llama", "mistral", "qwen", "gemini",
        "machine learning", "neural", "transformer", "rag", "agent", "mcp",
        "embedding", "fine-tun", "quantiz", "inference", "mlx", "ollama",
        "anthropic", "openai", "huggingface",
    ],
    # Max items to consider per source per refresh.
    "max_items_per_source": 10,
    # Max age of items to consider, in hours. Anything older is skipped.
    "max_age_hours": 72,
    # The prompt used to summarize + classify each item. Kept short so
    # small models can follow it. Expects pure JSON back.
    "summarize_system_prompt": (
        "You read AI/ML news headlines and article excerpts. For each one:\n"
        "1. Write EXACTLY two sentences summarizing what happened, in plain "
        "declarative English. No hype, no editorializing.\n"
        "2. Classify impact as one of: 'routine' (normal update, minor news), "
        "'noteworthy' (significant but not industry-shaking), or "
        "'breaking' (major release, funding, regulatory, safety event).\n"
        "Respond ONLY with valid JSON: {\"summary\": \"...\", \"impact\": \"...\"}. "
        "No preamble, no trailing text, no markdown."
    ),
    # Where to send the summarize request (OpenAI-compat endpoint). Defaults
    # to the local Crucible proxy so we reuse whatever model is loaded.
    "summarize_endpoint": "http://127.0.0.1:7777/v1/chat/completions",
}


# ── IO helpers ──────────────────────────────────────────────────────────────

def load_config() -> dict[str, Any]:
    if CONFIG_FILE.exists():
        try:
            cfg = json.loads(CONFIG_FILE.read_text())
            # Fill missing defaults so schema evolution stays backward-compat.
            merged = {**DEFAULT_CONFIG, **cfg}
            if "sources" not in cfg:
                merged["sources"] = DEFAULT_CONFIG["sources"]
            return merged
        except Exception as e:
            log.warning("news_watcher: config load failed (%s); using defaults", e)
    return json.loads(json.dumps(DEFAULT_CONFIG))


def save_config(cfg: dict[str, Any]) -> None:
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2))


def load_digest() -> dict[str, Any]:
    if DIGEST_FILE.exists():
        try:
            return json.loads(DIGEST_FILE.read_text())
        except Exception:
            return {"items": {}, "refreshed_at": 0}
    return {"items": {}, "refreshed_at": 0}


def save_digest(data: dict[str, Any]) -> None:
    DIGEST_FILE.parent.mkdir(parents=True, exist_ok=True)
    DIGEST_FILE.write_text(json.dumps(data, indent=2))


def _item_id(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()[:16]


# ── Source adapters ─────────────────────────────────────────────────────────
# Each adapter returns a list of raw items with the shape:
#   {id, source_id, source_name, title, url, excerpt, published_at}
# `excerpt` is a trimmed version of the article description; the summarizer
# uses it alongside the title to produce the 2-sentence summary.

def _strip_html(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s or "")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _parse_rss(xml_text: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        log.warning("news_watcher: rss parse error (%s)", e)
        return items

    ns = {"atom": "http://www.w3.org/2005/Atom", "dc": "http://purl.org/dc/elements/1.1/"}

    # RSS 2.0 uses <channel><item>; Atom uses <feed><entry>. Handle both.
    for entry in root.iter():
        tag = entry.tag.split("}", 1)[-1]
        if tag not in ("item", "entry"):
            continue
        title = (entry.findtext("title") or entry.findtext("atom:title", namespaces=ns) or "").strip()
        # URL: <link>URL</link> for RSS, <link href="..."/> for Atom.
        link = ""
        link_el = entry.find("link")
        if link_el is not None:
            if link_el.text and link_el.text.strip():
                link = link_el.text.strip()
            else:
                link = link_el.attrib.get("href", "")
        if not link:
            # Try Atom namespace fallback.
            alt = entry.find("atom:link", namespaces=ns)
            if alt is not None:
                link = alt.attrib.get("href", "")
        link = link.strip()
        if not (title and link):
            continue

        excerpt = (
            entry.findtext("description")
            or entry.findtext("summary")
            or entry.findtext("atom:summary", namespaces=ns)
            or entry.findtext("content")
            or entry.findtext("atom:content", namespaces=ns)
            or ""
        )
        excerpt = _strip_html(excerpt)[:800]

        # Published: RSS pubDate, Atom published/updated, DC date.
        pub_raw = (
            entry.findtext("pubDate")
            or entry.findtext("atom:published", namespaces=ns)
            or entry.findtext("atom:updated", namespaces=ns)
            or entry.findtext("dc:date", namespaces=ns)
            or ""
        )
        published_at = _parse_date(pub_raw)

        items.append({
            "title": title,
            "url": link,
            "excerpt": excerpt,
            "published_at": published_at,
        })
    return items


def _parse_date(s: str) -> float:
    """Parse a loose RFC822 / ISO-8601 date into a unix timestamp. Best-effort."""
    if not s:
        return time.time()
    s = s.strip()
    # Try ISO-8601 first (most Atom feeds).
    try:
        from datetime import datetime
        if "T" in s:
            # Strip trailing Z or timezone offset hyphens.
            iso = s.replace("Z", "+00:00")
            return datetime.fromisoformat(iso).timestamp()
    except Exception:
        pass
    try:
        from email.utils import parsedate_to_datetime
        return parsedate_to_datetime(s).timestamp()
    except Exception:
        pass
    return time.time()


async def _fetch_rss(client: httpx.AsyncClient, source: dict[str, Any]) -> list[dict[str, Any]]:
    r = await client.get(source["url"], timeout=15.0, follow_redirects=True)
    r.raise_for_status()
    parsed = _parse_rss(r.text)
    out = []
    for p in parsed:
        out.append({
            "id": _item_id(p["url"]),
            "source_id": source["id"],
            "source_name": source.get("name", source["id"]),
            "title": p["title"],
            "url": p["url"],
            "excerpt": p["excerpt"],
            "published_at": p["published_at"],
        })
    return out


async def _fetch_reddit(client: httpx.AsyncClient, source: dict[str, Any]) -> list[dict[str, Any]]:
    sub = source["subreddit"]
    url = f"https://www.reddit.com/r/{sub}/new.json?limit=15"
    headers = {"User-Agent": "crucible-news-watcher/1.0"}
    r = await client.get(url, timeout=15.0, headers=headers, follow_redirects=True)
    r.raise_for_status()
    data = r.json()
    out = []
    for child in data.get("data", {}).get("children", []):
        p = child.get("data", {})
        title = (p.get("title") or "").strip()
        permalink = p.get("permalink") or ""
        external = (p.get("url_overridden_by_dest") or p.get("url") or "").strip()
        link = external if (external and "reddit.com" not in external) else f"https://www.reddit.com{permalink}"
        if not (title and link):
            continue
        excerpt = (p.get("selftext") or "")[:600]
        out.append({
            "id": _item_id(link),
            "source_id": source["id"],
            "source_name": source.get("name", source["id"]),
            "title": title,
            "url": link,
            "excerpt": _strip_html(excerpt),
            "published_at": float(p.get("created_utc") or time.time()),
        })
    return out


async def _fetch_github_releases(client: httpx.AsyncClient, source: dict[str, Any]) -> list[dict[str, Any]]:
    repo = source["repo"]
    url = f"https://api.github.com/repos/{repo}/releases?per_page=5"
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "crucible-news-watcher/1.0"}
    r = await client.get(url, timeout=15.0, headers=headers, follow_redirects=True)
    r.raise_for_status()
    out = []
    for rel in r.json() or []:
        if rel.get("draft") or rel.get("prerelease"):
            continue
        tag = rel.get("tag_name") or rel.get("name") or ""
        title = f"{repo} {tag}".strip()
        link = rel.get("html_url") or ""
        if not (title and link):
            continue
        excerpt = _strip_html(rel.get("body") or "")[:800]
        out.append({
            "id": _item_id(link),
            "source_id": source["id"],
            "source_name": source.get("name", source["id"]),
            "title": title,
            "url": link,
            "excerpt": excerpt,
            "published_at": _parse_date(rel.get("published_at") or ""),
        })
    return out


ADAPTERS = {
    "rss": _fetch_rss,
    "reddit": _fetch_reddit,
    "github_releases": _fetch_github_releases,
}


# ── Core pipeline ───────────────────────────────────────────────────────────

def _passes_filter(title: str, excerpt: str, keywords: list[str]) -> bool:
    if not keywords:
        return True
    hay = f"{title} {excerpt}".lower()
    return any(k.lower() in hay for k in keywords)


async def fetch_all(cfg: dict[str, Any]) -> list[dict[str, Any]]:
    """Hit every enabled source concurrently, dedup by URL hash. Returns raw
    items that still need summarization."""
    sources = cfg.get("sources") or []
    async with httpx.AsyncClient() as client:
        async def _pull(src: dict[str, Any]) -> list[dict[str, Any]]:
            fn = ADAPTERS.get(src.get("kind"))
            if not fn:
                return []
            try:
                return await fn(client, src)
            except Exception as e:
                log.warning("news_watcher: source %s failed (%s)", src.get("id"), e)
                return []
        raw = await asyncio.gather(*[_pull(s) for s in sources])

    max_per = int(cfg.get("max_items_per_source") or 10)
    max_age_s = float(cfg.get("max_age_hours") or 72) * 3600.0
    keywords = cfg.get("keyword_filter") or []
    now = time.time()

    merged: dict[str, dict[str, Any]] = {}
    for batch in raw:
        # Sort by recency, take top N per source.
        batch.sort(key=lambda x: -x.get("published_at", 0))
        batch = batch[:max_per]
        for item in batch:
            if now - item.get("published_at", now) > max_age_s:
                continue
            if not _passes_filter(item["title"], item.get("excerpt", ""), keywords):
                continue
            key = item["id"]
            # First writer wins; dedup keeps the earliest source to claim the URL.
            merged.setdefault(key, item)
    return list(merged.values())


async def summarize_item(client: httpx.AsyncClient, endpoint: str, system_prompt: str,
                         item: dict[str, Any], model_id: str | None) -> dict[str, Any]:
    """Call the OpenAI-compat chat endpoint to get {summary, impact} JSON."""
    user = f"TITLE: {item['title']}\n\nEXCERPT: {item.get('excerpt') or '(none)'}"
    payload = {
        "model": (model_id or "auto").replace("mlx:", ""),
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user},
        ],
        "max_tokens": 220,
        "temperature": 0.2,
        "stream": False,
    }
    r = await client.post(endpoint, json=payload, timeout=180.0)
    r.raise_for_status()
    data = r.json()
    content = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
    summary, impact = _extract_json(content)
    return {
        **item,
        "summary": summary,
        "impact": impact,
        "summarized_at": time.time(),
        "summary_model": model_id,
    }


def _extract_json(text: str) -> tuple[str, str]:
    """Pull {summary, impact} out of a model response. Tolerates extra prose
    around the JSON blob. Falls back to raw text + 'routine' if parsing
    fails."""
    # Prefer a fenced block if present.
    m = re.search(r"```(?:json)?\s*({.*?})\s*```", text, re.DOTALL)
    raw = m.group(1) if m else None
    if not raw:
        # Grab the outermost balanced-looking braces.
        m = re.search(r"{.*}", text, re.DOTALL)
        raw = m.group(0) if m else None
    summary, impact = "", "routine"
    if raw:
        try:
            j = json.loads(raw)
            summary = (j.get("summary") or "").strip()
            impact = (j.get("impact") or "routine").strip().lower()
        except Exception:
            pass
    if not summary:
        summary = _strip_html(text).strip()[:400]
    if impact not in ("routine", "noteworthy", "breaking"):
        impact = "routine"
    return summary, impact


async def refresh(cfg: Optional[dict[str, Any]] = None,
                  model_id: Optional[str] = None) -> AsyncIterator[dict[str, Any]]:
    """Stream events as the digest is rebuilt. Yields SSE-style events:
       {event: 'phase', phase: 'fetching'|'summarizing'|'done', …}
       {event: 'item', item: {…}}  (one per summarized item)

    Honors the per-item cache TTL so re-running within SUMMARY_TTL_SECONDS
    only fetches new items (model isn't re-invoked for anything we already
    have).
    """
    cfg = cfg or load_config()
    yield {"event": "phase", "phase": "fetching"}
    fetched = await fetch_all(cfg)
    yield {"event": "phase", "phase": "fetched", "count": len(fetched)}

    digest = load_digest()
    items: dict[str, Any] = digest.get("items", {}) or {}
    now = time.time()

    to_summarize: list[dict[str, Any]] = []
    for it in fetched:
        prev = items.get(it["id"])
        if prev and prev.get("summary") and (now - prev.get("summarized_at", 0) < SUMMARY_TTL_SECONDS):
            # Fresh enough — reuse, but refresh the metadata in case the title changed.
            merged = {**prev, **{k: v for k, v in it.items() if k != "summary"}}
            items[it["id"]] = merged
            yield {"event": "item", "item": merged, "cached": True}
        else:
            to_summarize.append(it)

    yield {"event": "phase", "phase": "summarizing", "count": len(to_summarize)}

    if to_summarize:
        endpoint = cfg.get("summarize_endpoint") or DEFAULT_CONFIG["summarize_endpoint"]
        sys_prompt = cfg.get("summarize_system_prompt") or DEFAULT_CONFIG["summarize_system_prompt"]
        async with httpx.AsyncClient() as client:
            for it in to_summarize:
                try:
                    summarized = await summarize_item(client, endpoint, sys_prompt, it, model_id)
                except Exception as e:
                    log.warning("news_watcher: summarize failed for %s (%s)", it.get("url"), e)
                    summarized = {
                        **it,
                        "summary": it.get("excerpt") or "",
                        "impact": "routine",
                        "summarized_at": now,
                        "summary_model": model_id,
                        "error": str(e),
                    }
                items[summarized["id"]] = summarized
                yield {"event": "item", "item": summarized, "cached": False}

    # Trim digest to ~500 items (most recent). Keeps the JSON file under a MB.
    ordered = sorted(items.values(), key=lambda x: -(x.get("published_at") or 0))
    if len(ordered) > 500:
        ordered = ordered[:500]
    digest["items"] = {x["id"]: x for x in ordered}
    digest["refreshed_at"] = now
    save_digest(digest)
    yield {"event": "phase", "phase": "done", "total": len(digest["items"])}


def grouped_digest(limit_per_source: int = 20) -> dict[str, Any]:
    """Return the cached digest grouped by source, sorted by published date."""
    d = load_digest()
    items = list((d.get("items") or {}).values())
    items.sort(key=lambda x: -(x.get("published_at") or 0))
    groups: dict[str, dict[str, Any]] = {}
    for it in items:
        sid = it.get("source_id") or "unknown"
        g = groups.setdefault(sid, {
            "source_id": sid,
            "source_name": it.get("source_name") or sid,
            "items": [],
        })
        if len(g["items"]) < limit_per_source:
            g["items"].append(it)
    return {
        "groups": list(groups.values()),
        "refreshed_at": d.get("refreshed_at", 0),
    }
