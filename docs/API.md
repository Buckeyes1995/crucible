# Forge API Reference

Base URL: `http://localhost:7777`

All SSE streams: `Content-Type: text/event-stream`, format `data: <json>\n\n`.

---

## Models

### GET /api/models
Returns all models across all backends.

**Response:**
```json
[
  {
    "id": "gguf::Qwen3.5-9B-Q6_K",
    "name": "Qwen3.5-9B-Q6_K",
    "kind": "gguf",
    "path": "/Volumes/DataNVME/models/gguf/Qwen3.5-9B-Q6_K.gguf",
    "size_bytes": 7340032000,
    "context_window": 32768,
    "quant": "Q6_K",
    "avg_tok_per_sec": 42.1,
    "last_loaded": "2026-04-08T12:00:00Z"
  }
]
```

### POST /api/models/{id}/load
Loads a model. Returns SSE stream.

**SSE events:**
```
event: stage
data: {"stage": "starting", "message": "Starting llama-server…"}

event: stage
data: {"stage": "loading", "message": "Loading weights…"}

event: stage
data: {"stage": "warmup", "message": "Warming up…"}

event: done
data: {"model_id": "gguf::Qwen3.5-9B-Q6_K", "elapsed_ms": 4200}

event: error
data: {"message": "llama-server not found at /usr/local/bin/llama-server"}
```

### POST /api/models/stop
Stops the active model/engine.

### POST /api/models/refresh
Rescans all model directories and Ollama.

---

## Status

### GET /api/status
```json
{
  "active_model": "gguf::Qwen3.5-9B-Q6_K",
  "engine_state": "ready",
  "memory_pressure": "nominal",
  "thermal_state": "nominal",
  "uptime_s": 342
}
```
`engine_state`: `"idle"` | `"loading"` | `"ready"` | `"error"`

---

## Chat

### POST /api/chat
SSE stream.

**Request body:**
```json
{
  "model_id": "gguf::Qwen3.5-9B-Q6_K",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello"}
  ],
  "temperature": 0.7,
  "max_tokens": 512
}
```

**SSE events:**
```
event: delta
data: {"content": "Hello"}

event: stats
data: {"ttft_ms": 142, "tok_per_sec": 38.4, "tokens_out": 1}

event: done
data: {"ttft_ms": 142, "tok_per_sec": 41.2, "tokens_out": 87, "total_ms": 2100}

event: error
data: {"message": "..."}
```

---

## Benchmark

### POST /api/benchmark/run
Starts a benchmark run. Returns SSE stream.

**Request body:**
```json
{
  "name": "Qwen comparison",
  "models": ["gguf::Qwen3.5-9B-Q6_K", "mlx::Qwen3-Coder-Next-MLX-6bit"],
  "prompts": ["short_reasoning", "medium_coding"],
  "custom_prompts": [],
  "reps": 3,
  "warmup_reps": 1,
  "max_tokens": 256,
  "temperature": 0.0
}
```

**SSE events:**
```
event: start
data: {"run_id": "abc123", "total_steps": 12}

event: progress
data: {"step": 1, "model_id": "...", "prompt_id": "short_reasoning", "rep": 1}

event: result
data: {
  "step": 1,
  "model_id": "gguf::Qwen3.5-9B-Q6_K",
  "prompt_id": "short_reasoning",
  "rep": 1,
  "metrics": {
    "ttft_ms": 142,
    "tok_per_sec": 41.2,
    "tok_per_sec_p50": 40.8,
    "tok_per_sec_p90": 43.1,
    "tok_per_sec_p99": 44.0,
    "prompt_eval_tok_per_sec": 180.0,
    "total_ms": 2100,
    "tokens_out": 87,
    "memory_pressure_start": "nominal",
    "memory_pressure_peak": "nominal",
    "thermal_state": "nominal"
  }
}

event: done
data: {"run_id": "abc123", "summary": {...}}
```

### GET /api/benchmark/history
Query params: `model` (name filter), `kind` (gguf/mlx/ollama), `since` (ISO date), `limit` (default 50).

### GET /api/benchmark/run/{id}
Full run detail including all per-generation results.

### DELETE /api/benchmark/run/{id}

---

## Settings

### GET /api/settings
Returns current config.

### PUT /api/settings
Saves config. Body is partial config object — only provided keys are updated.
