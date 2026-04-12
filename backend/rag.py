"""Simple BM25-based RAG context injector.

Chunks local text files and retrieves the most relevant chunks
for a given query using BM25 scoring — no vector DB required.
"""
import math
import re
from pathlib import Path
from typing import NamedTuple

# ---------------------------------------------------------------------------
# Text chunking
# ---------------------------------------------------------------------------

def _chunk_text(text: str, chunk_size: int = 400, overlap: int = 80) -> list[str]:
    """Split text into overlapping chunks of ~chunk_size words."""
    words = text.split()
    if not words:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(words):
        end = min(start + chunk_size, len(words))
        chunks.append(" ".join(words[start:end]))
        if end == len(words):
            break
        start += chunk_size - overlap
    return chunks


def load_file(path: str) -> list[str]:
    """Load a text/markdown/code file and return chunks."""
    p = Path(path).expanduser()
    if not p.exists():
        raise FileNotFoundError(f"File not found: {path}")
    if p.stat().st_size > 10 * 1024 * 1024:  # 10 MB limit
        raise ValueError(f"File too large (max 10 MB): {path}")
    text = p.read_text(errors="replace")
    return _chunk_text(text)


# ---------------------------------------------------------------------------
# BM25 scoring
# ---------------------------------------------------------------------------

_TOKENIZE_RE = re.compile(r"\b\w+\b")

def _tokenize(text: str) -> list[str]:
    return _TOKENIZE_RE.findall(text.lower())


class BM25:
    """Minimal BM25 implementation — no external dependencies."""

    def __init__(self, corpus: list[str], k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.corpus = corpus
        self.tokenized = [_tokenize(doc) for doc in corpus]
        self.n = len(corpus)
        self.avgdl = sum(len(d) for d in self.tokenized) / max(self.n, 1)
        self._build_idf()

    def _build_idf(self):
        from collections import Counter
        df: dict[str, int] = {}
        for doc in self.tokenized:
            for term in set(doc):
                df[term] = df.get(term, 0) + 1
        self.idf = {}
        for term, freq in df.items():
            self.idf[term] = math.log((self.n - freq + 0.5) / (freq + 0.5) + 1)

    def score(self, query: str) -> list[float]:
        q_terms = _tokenize(query)
        scores = [0.0] * self.n
        for term in q_terms:
            if term not in self.idf:
                continue
            idf = self.idf[term]
            for i, doc_tokens in enumerate(self.tokenized):
                from collections import Counter
                tf = Counter(doc_tokens)[term]
                dl = len(doc_tokens)
                denom = tf + self.k1 * (1 - self.b + self.b * dl / self.avgdl)
                scores[i] += idf * tf * (self.k1 + 1) / denom
        return scores

    def top_k(self, query: str, k: int = 5) -> list[tuple[int, float, str]]:
        scores = self.score(query)
        ranked = sorted(enumerate(scores), key=lambda x: -x[1])
        return [(i, s, self.corpus[i]) for i, s in ranked[:k] if s > 0]


# ---------------------------------------------------------------------------
# Session context store — per-session file list
# ---------------------------------------------------------------------------

_session_files: dict[str, list[str]] = {}  # session_id -> [chunk, ...]
_session_meta: dict[str, list[str]] = {}   # session_id -> [filename, ...]


def add_file_to_session(session_id: str, path: str) -> int:
    """Load file chunks into a session. Returns chunk count."""
    chunks = load_file(path)
    if session_id not in _session_files:
        _session_files[session_id] = []
        _session_meta[session_id] = []
    _session_files[session_id].extend(chunks)
    fname = Path(path).name
    _session_meta[session_id].extend([fname] * len(chunks))
    return len(chunks)


def add_text_to_session(session_id: str, name: str, text: str) -> int:
    """Add arbitrary text (e.g. pasted content) to a session."""
    chunks = _chunk_text(text)
    if session_id not in _session_files:
        _session_files[session_id] = []
        _session_meta[session_id] = []
    _session_files[session_id].extend(chunks)
    _session_meta[session_id].extend([name] * len(chunks))
    return len(chunks)


def clear_session(session_id: str) -> None:
    _session_files.pop(session_id, None)
    _session_meta.pop(session_id, None)


def get_context(session_id: str, query: str, top_k: int = 4, max_chars: int = 3000) -> str:
    """Return a formatted context block of the most relevant chunks."""
    chunks = _session_files.get(session_id, [])
    meta = _session_meta.get(session_id, [])
    if not chunks:
        return ""

    bm25 = BM25(chunks)
    hits = bm25.top_k(query, k=top_k)

    parts = []
    total = 0
    for idx, score, chunk in hits:
        src = meta[idx] if idx < len(meta) else "context"
        snippet = f"[Source: {src}]\n{chunk}"
        if total + len(snippet) > max_chars:
            break
        parts.append(snippet)
        total += len(snippet)

    if not parts:
        return ""
    return "Relevant context:\n\n" + "\n\n---\n\n".join(parts)


def session_info(session_id: str) -> dict:
    chunks = _session_files.get(session_id, [])
    meta = _session_meta.get(session_id, [])
    files: dict[str, int] = {}
    for name in meta:
        files[name] = files.get(name, 0) + 1
    return {"chunk_count": len(chunks), "files": files}
