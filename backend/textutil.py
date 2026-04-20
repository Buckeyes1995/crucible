"""Small text-analysis helpers — reading level (Flesch–Kincaid grade) for
now. Keep this module standard-lib only so it's cheap to import anywhere."""
from __future__ import annotations

import re
from typing import Any

_VOWEL_RE = re.compile(r"[aeiouyAEIOUY]+")


def _count_syllables(word: str) -> int:
    """Rough syllable count — group vowel runs, subtract silent trailing 'e'.
    Good enough for a reading-level estimate; not linguistically perfect."""
    w = re.sub(r"[^A-Za-z]", "", word)
    if not w:
        return 0
    syl = len(_VOWEL_RE.findall(w))
    if w.lower().endswith("e") and syl > 1:
        syl -= 1
    return max(1, syl)


def flesch_kincaid_grade(text: str) -> dict[str, Any]:
    """Return grade level + component counts. For empty / too-short input,
    returns {grade: None, ...} so callers can degrade to 'n/a' gracefully."""
    sentences = [s for s in re.split(r"[.!?]+", text) if s.strip()]
    words = re.findall(r"[A-Za-z][A-Za-z'-]*", text)
    if not sentences or not words:
        return {"grade": None, "sentences": len(sentences), "words": len(words),
                "syllables": 0, "avg_words_per_sentence": 0,
                "avg_syllables_per_word": 0}
    total_syllables = sum(_count_syllables(w) for w in words)
    asl = len(words) / len(sentences)
    asw = total_syllables / len(words)
    # Flesch–Kincaid Grade Level formula.
    grade = 0.39 * asl + 11.8 * asw - 15.59
    return {
        "grade": round(grade, 1),
        "sentences": len(sentences),
        "words": len(words),
        "syllables": total_syllables,
        "avg_words_per_sentence": round(asl, 2),
        "avg_syllables_per_word": round(asw, 2),
    }
