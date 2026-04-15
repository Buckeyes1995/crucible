"""Model Recommender — analyzes model library and provides recommendations."""

import json
import logging
from pathlib import Path

import aiosqlite

from db.database import DB_PATH
from registry import ModelRegistry

log = logging.getLogger(__name__)

# Size thresholds in GB
SMALL_MODEL_GB = 10
MEDIUM_MODEL_GB = 30
LARGE_MODEL_GB = 60


def _gb(size_bytes: int | None) -> float:
    return (size_bytes or 0) / 1e9


async def analyze(registry: ModelRegistry, total_ram_gb: float = 96.0) -> dict:
    """Analyze model library and generate recommendations."""
    models = [m for m in registry.all() if m.node == "local" and not m.name.endswith("-DFlash")]

    # Group by base model (strip quant suffix)
    import re
    groups: dict[str, list] = {}
    for m in models:
        base = re.sub(r"(-MLX)?-\d+bit$", "", m.name)
        base = re.sub(r"-Q\d+_K_[MS]$", "", base)
        groups.setdefault(base, []).append(m)

    # Get benchmark data
    bench_data: dict[str, dict] = {}
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("""
                SELECT model_id,
                       AVG(json_extract(metrics_json, '$.throughput_tps')) as avg_tps,
                       COUNT(*) as bench_count
                FROM benchmark_results
                WHERE json_extract(metrics_json, '$.throughput_tps') IS NOT NULL
                GROUP BY model_id
            """) as cur:
                async for row in cur:
                    bench_data[row[0]] = {"avg_tps": round(row[1], 2), "bench_count": row[2]}
    except Exception:
        pass

    # Get profiler usage data
    usage_data: dict[str, int] = {}
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("""
                SELECT model_id, COUNT(*) as uses
                FROM inference_profiles
                GROUP BY model_id
            """) as cur:
                async for row in cur:
                    usage_data[row[0]] = row[1]
    except Exception:
        pass

    recommendations = []
    insights = []
    total_size_gb = sum(_gb(m.size_bytes) for m in models)

    # Insight: total storage
    insights.append({
        "type": "info",
        "title": "Total model storage",
        "detail": f"{total_size_gb:.1f} GB across {len(models)} models",
    })

    # Insight: RAM budget
    fits_in_ram = [m for m in models if _gb(m.size_bytes) < total_ram_gb * 0.85]
    too_big = [m for m in models if _gb(m.size_bytes) >= total_ram_gb * 0.85]
    if too_big:
        for m in too_big:
            insights.append({
                "type": "warning",
                "title": f"{m.name} may not fit in RAM",
                "detail": f"{_gb(m.size_bytes):.1f} GB model vs {total_ram_gb:.0f} GB RAM — may cause heavy swapping",
            })

    # Redundancy detection — multiple quants of the same base
    for base, group in groups.items():
        if len(group) <= 1:
            continue
        # Sort by size (largest = highest quality)
        group.sort(key=lambda m: m.size_bytes or 0, reverse=True)
        biggest = group[0]
        for m in group[1:]:
            # Check if the smaller version has been benchmarked
            big_tps = bench_data.get(biggest.id, {}).get("avg_tps")
            small_tps = bench_data.get(m.id, {}).get("avg_tps")
            uses = usage_data.get(m.id, 0)

            if uses == 0 and small_tps is None:
                recommendations.append({
                    "type": "redundant",
                    "model": m.name,
                    "reason": f"Same base as {biggest.name} but never used or benchmarked",
                    "action": "Consider removing to save {:.1f} GB".format(_gb(m.size_bytes)),
                    "priority": 1,
                })
            elif big_tps and small_tps and small_tps < big_tps * 1.3:
                recommendations.append({
                    "type": "redundant",
                    "model": m.name,
                    "reason": f"Only {small_tps / big_tps:.1f}x faster than {biggest.name} but lower quality",
                    "action": "Benchmark both to decide which to keep",
                    "priority": 2,
                })

    # Unused models
    for m in models:
        uses = usage_data.get(m.id, 0)
        bench = bench_data.get(m.id)
        if uses == 0 and not bench:
            recommendations.append({
                "type": "unused",
                "model": m.name,
                "reason": "Never used in chat or benchmarked",
                "action": "Try it out or consider removing ({:.1f} GB)".format(_gb(m.size_bytes)),
                "priority": 3,
            })

    # Performance recommendations
    for m in models:
        bench = bench_data.get(m.id)
        if bench and bench["avg_tps"] and bench["avg_tps"] < 5:
            recommendations.append({
                "type": "slow",
                "model": m.name,
                "reason": f"Avg {bench['avg_tps']} tok/s — very slow generation",
                "action": "Consider a smaller quant or enabling DFlash if eligible",
                "priority": 2,
            })

    # DFlash recommendations
    dflash_eligible = [m for m in models if m.dflash_draft and not m.dflash_enabled]
    if dflash_eligible:
        insights.append({
            "type": "tip",
            "title": f"{len(dflash_eligible)} models have DFlash drafts but aren't using it",
            "detail": "Enable DFlash for 3-4x faster generation: " + ", ".join(m.name for m in dflash_eligible[:3]),
        })

    # Size tier breakdown
    small = [m for m in models if _gb(m.size_bytes) < SMALL_MODEL_GB]
    medium = [m for m in models if SMALL_MODEL_GB <= _gb(m.size_bytes) < MEDIUM_MODEL_GB]
    large = [m for m in models if MEDIUM_MODEL_GB <= _gb(m.size_bytes) < LARGE_MODEL_GB]
    xlarge = [m for m in models if _gb(m.size_bytes) >= LARGE_MODEL_GB]
    insights.append({
        "type": "info",
        "title": "Model size distribution",
        "detail": f"Small (<{SMALL_MODEL_GB}GB): {len(small)}, Medium: {len(medium)}, Large: {len(large)}, XL (>{LARGE_MODEL_GB}GB): {len(xlarge)}",
    })

    # Sort recommendations by priority
    recommendations.sort(key=lambda r: r.get("priority", 99))

    return {
        "model_count": len(models),
        "total_size_gb": round(total_size_gb, 1),
        "total_ram_gb": total_ram_gb,
        "insights": insights,
        "recommendations": recommendations,
        "size_tiers": {
            "small": len(small),
            "medium": len(medium),
            "large": len(large),
            "xlarge": len(xlarge),
        },
    }
