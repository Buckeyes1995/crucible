const BASE = "http://localhost:7777/api";

export type ModelEntry = {
  id: string;
  name: string;
  kind: "mlx" | "gguf" | "ollama";
  path?: string;
  size_bytes?: number;
  context_window?: number;
  quant?: string;
  backend_meta?: Record<string, unknown>;
  avg_tps?: number;
  last_loaded?: string;
};

export type ChatMessage = { role: string; content: string };

export type BenchmarkPrompt = {
  id: string;
  category: string;
  text: string;
  estimated_tokens?: number;
};

export type BenchmarkConfig = {
  model_ids: string[];
  prompt_ids?: string[];
  custom_prompts?: string[];
  reps?: number;
  max_tokens?: number;
  temperature?: number;
  warmup_reps?: number;
  name?: string;
};

export type CrucibleConfig = {
  mlx_dir: string;
  gguf_dir: string;
  llama_server: string;
  llama_port: number;
  mlx_port: number;
  mlx_python: string;
  mlx_external_url: string;
  ollama_host: string;
  default_model: string;
  bind_host: string;
  api_key: string;
};

export type HFSearchResult = {
  repo_id: string;
  name: string;
  author: string;
  downloads: number;
  likes: number;
  last_modified: string;
  tags: string[];
  pipeline_tag: string;
  size_bytes: number | null;
};

export type ScheduleRule = {
  id: string;
  model_id: string;
  days: number[]; // 0=Mon..6=Sun; [] = every day
  hour: number;
  minute: number;
  enabled: boolean;
  label: string;
};

export type DownloadJob = {
  job_id: string;
  repo_id: string;
  dest_dir: string;
  kind: string;
  status: "queued" | "downloading" | "done" | "error";
  progress: number;
  message: string;
  error: string;
  elapsed_s: number;
  total_bytes: number;
  downloaded_bytes: number;
};

export type ModelBenchmarkPoint = {
  run_id: string;
  created_at: string;
  run_name?: string;
  avg_tps: number | null;
  avg_ttft_ms: number | null;
  sample_count: number;
};

export type RegressionAlert = {
  current_avg_tps: number;
  baseline_avg_tps: number | null;
  baseline_run_count: number;
  delta_pct: number | null;
  is_regression: boolean;
};

export type Webhook = {
  id: string;
  url: string;
  events: string[];
  secret?: string | null;
  enabled: boolean;
  created_at: number;
};

export const WEBHOOK_EVENTS = ["model.loaded", "model.unloaded", "benchmark.done", "download.done"] as const;

