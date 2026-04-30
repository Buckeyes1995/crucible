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

        # HTTP results handed off from background threads to the main
        # thread via these slots. The rumps-managed timer picks them up
        # on its next tick and applies them to the UI. rumps / PyObjC is
        # not thread-safe — every title / menu mutation has to run on the
        # main thread or the process crashes on the next UI event.
        self._pending: dict[str, Any] = {}
        self._pending_lock = threading.Lock()

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
            rumps.MenuItem("Restart oMLX daemon", callback=self._restart_omlx),
            rumps.separator,
            self._quick_menu(),
            rumps.separator,
            rumps.MenuItem("Refresh now", callback=lambda _s: self._kick_fetch()),
            rumps.MenuItem("Quit", callback=self._quit),
        ]

        # Kick the first fetch immediately in the background so initial
        # paint isn't blank for 6 seconds.
        self._kick_fetch()

        # Main-thread timer — callback runs on the GUI thread.
        self._timer = rumps.Timer(self._tick, POLL_INTERVAL)
        self._timer.start()

    # ── Submenus ──────────────────────────────────────────────────────────

    def _quick_menu(self) -> rumps.MenuItem:
        quick = rumps.MenuItem("Quick open…")
        for label, path in [
            ("Chat", "/chat"),
            ("Agent Runs", "/runs"),
            ("Prompts", "/prompts"),
            ("Evals", "/evals"),
            ("RAG", "/rag"),
            ("Automation", "/automation"),
            ("Benchmark history", "/benchmark/history"),
            ("Models page", "/models"),
            ("Settings", "/settings"),
        ]:
            quick.add(rumps.MenuItem(label, callback=lambda _s, p=path: _open_url(CRUCIBLE_WEB + p)))
        return quick

    # ── Fetch + tick (main thread only touches UI) ────────────────────────

    def _kick_fetch(self) -> None:
        """Run the HTTP fetch off-thread, stash the result in _pending for
        the next timer tick to consume. Called from the Refresh button
        and once at startup."""
        def _go() -> None:
            fav_resp = _get("/favorites") or {}
            data = {
                "status": _get("/status"),
                "models": _get("/models"),
                "downloads": _get("/hf/downloads") or [],
                "favorites": fav_resp.get("ids") if isinstance(fav_resp, dict) else [],
            }
            with self._pending_lock:
                self._pending = data
        threading.Thread(target=_go, daemon=True).start()

    def _tick(self, _sender: Any) -> None:
        """Runs on the rumps main thread. Pulls any pending fetch result
        and applies it to the UI, then kicks the next background fetch."""
        try:
            with self._pending_lock:
                data, self._pending = self._pending, {}
            if data:
                self._apply(
                    data.get("status"),
                    data.get("models"),
                    data.get("downloads"),
                    data.get("favorites") or [],
                )
        except Exception as e:
            # Swallow — never let a bad tick kill the timer (rumps reuses
            # the timer, exceptions here bubble up and can halt it).
            import traceback
            traceback.print_exc()
        # Fire the next background fetch so the NEXT tick has data ready.
        self._kick_fetch()

    def _apply(self, status: Optional[dict], models: Optional[list],
               downloads: list[dict], favorites: list[str]) -> None:
        # ── Offline → show the offline title and bail ────────────────
        if status is None:
            self._set_title("⚗ ✗")
            self._update_menu_title("Status", "Crucible offline")
            self._update_menu_title("Downloads", "backend unreachable")
            return

        self._status = status
        # Filter: drop hidden models, and drop non-favorites. The menubar is
        # meant for quick access — 30+ entries defeats that. Active model
        # always shows regardless of fav/hidden so users can inspect or
        # unload it.
        self._favorites = set(favorites or [])
        active_id = (status or {}).get("active_model_id")
        all_models = models or []
        self._models = [
            m for m in all_models
            if (not m.get("hidden"))
            and (m["id"] in self._favorites or m["id"] == active_id)
        ]

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

        # Recent (most-recent first; filter to still-present models).
        # Each rumps MenuItem uses its title as its dict key, so if the
        # same model appeared in Recent AND in All-models we'd collide on
        # insert. Prefix Recent titles with "★" and filter them out of
        # All-models below — two guarantees of uniqueness.
        recent_ids = _load_recent()
        available_ids = {m["id"] for m in self._models}
        present_recents = [mid for mid in recent_ids if mid in available_ids]
        recent_set = set(present_recents)

        after = "Recent"
        if present_recents:
            for mid in present_recents:
                item = self._model_submenu(mid, active_id, prefix="★ ")
                item._is_dyn = True
                try:
                    self.menu.insert_after(after, item)
                    after = item.title
                except Exception:
                    # If a title collides for any reason, just skip that
                    # item rather than killing the whole refresh.
                    pass
        else:
            placeholder = rumps.MenuItem("  (nothing recent yet)")
            placeholder._is_dyn = True
            self.menu.insert_after("Recent", placeholder)

        # All models — active first, then alphabetical. Models already in
        # Recent are skipped so the visible menu is shorter and dict keys
        # don't collide with the starred entries above.
        after = "All models"
        remaining = [m for m in self._models if m["id"] not in recent_set]
        sorted_models = sorted(remaining, key=lambda x: (x["id"] != active_id, x["name"].lower()))
        for m in sorted_models:
            item = self._model_submenu(m["id"], active_id)
            item._is_dyn = True
            try:
                self.menu.insert_after(after, item)
                after = item.title
            except Exception:
                pass

    def _model_submenu(self, model_id: str, active_id: Optional[str], prefix: str = "") -> rumps.MenuItem:
        model = next((m for m in self._models if m["id"] == model_id), None)
        name = model["name"] if model else model_id.split(":")[-1]
        is_active = model_id == active_id
        marker = "✓ " if is_active else "  "
        label = f"{prefix}{marker}{name[:40]}"
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
                # Cross-thread: kick a fetch; next main-thread tick applies
                # the result. Never mutate UI from here.
                self._kick_fetch()

        threading.Thread(target=_do, daemon=True).start()

    def _stop_model(self, sender) -> None:
        # This callback runs on the main thread, but do the HTTP + UI
        # update via the same fetch→tick path so the UI sees the post-
        # stop state on the next tick without a blocking sleep.
        _post("/models/stop")
        self._kick_fetch()

    def _restart_omlx(self, sender) -> None:
        if not rumps.alert(
            "Restart oMLX?",
            "This will kickstart the oMLX daemon via launchd. Any loaded "
            "model will be dropped. Use when oMLX is stuck or after a "
            "watchdog alert.",
            ok="Restart", cancel="Cancel",
        ):
            return
        resp = _post("/admin/restart-omlx") or {}
        if resp.get("ok"):
            rumps.notification("Crucible", "oMLX restarting", "launchd will respawn it.")
        else:
            rumps.notification("Crucible", "Restart failed", resp.get("message", "check backend log"))
        self._kick_fetch()

    def _toggle_dflash(self, model_id: str, enabled: bool) -> None:
        _put(
            f"/models/{requests.utils.quote(model_id, safe='')}/dflash",
            {"enabled": enabled},
        )
        self._kick_fetch()
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
