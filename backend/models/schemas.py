from pydantic import BaseModel, Field
from typing import Optional, Any


class ModelEntry(BaseModel):
    id: str
    name: str
    kind: str  # "mlx" | "gguf" | "ollama"
    path: Optional[str] = None
    size_bytes: Optional[int] = None
    context_window: Optional[int] = None
    quant: Optional[str] = None
    backend_meta: dict[str, Any] = {}
    avg_tps: Optional[float] = None
    last_loaded: Optional[str] = None
    hidden: bool = False


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    temperature: float = 0.7
    max_tokens: int = 1024
    rag_session_id: str | None = None  # inject BM25 context when set


class BenchmarkConfig(BaseModel):
    model_ids: list[str]
    prompt_ids: list[str] = []
    custom_prompts: list[str] = []
    reps: int = 1
    max_tokens: int = 2048
    temperature: float = 0.0
    warmup_reps: int = 1
    name: Optional[str] = None


class MetricsResult(BaseModel):
    ttft_ms: Optional[float] = None
    throughput_tps: Optional[float] = None
    prompt_eval_tps: Optional[float] = None
    p50_tps: Optional[float] = None
    p90_tps: Optional[float] = None
    p99_tps: Optional[float] = None
    total_ms: Optional[float] = None
    output_tokens: Optional[int] = None
    memory_pressure_start: Optional[float] = None
    memory_pressure_peak: Optional[float] = None
    thermal_state: Optional[str] = None
    token_timestamps: list[float] = []


class BenchmarkRunSummary(BaseModel):
    run_id: str
    created_at: str
    name: Optional[str] = None
    model_ids: list[str] = []
    prompt_count: int = 0
    best_tps: Optional[float] = None


class BenchmarkRunDetail(BaseModel):
    run_id: str
    created_at: str
    name: Optional[str] = None
    config: dict[str, Any] = {}
    results: list[dict[str, Any]] = []