export type ModelParams = {
  // Inference — all backends
  temperature?: number;
  max_tokens?: number;
  context_window?: number;
  top_k?: number;
  top_p?: number;
  min_p?: number;
  repetition_penalty?: number;
  presence_penalty?: number;
  // MLX-specific
  cache_limit_gb?: number;
  num_draft_tokens?: number;
  // GGUF-specific
  batch_size?: number;
  ubatch_size?: number;
  threads?: number;
  flash_attn?: boolean;
  cache_type_k?: string;
  cache_type_v?: string;
  // Auto-unload
  ttl_minutes?: number;
  // Extra passthrough args
  extra_args?: string[];
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json();
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status}`);
  return res.json();
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
  return res.json();
}

/** Returns a fetch Response for SSE streams — caller reads .body */
function stream(path: string, body?: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

export const api = {
  models: {
    list: () => get<ModelEntry[]>("/models"),
    refresh: () => post<ModelEntry[]>("/models/refresh"),
    stop: () => post<{ status: string }>("/models/stop"),
    load: (id: string) => stream(`/models/${encodeURIComponent(id)}/load`, {}),
    loadCompare: (id: string) => stream(`/models/${encodeURIComponent(id)}/load-compare`, {}),
    stopCompare: () => post<{ status: string }>("/models/compare/stop"),
    getParams: (id: string) => get<ModelParams>(`/models/${encodeURIComponent(id)}/params`),
    setParams: (id: string, params: ModelParams) => put<ModelParams>(`/models/${encodeURIComponent(id)}/params`, params),
    resetParams: (id: string) => del<{ status: string }>(`/models/${encodeURIComponent(id)}/params`),
    getNotes: (id: string) => get<{ notes: string; tags: string[] }>(`/models/${encodeURIComponent(id)}/notes`),
    setNotes: (id: string, notes: string, tags: string[]) =>
      put<{ notes: string; tags: string[] }>(`/models/${encodeURIComponent(id)}/notes`, { notes, tags }),
  },
  tags: {
    list: () => get<string[]>("/tags"),
  },
  schedules: {
    list: () => get<ScheduleRule[]>("/schedules"),
    create: (rule: Omit<ScheduleRule, "id">) => post<ScheduleRule>("/schedules", rule),
    update: (id: string, rule: Omit<ScheduleRule, "id">) => put<ScheduleRule>(`/schedules/${id}`, rule),
    delete: (id: string) => del<{ status: string }>(`/schedules/${id}`),
  },
  status: () => get<{
    active_model_id: string | null;
    compare_model_id: string | null;
    engine_state: string;
    memory_pressure: number | null;
    thermal_state: string;
    total_memory_bytes: number;
    available_memory_bytes: number;
  }>("/status"),
  chat: (body: { messages: ChatMessage[]; temperature: number; max_tokens: number }) =>
    stream("/chat", body),
  chatCompare: (body: { messages: ChatMessage[]; temperature: number; max_tokens: number }) =>
    stream("/chat/compare", body),
  benchmark: {
    prompts: () => get<BenchmarkPrompt[]>("/benchmark/prompts"),
    presets: () => get<Record<string, string[]>>("/benchmark/presets"),
    run: (config: BenchmarkConfig) => stream("/benchmark/run", config),
    history: () => get<unknown[]>("/benchmark/history"),
    getrun: (id: string) => get<unknown>(`/benchmark/run/${id}`),
    delete: (id: string) => del<{ status: string }>(`/benchmark/run/${id}`),
    modelHistory: (modelId: string, limit = 50) =>
      get<ModelBenchmarkPoint[]>(`/benchmark/model/${encodeURIComponent(modelId)}/history?limit=${limit}`),
  },
  hf: {
    search: (q: string, limit = 20) => get<HFSearchResult[]>(`/hf/search?q=${encodeURIComponent(q)}&limit=${limit}`),
    startDownload: (repo_id: string, kind: string, dest_dir?: string) =>
      post<{ job_id: string; status: string }>("/hf/download", { repo_id, kind, dest_dir }),
    listDownloads: () => get<DownloadJob[]>("/hf/downloads"),
    getDownload: (id: string) => get<DownloadJob>(`/hf/download/${id}`),
    streamDownload: (id: string) => stream(`/hf/download/${id}/stream`),
    cancelDownload: (id: string) => del<{ status: string }>(`/hf/download/${id}`),
    resumeDownload: (id: string) => post<{ job_id: string; status: string }>(`/hf/download/${id}/resume`),
    listPartial: () => get<{ local_dir: string; repo_id: string; kind: string; size_bytes: number }[]>("/hf/partial"),
  },
  params: {
    getDefaults: () => get<ModelParams>("/params/defaults"),
    setDefaults: (p: ModelParams) => put<ModelParams>("/params/defaults", p),
    resetDefaults: () => del<{ status: string }>("/params/defaults"),
  },
  settings: {
    get: () => get<CrucibleConfig>("/settings"),
    save: (cfg: CrucibleConfig) => put<CrucibleConfig>("/settings", cfg),
  },
  webhooks: {
    list: () => get<Webhook[]>("/webhooks"),
    create: (url: string, events: string[], secret?: string) =>
      post<Webhook>("/webhooks", { url, events, secret: secret || null }),
    update: (id: string, patch: Partial<Omit<Webhook, "id" | "created_at">>) =>
      put<Webhook>(`/webhooks/${id}`, patch),
    delete: (id: string) => del<{ status: string }>(`/webhooks/${id}`),
    test: (id: string) => post<{ status: string }>(`/webhooks/${id}/test`),
  },
};

/** Parse an SSE stream, calling onEvent for each parsed `data:` line. */
export async function readSSE(
  response: Response,
  onEvent: (data: Record<string, unknown>) => void,
  onError?: (err: Error) => void
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            onEvent(JSON.parse(line.slice(6)));
          } catch {
            // ignore malformed lines
          }
        }
      }
    }
  } catch (e) {
    onError?.(e as Error);
  } finally {
    reader.releaseLock();
  }
}
