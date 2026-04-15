"""oMLX admin API client — manages DFlash and per-model settings."""

import logging
from pathlib import Path
from typing import Optional

import httpx

log = logging.getLogger(__name__)

# DFlash draft model naming convention: target "Foo-MLX-6bit" → draft "Foo-DFlash"
# We scan the MLX model dir for directories ending in "-DFlash" and match them
# to target models by stripping the quant/format suffix.


def find_dflash_draft(model_path: str, mlx_dir: str) -> Optional[str]:
    """Find a matching DFlash draft model for a given MLX model path.

    Matching rules (in order):
      1. Exact: <model_dir>-DFlash exists
      2. Strip quant suffix: "Foo-MLX-6bit" → "Foo-DFlash"
      3. Strip "-MLX-*" or "-Instruct-*" suffixes and try "-DFlash"
    """
    if not model_path or not mlx_dir:
        return None
    model_dir = Path(model_path)
    mlx_root = Path(mlx_dir)
    name = model_dir.name

    # Candidate names to try
    candidates = [f"{name}-DFlash"]

    # Strip common suffixes: -MLX-6bit, -MLX-4bit, -8bit, -4bit, -Instruct-MLX-4bit, etc.
    import re
    stripped = re.sub(r"(-MLX)?-\d+bit$", "", name)
    if stripped != name:
        candidates.append(f"{stripped}-DFlash")

    stripped2 = re.sub(r"-Instruct(-MLX)?-\d+bit$", "", name)
    if stripped2 != name and stripped2 != stripped:
        candidates.append(f"{stripped2}-DFlash")

    stripped3 = re.sub(r"-MLX-\w+$", "", name)
    if stripped3 != name and stripped3 not in (stripped, stripped2):
        candidates.append(f"{stripped3}-DFlash")

    for candidate in candidates:
        draft_path = mlx_root / candidate
        if draft_path.is_dir() and (draft_path / "config.json").exists():
            return str(draft_path)
    return None


class OMLXAdminClient:
    """Thin client for oMLX's admin API (session-cookie auth)."""

    def __init__(self, base_url: str = "http://127.0.0.1:8000", api_key: str = ""):
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._cookies: dict = {}

    async def _ensure_session(self, client: httpx.AsyncClient) -> None:
        if self._cookies:
            return
        if not self._api_key:
            return
        try:
            r = await client.post(
                f"{self._base_url}/admin/api/login",
                json={"api_key": self._api_key, "remember": True},
            )
            if r.status_code == 200:
                self._cookies = dict(r.cookies)
        except Exception as e:
            log.warning("oMLX admin login failed: %s", e)

    async def get_model_settings(self, model_id: str) -> Optional[dict]:
        """Get oMLX per-model settings including DFlash state."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await self._ensure_session(client)
                r = await client.get(
                    f"{self._base_url}/admin/api/models",
                    cookies=self._cookies,
                )
                if r.status_code != 200:
                    return None
                for m in r.json():
                    if m.get("id") == model_id:
                        return m.get("settings", {})
        except Exception as e:
            log.warning("oMLX get_model_settings failed: %s", e)
        return None

    async def set_dflash(
        self,
        model_id: str,
        enabled: bool,
        draft_model: Optional[str] = None,
        draft_quant_bits: Optional[int] = 4,
    ) -> Optional[dict]:
        """Enable or disable DFlash for a model."""
        payload: dict = {"dflash_enabled": enabled}
        if enabled and draft_model:
            payload["dflash_draft_model"] = draft_model
            if draft_quant_bits is not None:
                payload["dflash_draft_quant_bits"] = draft_quant_bits
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await self._ensure_session(client)
                r = await client.put(
                    f"{self._base_url}/admin/api/models/{model_id}/settings",
                    json=payload,
                    cookies=self._cookies,
                )
                if r.status_code == 200:
                    return r.json()
                log.warning("oMLX set_dflash returned %d: %s", r.status_code, r.text[:200])
        except Exception as e:
            log.warning("oMLX set_dflash failed: %s", e)
        return None

    async def get_dflash_status(self, model_id: str) -> dict:
        """Get DFlash status for a specific model."""
        settings = await self.get_model_settings(model_id)
        if settings is None:
            return {"eligible": False, "enabled": False}
        return {
            "eligible": True,
            "enabled": settings.get("dflash_enabled", False),
            "draft_model": settings.get("dflash_draft_model"),
            "draft_quant_bits": settings.get("dflash_draft_quant_bits"),
        }
