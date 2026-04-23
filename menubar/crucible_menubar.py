#!/usr/bin/env python3
"""
Crucible menu bar companion — macOS menu bar app using rumps.

Shows active model + memory%, streams notifications on model loads,
download completions, and bench regressions, and gives you one-click
access to everything that matters.

Install:
    cd menubar
    /opt/homebrew/bin/python3.13 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt

Run:
    python crucible_menubar.py

Auto-start on login: see README.md (`com.jim.crucible-menubar.plist`).
"""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any, Optional

import requests
import rumps

CRUCIBLE_API = "http://127.0.0.1:7777/api"
CRUCIBLE_WEB = "http://localhost:3000"
POLL_INTERVAL = 6  # seconds — snappy enough for download progress
RECENT_FILE = Path.home() / ".config" / "crucible" / "menubar_recent.json"
MAX_RECENT = 8


# ── HTTP helpers ───────────────────────────────────────────────────────────

def _get(path: str, timeout: float = 5.0) -> Optional[Any]:
    try:
        r = requests.get(f"{CRUCIBLE_API}{path}", timeout=timeout)
        r.raise_for_status()
        return r.json()
    except Exception:
        return None


def _post(path: str, json_body: dict | None = None, timeout: float = 5.0) -> Optional[dict]:
    try:
        r = requests.post(f"{CRUCIBLE_API}{path}", json=json_body or {}, timeout=timeout)
        r.raise_for_status()
        return r.json() if r.content else {}
    except Exception:
        return None


def _put(path: str, json_body: dict | None = None, timeout: float = 5.0) -> Optional[dict]:
    try:
        r = requests.put(f"{CRUCIBLE_API}{path}", json=json_body or {}, timeout=timeout)
        r.raise_for_status()
        return r.json() if r.content else {}
    except Exception:
        return None


def _open_url(url: str) -> None:
    import subprocess
    subprocess.Popen(["open", url])


# ── Recent-models persistence ─────────────────────────────────────────────

def _load_recent() -> list[str]:
    try:
        return json.loads(RECENT_FILE.read_text()) if RECENT_FILE.exists() else []
    except Exception:
        return []


def _save_recent(ids: list[str]) -> None:
    try:
        RECENT_FILE.parent.mkdir(parents=True, exist_ok=True)
        RECENT_FILE.write_text(json.dumps(ids[:MAX_RECENT]))
    except Exception:
        pass


def _push_recent(model_id: str) -> list[str]:
    ids = [x for x in _load_recent() if x != model_id]
    ids.insert(0, model_id)
    ids = ids[:MAX_RECENT]
    _save_recent(ids)
    return ids


# ── App ────────────────────────────────────────────────────────────────────

