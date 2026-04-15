"""Model Size Analyzer — disk usage breakdown."""
from fastapi import APIRouter, Request

router = APIRouter()

@router.get("/models/size-analysis")
async def size_analysis(request: Request) -> dict:
    registry = request.app.state.registry
    models = [m for m in registry.all() if m.node == "local"]

    by_kind = {}
    by_quant = {}
    entries = []

    for m in models:
        gb = (m.size_bytes or 0) / 1e9
        entries.append({"id": m.id, "name": m.name, "kind": m.kind, "quant": m.quant, "size_gb": round(gb, 2)})
        by_kind[m.kind] = by_kind.get(m.kind, 0) + gb
        q = m.quant or "unknown"
        by_quant[q] = by_quant.get(q, 0) + gb

    entries.sort(key=lambda e: e["size_gb"], reverse=True)
    total_gb = sum(e["size_gb"] for e in entries)

    return {
        "models": entries,
        "by_kind": {k: round(v, 2) for k, v in sorted(by_kind.items(), key=lambda x: -x[1])},
        "by_quant": {k: round(v, 2) for k, v in sorted(by_quant.items(), key=lambda x: -x[1])},
        "total_gb": round(total_gb, 2),
        "model_count": len(entries),
    }
