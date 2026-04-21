"""Prometheus-compatible /metrics endpoint. OpenMetrics text format so
external Prometheus / Grafana Cloud can scrape without a custom exporter.

Metrics exposed:
  crucible_proxy_requests_total{status}       counter
  crucible_proxy_tokens_out_total              counter
  crucible_active_engine_loaded                gauge (1 / 0)
  crucible_memory_pressure                     gauge (0..1)
  crucible_download_active                     gauge (count)
  crucible_arena_battles_total                 counter
  crucible_snippets_total                      gauge (count)
"""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse

router = APIRouter()


def _fmt(name: str, value: float | int,
         labels: dict[str, str] | None = None,
         help_text: str | None = None,
         mtype: str = "gauge") -> list[str]:
    out: list[str] = []
    if help_text:
        out.append(f"# HELP {name} {help_text}")
    out.append(f"# TYPE {name} {mtype}")
    label_str = ""
    if labels:
        label_str = "{" + ",".join(f'{k}="{v}"' for k, v in labels.items()) + "}"
    out.append(f"{name}{label_str} {value}")
    return out


@router.get("/metrics", response_class=PlainTextResponse)
async def metrics(request: Request) -> str:
    lines: list[str] = []
    # Usage tracker totals
    try:
        import usage_tracker
        s = usage_tracker.summary(days=1)
        lines += _fmt("crucible_proxy_requests_total",
                      s["totals"]["requests"],
                      help_text="Total /v1/* proxy requests in the last day",
                      mtype="counter")
        lines += _fmt("crucible_proxy_tokens_out_total",
                      s["totals"]["tokens_out"],
                      help_text="Total output tokens served via /v1/* in the last day",
                      mtype="counter")
    except Exception:
        pass

    # Active-engine + memory pressure
    try:
        adapter = getattr(request.app.state, "active_adapter", None)
        loaded = 1 if adapter and adapter.is_loaded() else 0
        engine = type(adapter).__name__.replace("Adapter", "").lower() if adapter else "none"
        lines += _fmt("crucible_active_engine_loaded",
                      loaded, labels={"engine": engine},
                      help_text="1 if a model is currently loaded on the active adapter")
    except Exception:
        pass
    try:
        from benchmark.metrics import get_memory_pressure
        lines += _fmt("crucible_memory_pressure", float(get_memory_pressure() or 0),
                      help_text="macOS memory pressure, 0..1")
    except Exception:
        pass

    # Download manager
    try:
        from hf_downloader import download_manager
        active = sum(1 for j in download_manager.list_jobs()
                     if j.get("status") in ("queued", "downloading"))
        lines += _fmt("crucible_downloads_active", active,
                      help_text="Active + queued HF download jobs")
    except Exception:
        pass

    # Snippet count
    try:
        import snippets
        lines += _fmt("crucible_snippets_total", len(snippets.list_snippets()),
                      help_text="Total snippets in the local library")
    except Exception:
        pass

    # Arena battles
    try:
        import aiosqlite
        from db.database import DB_PATH
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("SELECT COUNT(*) FROM arena_battles WHERE winner IS NOT NULL") as cur:
                row = await cur.fetchone()
                lines += _fmt("crucible_arena_battles_total", int(row[0] if row else 0),
                              help_text="Arena battles completed + voted",
                              mtype="counter")
    except Exception:
        pass

    return "\n".join(lines) + "\n"
