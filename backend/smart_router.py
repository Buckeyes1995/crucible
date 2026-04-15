"""Smart Router — auto-select model based on prompt analysis.

Classifies prompts and routes to the best model based on configurable rules.
Sits behind the /v1/chat/completions proxy.
"""

import json
import logging
import re
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

ROUTER_CONFIG_FILE = Path.home() / ".config" / "crucible" / "smart_router.json"

# Prompt classifiers
CODE_PATTERNS = re.compile(
    r"(write|implement|code|function|class|debug|fix|refactor|program|algorithm|"
    r"python|javascript|typescript|rust|golang|java|c\+\+|sql|html|css|"
    r"```|def\s|import\s|from\s.*import|const\s|let\s|var\s|async\s)",
    re.IGNORECASE,
)
MATH_PATTERNS = re.compile(
    r"(calculate|compute|solve|equation|integral|derivative|matrix|"
    r"probability|statistics|mathematical|theorem|proof|\d+\s*[\+\-\*/\^]\s*\d+)",
    re.IGNORECASE,
)
REASONING_PATTERNS = re.compile(
    r"(explain|analyze|compare|contrast|evaluate|think.*step|reasoning|"
    r"pros\s+and\s+cons|trade-?offs|implications|consequences|why\s)",
    re.IGNORECASE,
)

DEFAULT_CONFIG = {
    "enabled": False,
    "rules": [
        {
            "name": "code",
            "description": "Code generation and debugging",
            "classifier": "code",
            "model_pattern": "Coder",
            "model_id": None,  # Explicit model ID override
            "priority": 10,
        },
        {
            "name": "reasoning",
            "description": "Complex reasoning and analysis",
            "classifier": "reasoning",
            "model_pattern": None,
            "model_id": None,
            "min_size_gb": 20,
            "priority": 5,
        },
        {
            "name": "quick",
            "description": "Short simple queries",
            "classifier": "short",
            "model_pattern": None,
            "model_id": None,
            "max_size_gb": 15,
            "priority": 1,
        },
    ],
    "default_model": None,  # Fallback — uses active model if None
}


def _load_config() -> dict:
    if ROUTER_CONFIG_FILE.exists():
        try:
            return json.loads(ROUTER_CONFIG_FILE.read_text())
        except Exception:
            pass
    return DEFAULT_CONFIG.copy()


def save_config(cfg: dict) -> None:
    ROUTER_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    ROUTER_CONFIG_FILE.write_text(json.dumps(cfg, indent=2))


def get_config() -> dict:
    return _load_config()


def classify_prompt(text: str) -> dict:
    """Classify a prompt into categories with confidence scores."""
    text_lower = text.lower().strip()
    word_count = len(text_lower.split())

    scores = {
        "code": len(CODE_PATTERNS.findall(text)) * 2,
        "math": len(MATH_PATTERNS.findall(text)) * 2,
        "reasoning": len(REASONING_PATTERNS.findall(text)),
        "short": max(0, 3 - word_count // 10),  # Higher for shorter prompts
        "long": max(0, word_count // 50),  # Higher for longer prompts
    }

    # Normalize
    total = sum(scores.values()) or 1
    return {k: round(v / total, 2) for k, v in scores.items()}


def select_model(
    prompt_text: str,
    available_models: list[dict],
    config: Optional[dict] = None,
) -> Optional[str]:
    """Select the best model for a prompt. Returns model name or None for default.

    available_models: list of dicts with at least {name, kind, size_bytes, node}
    """
    cfg = config or _load_config()
    if not cfg.get("enabled"):
        return None

    scores = classify_prompt(prompt_text)
    best_category = max(scores, key=scores.get)
    rules = sorted(cfg.get("rules", []), key=lambda r: r.get("priority", 0), reverse=True)

    # Filter to local MLX models only
    candidates = [
        m for m in available_models
        if m.get("kind") == "mlx"
        and m.get("node", "local") == "local"
        and not m.get("name", "").endswith("-DFlash")
    ]

    for rule in rules:
        classifier = rule.get("classifier", "")
        if classifier and scores.get(classifier, 0) < 0.15:
            continue

        # Explicit model ID
        if rule.get("model_id"):
            match = next((m for m in candidates if m["name"] == rule["model_id"]), None)
            if match:
                return match["name"]
            continue

        # Pattern match
        pattern = rule.get("model_pattern")
        min_gb = rule.get("min_size_gb")
        max_gb = rule.get("max_size_gb")

        filtered = candidates
        if pattern:
            filtered = [m for m in filtered if pattern.lower() in m.get("name", "").lower()]
        if min_gb:
            filtered = [m for m in filtered if (m.get("size_bytes") or 0) >= min_gb * 1e9]
        if max_gb:
            filtered = [m for m in filtered if (m.get("size_bytes") or 0) <= max_gb * 1e9]

        if filtered:
            # Pick the largest matching model
            filtered.sort(key=lambda m: m.get("size_bytes") or 0, reverse=True)
            return filtered[0]["name"]

    return cfg.get("default_model")
