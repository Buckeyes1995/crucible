"""Quantization advisor — rough rule-of-thumb suggestion for 'will this fit'.

Operates on published per-bit-width approximations: each parameter stored
at N bits costs roughly N/8 bytes, plus ~1.2x overhead for KV cache /
activations during a typical inference session.
"""
from __future__ import annotations

from typing import Any

# Memory overhead multiplier — rough, matches what the mem-plan module uses.
OVERHEAD_MULT = 1.25


def suggest(param_count_billion: float, ram_budget_gb: float) -> dict[str, Any]:
    """Return the best-fitting quantization for (params, budget).

    params in billions (so 30.5 for Qwen3.6-30.5B). ram_budget_gb in GB.
    """
    if param_count_billion <= 0 or ram_budget_gb <= 0:
        return {"error": "param_count and ram_budget must be positive"}

    choices = [
        {"name": "FP16",   "bits": 16},
        {"name": "8bit",   "bits": 8},
        {"name": "6bit",   "bits": 6},
        {"name": "5bit",   "bits": 5},
        {"name": "4bit",   "bits": 4},
        {"name": "MXFP4",  "bits": 4},
        {"name": "3bit",   "bits": 3},
        {"name": "Q4_K_M", "bits": 4},
        {"name": "Q6_K",   "bits": 6},
    ]
    rows = []
    best_fit = None
    for c in choices:
        gb = (param_count_billion * 1e9 * (c["bits"] / 8.0) * OVERHEAD_MULT) / (1024 ** 3)
        gb = round(gb, 2)
        fits = gb <= ram_budget_gb
        rows.append({
            "quant": c["name"], "bits": c["bits"],
            "estimated_gb": gb, "fits": fits,
        })
        if fits and best_fit is None:
            best_fit = c["name"]
    return {
        "param_count_billion": param_count_billion,
        "ram_budget_gb": ram_budget_gb,
        "overhead_mult": OVERHEAD_MULT,
        "recommended": best_fit,
        "options": rows,
    }