class CrucibleMenuBar(rumps.App):
    def __init__(self) -> None:
        super().__init__("⚗", quit_button=None)

        # Snapshots used by _refresh to detect transitions → notifications.
        self._prev_active_model: Optional[str] = None
        self._prev_done_jobs: set[str] = set()
        self._prev_regression_flagged: set[str] = set()

        self._models: list[dict] = []
        self._status: Optional[dict] = None
        self._loading_tick = False

        # Initial menu skeleton. _refresh fills the dynamic bits.
        self.menu = [
            rumps.MenuItem("Open Crucible", callback=self._open_ui),
            rumps.separator,
            rumps.MenuItem("Status: Connecting…"),
            rumps.MenuItem("Downloads: —"),
            rumps.separator,
            "Recent",
            rumps.separator,
            "All models",
            rumps.separator,
            rumps.MenuItem("Stop active model", callback=self._stop_model),
            rumps.separator,
            self._quick_menu(),
            rumps.separator,
            rumps.MenuItem("Refresh now", callback=lambda _: self._refresh()),
            rumps.MenuItem("Quit", callback=self._quit),
        ]

        # Background poll
        self._thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._thread.start()

    # ── Submenus ──────────────────────────────────────────────────────────

    def _quick_menu(self) -> rumps.MenuItem:
        quick = rumps.MenuItem("Quick open…")
        for label, path in [
            ("Chat", "/chat"),
            ("Agent Runs", "/runs"),
            ("Prompts", "/prompts"),
            ("Evals", "/evals"),
            ("RAG", "/rag"),
            ("News", "/news"),
            ("Automation", "/automation"),
            ("Benchmark history", "/benchmark/history"),
            ("Models page", "/models"),
            ("Settings", "/settings"),
        ]:
            quick.add(rumps.MenuItem(label, callback=lambda _s, p=path: _open_url(CRUCIBLE_WEB + p)))
        return quick

    # ── Poll loop ─────────────────────────────────────────────────────────

    def _poll_loop(self) -> None:
        while True:
            try:
                self._refresh()
            except Exception:
                # Never let a single bad tick kill the loop.
                pass
            time.sleep(POLL_INTERVAL)

    def _refresh(self) -> None:
        status = _get("/status")
        models = _get("/models")
        downloads = _get("/hf/downloads") or []
        regression_state = _get("/model-usage-stats")  # not used directly; reserved for future

        # ── Offline → show the offline title and bail ────────────────
        if status is None:
            self._set_title("⚗ ✗")
            self._update_menu_title("Status", "Crucible offline")
            self._update_menu_title("Downloads", "backend unreachable")
            return

        self._status = status
        self._models = models or []

        active_id = status.get("active_model_id")
        engine_state = status.get("engine_state", "idle")
        mem = status.get("memory_pressure")

        # ── Title ────────────────────────────────────────────────────
        mem_str = f" {int(mem * 100)}%" if isinstance(mem, (int, float)) else ""
        live_dl = [j for j in downloads if j.get("status") in ("queued", "downloading")]
        if live_dl:
            # Downloads in flight — show the leader's percent.
            lead = live_dl[0]
            pct = lead.get("progress") or 0
            self._set_title(f"⚗ ↓{int(pct * 100)}%{mem_str}")
        elif engine_state == "loading" or self._loading_tick:
            self._set_title(f"⚗ ⟳{mem_str}")
        elif active_id:
            short = self._short_name(active_id, 22)
            self._set_title(f"⚗ {short}{mem_str}")
        else:
            self._set_title(f"⚗{mem_str}")

        # ── Status line ──────────────────────────────────────────────
        if active_id:
            self._update_menu_title("Status", f"Active: {self._short_name(active_id)}")
        elif engine_state == "loading":
            self._update_menu_title("Status", "Loading…")
        else:
            self._update_menu_title("Status", "No model loaded")

        # ── Downloads line ───────────────────────────────────────────
        if live_dl:
            names = ", ".join(self._repo_leaf(j.get("repo_id", "")) for j in live_dl[:2])
            if len(live_dl) > 2:
                names += f" +{len(live_dl) - 2}"
            self._update_menu_title("Downloads", f"↓ {names}")
        else:
            self._update_menu_title("Downloads", "no active downloads")

        # ── Rebuild model sections ───────────────────────────────────
        self._rebuild_model_menus(active_id)

        # ── Transition-based notifications ───────────────────────────
        self._check_notifications(active_id, downloads)

    def _check_notifications(self, active_id: Optional[str], downloads: list[dict]) -> None:
        # Model load completion — only fire when the active model transitions
        # from None/other → something, not when it's static across polls.
        if active_id and active_id != self._prev_active_model:
            if self._prev_active_model is not None:
                # Skip the *very first* tick (would spam on menubar start with a
                # pre-loaded model). self._prev_active_model stays None only
                # until first poll completes with a value.
                rumps.notification(
                    "Crucible",
                    "Model loaded",
                    self._short_name(active_id),
                )
            self._prev_active_model = active_id
        elif active_id is None and self._prev_active_model is not None:
            # Model got unloaded
            self._prev_active_model = None

        # Download completions
        current_done = {j["job_id"] for j in downloads if j.get("status") == "done" and j.get("job_id")}
        newly_done = current_done - self._prev_done_jobs
        # Guard against the first tick where every completed job would be "new"
        if self._prev_done_jobs or not current_done:
            for jid in newly_done:
                job = next((j for j in downloads if j.get("job_id") == jid), None)
                if job:
                    rumps.notification(
                        "Crucible",
                        "Download finished",
                        self._repo_leaf(job.get("repo_id", "")),
                    )
        self._prev_done_jobs = current_done

    def _rebuild_model_menus(self, active_id: Optional[str]) -> None:
        # Wipe prior dynamic items (anything tagged with _is_dyn)
        to_remove: list[str] = []
        for key, item in self.menu.items():
            if hasattr(item, "_is_dyn"):
                to_remove.append(key)
        for key in to_remove:
            del self.menu[key]

        # Recent (most-recent first; filter to still-present models)
        recent_ids = _load_recent()
        available_ids = {m["id"] for m in self._models}
        present_recents = [mid for mid in recent_ids if mid in available_ids]

        after = "Recent"
        if present_recents:
            for mid in present_recents:
                item = self._model_submenu(mid, active_id)
                item._is_dyn = True
                self.menu.insert_after(after, item)
                after = item.title
        else:
            placeholder = rumps.MenuItem("  (nothing recent yet)")
            placeholder._is_dyn = True
            self.menu.insert_after("Recent", placeholder)

        # All models — grouped alphabetically, active first
        after = "All models"
        sorted_models = sorted(self._models, key=lambda x: (x["id"] != active_id, x["name"].lower()))
        for m in sorted_models:
            item = self._model_submenu(m["id"], active_id)
            item._is_dyn = True
            self.menu.insert_after(after, item)
            after = item.title

    def _model_submenu(self, model_id: str, active_id: Optional[str]) -> rumps.MenuItem:
        model = next((m for m in self._models if m["id"] == model_id), None)
        name = model["name"] if model else model_id.split(":")[-1]
        is_active = model_id == active_id
        label = f"{'✓ ' if is_active else '  '}{name[:40]}"
        top = rumps.MenuItem(label)
        top.add(rumps.MenuItem("Load", callback=lambda _s, mid=model_id: self._load_model(mid)))
        if is_active:
            top.add(rumps.MenuItem("Stop", callback=lambda _s: self._stop_model(None)))
        # DFlash toggle if eligible
        if model and model.get("dflash_draft"):
            state = "Disable DFlash" if model.get("dflash_enabled") else "Enable DFlash"
            top.add(rumps.MenuItem(state, callback=lambda _s, mid=model_id, cur=bool(model.get("dflash_enabled")): self._toggle_dflash(mid, not cur)))
        top.add(rumps.separator)
        top.add(rumps.MenuItem("Open Notes", callback=lambda _s, mid=model_id: _open_url(f"{CRUCIBLE_WEB}/models?notes={mid}")))
        top.add(rumps.MenuItem("Open Params", callback=lambda _s, mid=model_id: _open_url(f"{CRUCIBLE_WEB}/models?params={mid}")))
        return top

    # ── Actions ───────────────────────────────────────────────────────────

    def _load_model(self, model_id: str) -> None:
        if self._loading_tick:
            rumps.notification("Crucible", "Busy", "A load is already in flight.")
            return
        self._loading_tick = True
        self._set_title("⚗ ⟳")
        _push_recent(model_id)

        def _do() -> None:
            try:
                # SSE stream — we don't need the body, just kick it off. The
                # 600s timeout is a safety net for mega-models; the poll loop
                # will notify when active_model_id transitions.
                encoded = requests.utils.quote(model_id, safe="")
                requests.post(
                    f"{CRUCIBLE_API}/models/{encoded}/load",
                    json={}, timeout=600, stream=True,
                )
            except Exception:
                pass
            finally:
                self._loading_tick = False
                self._refresh()

        threading.Thread(target=_do, daemon=True).start()

    def _stop_model(self, sender) -> None:
        _post("/models/stop")
        time.sleep(0.4)
        self._refresh()

    def _toggle_dflash(self, model_id: str, enabled: bool) -> None:
        _put(
            f"/models/{requests.utils.quote(model_id, safe='')}/dflash",
            {"enabled": enabled},
        )
        time.sleep(0.3)
        self._refresh()
        rumps.notification(
            "Crucible",
            f"DFlash {'enabled' if enabled else 'disabled'}",
            self._short_name(model_id),
        )

    def _open_ui(self, sender=None) -> None:
        _open_url(CRUCIBLE_WEB)

    def _quit(self, sender) -> None:
        rumps.quit_application()

    # ── Helpers ───────────────────────────────────────────────────────────

    def _set_title(self, text: str) -> None:
        # rumps updates the title via the `title` property.
        self.title = text

    def _update_menu_title(self, prefix: str, new_text: str) -> None:
        """Find the first menu item whose title starts with `<prefix>:` and
        replace its full title with `<prefix>: <new_text>`. Avoids hitting a
        stale dict key when the previous text was different."""
        for item in self.menu.values():
            if hasattr(item, "title") and item.title.startswith(f"{prefix}:"):
                item.title = f"{prefix}: {new_text}"
                return

    def _short_name(self, model_id: str, cap: int = 32) -> str:
        # Prefer the registry's `name` if we have it; fall back to the id's leaf.
        for m in self._models:
            if m["id"] == model_id:
                name = m["name"]
                break
        else:
            name = model_id.split(":", 1)[-1]
        return (name[: cap - 1] + "…") if len(name) > cap else name

    @staticmethod
    def _repo_leaf(repo_id: str) -> str:
        return repo_id.rsplit("/", 1)[-1] if repo_id else "?"


if __name__ == "__main__":
    CrucibleMenuBar().run()
