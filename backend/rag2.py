"""RAG v2 MVP (Roadmap v4 #2) — on-disk BM25 retriever over named indexes.

V1 deliberately uses BM25 instead of vector embeddings:
  - zero extra dependencies (pure Python, tokenizer + inverted index)
  - no "which embedder do I use?" rabbit hole for users
  - for sub-10k-chunk text corpora, BM25 is competitive with naive
    small-model embeddings, and way faster to index.

V2 will swap the scoring layer for hnswlib + a real embedder while
keeping the storage + chunk model identical.

Storage: one directory per index under ~/.config/crucible/rag/<slug>/
containing:
  meta.json      — index metadata
  chunks.json    — [{doc_id, doc_path, chunk_id, text, offset}]
  postings.json  — inverted index {token: [{chunk_id, tf}]}

This is simple, inspectable, and trivial to nuke + rebuild.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any, Optional

ROOT = Path.home() / ".config" / "crucible" / "rag"

# Small hand-picked English stopword list — keeps postings smaller and
# avoids every single query match thousand-chunk-long "the" buckets.
_STOPWORDS = set("""
a an and are as at be by for from has have he her hers him his i if in into is it its
me my of on or our she so than that the their them then there these they this those
to us was we were what when where which while who whom why will with you your yours
""".split())

_TOK = re.compile(r"[A-Za-z0-9_\-]+")


def _tokenize(s: str) -> list[str]:
    return [t.lower() for t in _TOK.findall(s) if len(t) > 1 and t.lower() not in _STOPWORDS]


def _slug(name: str) -> str:
    base = re.sub(r"[^a-zA-Z0-9_-]+", "_", name.strip()).strip("_") or "index"
    # Dedupe via a short hash so two indexes named "notes" don't collide.
    h = hashlib.sha1(name.encode()).hexdigest()[:6]
    return f"{base}_{h}"


def _idx_dir(slug: str) -> Path:
    return ROOT / slug


# ── IO ──────────────────────────────────────────────────────────────────────

def _save_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":")))


def _load_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text())
    except Exception:
        return fallback


# ── Chunking ────────────────────────────────────────────────────────────────
# Naive but good enough for MVP: split by blank lines (paragraphs). Cap
# chunk length at ~1500 chars so an extremely long paragraph gets sliced.

MAX_CHUNK = 1500

def _chunk_text(text: str) -> list[tuple[str, int]]:
    """Return [(chunk_text, char_offset)…]."""
    paragraphs = re.split(r"\n\s*\n", text)
    offset = 0
    out: list[tuple[str, int]] = []
    for p in paragraphs:
        p = p.strip()
        if not p:
            offset += 1
            continue
        pos = 0
        while pos < len(p):
            slice_ = p[pos: pos + MAX_CHUNK]
            out.append((slice_, offset + pos))
            pos += MAX_CHUNK
        offset += len(p) + 2  # +2 for the split separator
    return out


# ── Walking ────────────────────────────────────────────────────────────────

_TEXT_SUFFIXES = {".md", ".markdown", ".txt", ".rst", ".py", ".js", ".ts", ".tsx",
                  ".jsx", ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg",
                  ".html", ".css", ".go", ".rs", ".java", ".c", ".cc", ".cpp",
                  ".h", ".hpp", ".swift", ".rb", ".sh", ".log"}

# Cap individual-file size so binary-ish logs don't blow up the index.
MAX_FILE_BYTES = 512 * 1024

def _walk(root: Path) -> list[Path]:
    out: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        # Skip the usual noise.
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and d not in ("node_modules", "dist", "build", ".next", ".venv", "__pycache__", ".cache")]
        for fname in filenames:
            p = Path(dirpath) / fname
            if p.suffix.lower() not in _TEXT_SUFFIXES:
                continue
            try:
                if p.stat().st_size > MAX_FILE_BYTES:
                    continue
            except Exception:
                continue
            out.append(p)
    return out


# ── Indexing ───────────────────────────────────────────────────────────────

def create_index(name: str, source_dir: str) -> dict:
    """Walk source_dir, chunk + tokenize every text file, write the index.
    Returns the index metadata dict."""
    slug = _slug(name)
    d = _idx_dir(slug)
    src = Path(source_dir).expanduser()
    if not src.exists() or not src.is_dir():
        raise ValueError(f"source_dir does not exist or is not a directory: {source_dir}")

    paths = _walk(src)
    chunks: list[dict] = []
    df: dict[str, int] = {}    # doc-frequency per token (docs = chunks here)
    postings: dict[str, list[list[int]]] = {}  # token -> [[chunk_id, tf], …]

    for p in paths:
        try:
            text = p.read_text(errors="ignore")
        except Exception:
            continue
        rel = str(p.relative_to(src))
        for body, offset in _chunk_text(text):
            chunk_id = len(chunks)
            chunks.append({
                "chunk_id": chunk_id,
                "doc_path": rel,
                "abs_path": str(p),
                "offset": offset,
                "text": body,
            })
            tokens = _tokenize(body)
            tf: dict[str, int] = {}
            for t in tokens:
                tf[t] = tf.get(t, 0) + 1
            for t, count in tf.items():
                postings.setdefault(t, []).append([chunk_id, count])
                df[t] = df.get(t, 0) + 1

    meta = {
        "slug": slug,
        "name": name,
        "source_dir": str(src),
        "created_at": time.time(),
        "updated_at": time.time(),
        "chunk_count": len(chunks),
        "doc_count": len(paths),
        "avg_chunk_len": sum(len(c["text"]) for c in chunks) / max(1, len(chunks)),
        "df": df,
    }
    _save_json(d / "meta.json", meta)
    _save_json(d / "chunks.json", chunks)
    _save_json(d / "postings.json", postings)
    # Public view drops the heavy df dict.
    return {k: v for k, v in meta.items() if k != "df"}


def list_indexes() -> list[dict]:
    if not ROOT.exists():
        return []
    out: list[dict] = []
    for d in sorted(ROOT.iterdir()):
        if not d.is_dir():
            continue
        meta = _load_json(d / "meta.json", None)
        if not meta:
            continue
        out.append({k: v for k, v in meta.items() if k != "df"})
    return out


def delete_index(slug: str) -> bool:
    d = _idx_dir(slug)
    if not d.exists():
        return False
    import shutil
    shutil.rmtree(d)
    return True


# ── Query (BM25) ───────────────────────────────────────────────────────────
# Parameters tuned for short paragraph-sized chunks.
BM25_K1 = 1.5
BM25_B = 0.75


def query(slug: str, q: str, top_k: int = 8) -> list[dict]:
    """Return the top-k chunks by BM25 score for the query string."""
    d = _idx_dir(slug)
    meta = _load_json(d / "meta.json", None)
    chunks = _load_json(d / "chunks.json", None)
    postings = _load_json(d / "postings.json", None)
    if not meta or chunks is None or postings is None:
        return []

    qtokens = _tokenize(q)
    if not qtokens:
        return []

    N = max(1, meta.get("chunk_count", len(chunks)))
    avg_len = max(1.0, float(meta.get("avg_chunk_len") or 1))
    df = meta.get("df") or {}

    scores: dict[int, float] = {}
    # Iterate only tokens that matter — skip anything not in the corpus.
    for t in qtokens:
        plist = postings.get(t)
        if not plist:
            continue
        idf = math.log(1 + (N - df.get(t, 0) + 0.5) / (df.get(t, 0) + 0.5))
        for chunk_id, tf in plist:
            chunk_len = len(chunks[chunk_id]["text"])
            denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * chunk_len / avg_len)
            if denom <= 0:
                continue
            s = idf * (tf * (BM25_K1 + 1)) / denom
            scores[chunk_id] = scores.get(chunk_id, 0.0) + s

    ranked = sorted(scores.items(), key=lambda kv: -kv[1])[:top_k]
    return [
        {
            "chunk_id": cid,
            "score": round(score, 4),
            "doc_path": chunks[cid]["doc_path"],
            "abs_path": chunks[cid]["abs_path"],
            "offset": chunks[cid]["offset"],
            "text": chunks[cid]["text"],
        }
        for cid, score in ranked
    ]


def get_index(slug: str) -> Optional[dict]:
    d = _idx_dir(slug)
    meta = _load_json(d / "meta.json", None)
    if not meta:
        return None
    return {k: v for k, v in meta.items() if k != "df"}
