#!/usr/bin/env python3
"""
Crucible menu bar companion — macOS menu bar app using rumps.
Shows active model, memory pressure, quick model switching.

Install: pip install rumps requests
Run: python crucible_menubar.py
"""
import threading
import time
from typing import Optional

import requests
import rumps

CRUCIBLE_API = "http://127.0.0.1:7777/api"
POLL_INTERVAL = 10  # seconds


def _get(path: str, timeout: float = 5.0) -> Optional[dict | list]:
    try:
        r = requests.get(f"{CRUCIBLE_API}{path}", timeout=timeout)
        r.raise_for_status()
        return r.json()
    except Exception:
        return None


def _post(path: str, json: dict | None = None, timeout: float = 5.0) -> Optional[dict]:
    try:
        r = requests.post(f"{CRUCIBLE_API}{path}", json=json or {}, timeout=timeout)
        r.raise_for_status()
        return r.json()
    except Exception:
        return None


class CrucibleMenuBar(rumps.App):
    def __init__(self):
        super().__init__("⚗", quit_button=None)
        self._models: list[dict] = []
        self._status: Optional[dict] = None
        self._loading = False

        # Build initial menu
        self.menu = [
            rumps.MenuItem("Crucible", callback=self._open_ui),
            None,  # separator
            rumps.MenuItem("Status: Connecting…"),
            None,
            rumps.MenuItem("── Models ──"),
            None,
            rumps.MenuItem("Stop model", callback=self._stop_model),
            None,
            rumps.MenuItem("Open Web UI", callback=self._open_ui),
            rumps.MenuItem("Quit Crucible Menu", callback=self._quit),
        ]

        # Start background poll
        self._thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._thread.start()

    def _poll_loop(self):
        while True:
            self._refresh()
            time.sleep(POLL_INTERVAL)

    def _refresh(self):
        status = _get("/status")
        models = _get("/models")

        if status is None:
            self.title = "⚗ ✗"
            self._set_status_item("Crucible offline")
            return

        self._status = status
        self._models = models or []

        active_id = status.get("active_model_id")
        engine_state = status.get("engine_state", "idle")
        mem = status.get("memory_pressure")

        # Update title
        mem_str = f" {int(mem*100)}%" if mem is not None else ""
        if engine_state == "loading":
            self.title = f"⚗ ⟳{mem_str}"
        elif active_id:
            name = self._model_name(active_id)
            short = name[:20] + "…" if len(name) > 20 else name
            self.title = f"⚗ {short}{mem_str}"
        else:
            self.title = f"⚗{mem_str}"

        # Update status line
        if active_id:
            name = self._model_name(active_id)
            self._set_status_item(f"Active: {name}")
        elif engine_state == "loading":
            self._set_status_item("Loading…")
        else:
            self._set_status_item("No model loaded")

        # Rebuild model submenu
        self._rebuild_model_menu(active_id)

    def _model_name(self, model_id: str) -> str:
        for m in self._models:
            if m["id"] == model_id:
                return m["name"]
        return model_id.split(":")[-1]

    def _set_status_item(self, text: str):
        try:
            self.menu["Status: Connecting…"].title = text
        except Exception:
            pass
        # Try with current title
        for item in self.menu.values():
            if hasattr(item, "title") and item.title.startswith("Status:"):
                item.title = f"Status: {text}"
                return

    def _rebuild_model_menu(self, active_id: Optional[str]):
        # Remove old model items (those tagged with _is_model)
        to_remove = []
        for key, item in self.menu.items():
            if hasattr(item, "_is_model"):
                to_remove.append(key)
        for key in to_remove:
            del self.menu[key]

        # Insert new model items after the "── Models ──" separator
        for m in sorted(self._models, key=lambda x: x["name"]):
            mid = m["id"]
            name = m["name"]
            prefix = "✓ " if mid == active_id else "  "
            item = rumps.MenuItem(
                f"{prefix}{name}",
                callback=lambda sender, _mid=mid: self._load_model(_mid),
            )
            item._is_model = True
            self.menu.insert_after("── Models ──", item)

    def _load_model(self, model_id: str):
        if self._loading:
            rumps.notification("Crucible", "Already loading", "Please wait…")
            return
        self._loading = True
        self.title = "⚗ ⟳"

        def _do():
            try:
                # POST load — fire-and-forget (SSE stream, don't wait)
                requests.post(
                    f"{CRUCIBLE_API}/models/{requests.utils.quote(model_id, safe='')}/load",
                    json={},
                    timeout=600,
                    stream=True,
                )
            except Exception:
                pass
            finally:
                self._loading = False
                self._refresh()

        threading.Thread(target=_do, daemon=True).start()

    def _stop_model(self, sender):
        _post("/models/stop")
        time.sleep(0.5)
        self._refresh()

    def _open_ui(self, sender=None):
        import subprocess
        subprocess.Popen(["open", "http://localhost:3000"])

    def _quit(self, sender):
        rumps.quit_application()


if __name__ == "__main__":
    CrucibleMenuBar().run()
