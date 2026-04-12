# MLX Studio Integration

## Background

Some MLX models use proprietary quantization formats that standard `mlx_lm` and oMLX cannot load.
The specific case that prompted this: **MiniMax-M2.7-JANG_2L** — a 63 GB mixed-precision (2.1-bit avg)
quantization of the 228B MoE model, using JANGQ-AI's custom "JANG" format.

- Standard `mlx_lm` fails with: `Expected shape (200064, 192) but received shape (200064, 576) for model.embed_tokens.weight`
- Loading requires `jang_tools.loader.load_jang_model` — a package not on PyPI
- MLX Studio (the Mac app by mlxstudio.com) bundles `jang_tools` and handles it natively

**Why not other MiniMax-M2.7 variants?**
All standard mlx-community quantizations are too large for 96 GB:
- 3-bit: 100 GB, 4-bit: 129 GB, 6-bit: 186 GB
- JANG_2L at 63 GB is the only one that fits — specifically designed for 96 GB Macs

## What Was Built

Crucible now supports **MLX Studio as a fourth backend**, alongside oMLX, llama.cpp, and Ollama.

Models loaded in MLX Studio appear in Crucible's model list with a purple **MLX Studio** badge.
Loading a model in Crucible tells MLX Studio to serve it; all chat and benchmarking works normally.

### Files Changed

| File | Change |
|------|--------|
| `backend/config.py` | Added `mlx_studio_url: str = ""` field |
| `backend/registry.py` | Added `scan_mlx_studio(url)` — queries `/v1/models` from MLX Studio |
| `backend/routers/models.py` | Handles `kind == "mlx_studio"` → `ExternalAdapter(mlx_studio_url)` |
| `backend/adapters/external.py` | De-hardcoded "oMLX" strings to be generic |
| `frontend/app/settings/page.tsx` | Added MLX Studio section with URL field |
| `frontend/lib/api.ts` | Added `mlx_studio_url` to `CrucibleConfig` type |
| `frontend/components/ui/badge.tsx` | Added `mlx_studio` variant (violet) |
| `frontend/app/models/page.tsx` | Renders "MLX Studio" badge for `mlx_studio` kind |

## Setup Instructions

### 1. Configure MLX Studio

- Open MLX Studio
- Go to Settings → find the **OpenAI Gateway** / API server option
- Set port to **8090** (avoids conflict with llama.cpp on 8080)
- Enable the gateway

### 2. Configure Crucible

- Open Crucible → **Settings**
- Scroll to the new **MLX Studio** section
- Enter: `http://localhost:8090`
- Click **Save**

### 3. Load a model

- Load the model in MLX Studio first (e.g. MiniMax-M2.7-JANG_2L)
- In Crucible → **Models** page, click **Refresh**
- The model appears with a purple **MLX Studio** badge
- Click **Load** — Crucible connects to MLX Studio and confirms the model is ready

### 4. Use normally

Chat, benchmark, and side-by-side compare all work. Crucible proxies requests through to
MLX Studio's OpenAI-compatible API on port 8090.

## How It Works

`scan_mlx_studio()` in `registry.py` calls `GET http://localhost:8090/v1/models` and creates
a `ModelEntry` for each model with:
- `kind = "mlx_studio"`
- `path = <server model ID>` — this is what Crucible sends as the `model` field in API calls
- `id = "mlx_studio:<server model ID>"`

When loading, `routers/models.py` creates an `ExternalAdapter(base_url=config.mlx_studio_url)`.
The `ExternalAdapter` sends a warmup chat request to confirm the model is active, then declares
the load complete. It does **not** start or stop MLX Studio — it just connects to it.

## MiniMax M2.7 JANG_2L — Model Notes

| Setting | Value | Notes |
|---------|-------|-------|
| Temperature | **1.0** | REQUIRED — lower values cause infinite thinking loops |
| Top P | 0.95 | |
| Top K | 40 | |
| Repetition Penalty | 1.1 | Helps prevent loops |
| Context | 192K tokens | |
| Active params | ~1.4B per token | MoE: 256 experts, top-8 active |

This is an **always-reasoning model** — it thinks before every response.
Set these in Crucible's per-model params (Model card → params icon) so they apply automatically.

## Current State (as of 2026-04-12)

- MLX Studio integration: **complete and working**
- MiniMax-M2.7-JANG_2L: loads and runs via MLX Studio, accessible from Crucible
- All changes committed and pushed to GitHub (`ffbf101` and prior)
- Backend must be restarted after pulling changes: `pkill -9 -f uvicorn && bash run.sh`
- oMLX is running on port 8000 (for standard MLX models)
- MLX Studio is on port 8090

## Troubleshooting

**Model doesn't appear after Refresh**
- Confirm MLX Studio gateway is running on 8090: `curl http://localhost:8090/v1/models`
- Make sure the model is loaded in MLX Studio before refreshing

**Load hangs or times out**
- MLX Studio may still be loading weights — the ExternalAdapter waits up to 10 minutes
- Check MLX Studio's UI for load progress

**"MLX Studio URL not configured" error**
- Go to Crucible Settings and ensure `http://localhost:8090` is saved in the MLX Studio field

**Port conflict**
- If 8090 is taken, change MLX Studio to another port and update Crucible Settings to match
