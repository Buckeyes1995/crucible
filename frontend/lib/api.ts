const BASE = "/api";

export type ModelEntry = {
  id: string;
  name: string;
  kind: "mlx" | "gguf" | "ollama" | "mlx_studio" | "vllm";
  path?: string;
  size_bytes?: number;
  context_window?: number;
  quant?: string;
  backend_meta?: Record<string, unknown>;
  avg_tps?: number;
  last_loaded?: string;
  hidden?: boolean;
  node?: string;  // "local" or remote node name
  dflash_draft?: string;   // path to DFlash draft model (null = not eligible)
  dflash_enabled?: boolean; // whether DFlash is currently enabled
  available_engines?: string[];       // engines capable of running this model
  preferred_engine?: string | null;   // user-set engine preference
  available_draft_repo?: string | null; // z-lab HF repo ID for an un-downloaded matching draft
  origin_repo?: string | null;          // HF repo we downloaded this from
  update_available?: boolean;           // upstream HF repo has been updated since we downloaded
  upstream_last_modified?: string | null; // ISO-8601 from HF
};

export type ChatMessage = { role: string; content: string };

export type BenchmarkPrompt = {
  id: string;
  category: string;
  text: string;
  estimated_tokens?: number;
};

export type MarketplacePrompt = {
  id: string;
  category: string;
  text: string;
  author?: string;
  tags?: string[];
};

export type MarketplaceData = {
  version: number;
  updated: string;
  prompts: MarketplacePrompt[];
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

export type DFlashStatus = {
  eligible: boolean;
  enabled: boolean;
  draft_model?: string;
  draft_quant_bits?: number;
};

export type DFlashToggleResult = {
  model_id: string;
  dflash_enabled: boolean;
  draft_model: string;
  settings: Record<string, unknown>;
};

export type ArenaBattle = { battle_id: string; status: string };
export type ArenaVoteResult = {
  model_a: string; model_b: string; winner: string;
  elo_before: { a: number; b: number };
  elo_after: { a: number; b: number };
};
export type ArenaLeaderboardEntry = {
  model_id: string; elo: number; wins: number; losses: number;
  ties: number; battles: number; win_rate: number;
};
export type ArenaBattleHistory = {
  id: string; model_a: string; model_b: string; prompt: string;
  winner: string; elo_before_a: number; elo_before_b: number;
  elo_after_a: number; elo_after_b: number; created_at: string;
};

export type NodeConfig = {
  name: string;
  url: string;
  api_key: string;
};

export type NodeStatus = {
  name: string;
  url: string;
  status: "online" | "offline";
  model_count: number;
  active_model_id: string | null;
  memory_pressure?: number;
  thermal_state?: string;
};

export type CrucibleConfig = {
  mlx_dir: string;
  gguf_dir: string;
  llama_server: string;
  llama_port: number;
  llama_compare_port: number;
  mlx_port: number;
  mlx_python: string;
  mlx_external_url: string;
  ollama_host: string;
  mlx_studio_url: string;
  default_model: string;
  bind_host: string;
  api_key: string;
  nodes: NodeConfig[];
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
  local_dir?: string;
  kind: string;
  status: "queued" | "downloading" | "done" | "error" | "cancelled";
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

export type FinetuneJob = {
  id: string;
  model_id: string;
  data_path: string;
  output_dir: string;
  num_iters: number;
  learning_rate: number;
  lora_rank: number;
  batch_size: number;
  grad_checkpoint: boolean;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  error: string;
  loss_log: { iter: number; loss: number; val_loss: number | null }[];
};

export type AgentListEntry = {
  name: string;
  url: string;
  kind: string;
  reachable: boolean;
  error?: string;
  health?: {
    status: string;
    version: string;
    host: string;
    uptime_s: number;
    container_exists: boolean;
    container_running: boolean;
  };
};

export type AgentSession = {
  id: string;
  source: "chat" | "cron" | "interactive" | string;
  updated_at: string;
  size_bytes: number;
  title: string | null;
  message_count: number | null;
};

export type AgentCronJob = {
  id: string;
  name: string;
  schedule: string;
  command: string;
  script?: string | null;
  enabled: boolean;
  state?: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  last_status: string | null;
  last_error?: string | null;
};

export type AgentStatus = {
  container: {
    exists: boolean;
    running: boolean;
    paused: boolean;
    restarting: boolean;
    status: string;
    started_at: string | null;
    restart_count: number;
    restart_policy: string;
    image: string;
    pid: number | null;
  };
  hermes: {
    paused: boolean;
    last_tick_at: string | null;
    recent_sessions: AgentSession[];
  };
  cron: { job_count: number; jobs: AgentCronJob[] };
  state_db: { exists: boolean; tables?: string[]; size_bytes?: number };
  config: { exists: boolean; size_bytes?: number; updated_at?: string };
  orphans: { name: string; status: string; state: string; id: string }[];
};

export type PromptTemplate = {
  id: string;
  name: string;
  content: string;
  description: string;
  created_at: string;
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
  enable_thinking?: boolean;  // Qwen3.5/3.6: false skips <think> reasoning output
  preserve_thinking?: boolean;  // Qwen3.5/3.6: keep prior-turn <think> in multi-turn prompts
  // MLX-specific
  cache_limit_gb?: number;
  num_draft_tokens?: number;
  draft_model?: string;  // path to small draft model for speculative decoding
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
function stream(path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
}

export const api = {
  models: {
    list: () => get<ModelEntry[]>("/models"),
    refresh: () => post<ModelEntry[]>("/models/refresh"),
    stop: () => post<{ status: string }>("/models/stop"),
    load: (id: string, signal?: AbortSignal, engine?: string) => {
      const qs = engine ? `?engine=${encodeURIComponent(engine)}` : "";
      return stream(`/models/${encodeURIComponent(id)}/load${qs}`, {}, signal);
    },
    loadCompare: (id: string, engine?: string) => {
      const qs = engine ? `?engine=${encodeURIComponent(engine)}` : "";
      return stream(`/models/${encodeURIComponent(id)}/load-compare${qs}`, {});
    },
    stopCompare: () => post<{ status: string }>("/models/compare/stop"),
    getParams: (id: string) => get<ModelParams>(`/models/${encodeURIComponent(id)}/params`),
    setParams: (id: string, params: ModelParams) => put<ModelParams>(`/models/${encodeURIComponent(id)}/params`, params),
    resetParams: (id: string) => del<{ status: string }>(`/models/${encodeURIComponent(id)}/params`),
    getNotes: (id: string) => get<{ notes: string; tags: string[]; preferred_engine?: string | null }>(`/models/${encodeURIComponent(id)}/notes`),
    setNotes: (id: string, notes: string, tags: string[]) =>
      put<{ notes: string; tags: string[] }>(`/models/${encodeURIComponent(id)}/notes`, { notes, tags }),
    setHidden: (id: string, hidden: boolean) =>
      put<{ hidden: boolean }>(`/models/${encodeURIComponent(id)}/hidden`, { hidden }),
    setPreferredEngine: (id: string, engine: string | null) =>
      put<{ preferred_engine: string | null }>(`/models/${encodeURIComponent(id)}/preferred-engine`, { engine }),
    deleteFromDisk: (id: string) =>
      del<{ deleted: string; model_id: string }>(`/models/${encodeURIComponent(id)}/disk`),
  },
  tags: {
    list: () => get<string[]>("/tags"),
  },
  zlab: {
    listDrafts: () => get<{ cache: { fetched_at: number; age_seconds: number | null; repo_count: number; draft_count: number }; drafts: Array<{ id: string; lastModified: string; downloads: number; tags: string[] }>; all_repos: unknown[] }>("/zlab/drafts"),
    refreshDrafts: () => post<{ cache: unknown; draft_count: number }>("/zlab/drafts/refresh"),
    downloadDraft: (repo_id: string) => post<{ job_id: string; repo_id: string }>("/zlab/drafts/download", { repo_id }),
  },
  hfUpdates: {
    list: () => get<{ state: Record<string, { origin_repo?: string; downloaded_at?: number; upstream_last_modified?: string; last_checked?: number; update_available?: boolean }>; update_available_count: number }>("/hf-updates"),
    refresh: () => post<{ newly_flagged: string[]; state: Record<string, unknown> }>("/hf-updates/refresh"),
    getOriginRepo: (id: string) => get<{ origin_repo?: string; downloaded_at?: number; upstream_last_modified?: string; last_checked?: number; update_available?: boolean }>(`/models/${encodeURIComponent(id)}/origin-repo`),
    setOriginRepo: (id: string, repo_id: string | null) =>
      put<{ origin_repo?: string }>(`/models/${encodeURIComponent(id)}/origin-repo`, { repo_id }),
  },
  schedules: {
    list: () => get<ScheduleRule[]>("/schedules"),
    create: (rule: Omit<ScheduleRule, "id">) => post<ScheduleRule>("/schedules", rule),
    update: (id: string, rule: Omit<ScheduleRule, "id">) => put<ScheduleRule>(`/schedules/${id}`, rule),
    delete: (id: string) => del<{ status: string }>(`/schedules/${id}`),
  },
  nodes: {
    list: () => get<NodeStatus[]>("/nodes"),
  },
  arena: {
    startBattle: () => post<ArenaBattle>("/arena/battle"),
    chat: (battleId: string, body: { prompt: string; temperature?: number; max_tokens?: number }, signal?: AbortSignal) =>
      stream(`/arena/battle/${battleId}/chat`, body, signal),
    vote: (battleId: string, winner: string) =>
      post<ArenaVoteResult>(`/arena/battle/${battleId}/vote`, { winner }),
    leaderboard: () => get<ArenaLeaderboardEntry[]>("/arena/leaderboard"),
    history: (limit?: number) => get<ArenaBattleHistory[]>(`/arena/history?limit=${limit ?? 50}`),
  },
  memPlan: {
    plan: (model_ids: string[]) =>
      post<{
        total_bytes: number; available_bytes: number;
        system_headroom_bytes: number; budget_bytes: number;
        required_bytes: number; headroom_bytes: number;
        fits: boolean;
        models: { id: string; name: string; kind: string; size_bytes: number; overhead_bytes: number }[];
        overhead_per_model_bytes: number;
      }>("/mem-plan", { model_ids }),
  },
  output: {
    save: (body: { source: "arena" | "diff" | "chat"; run_id: string; subdir?: string; filename: string; content: string }) =>
      post<{ status: string; path: string; bytes: number }>("/output/save", body),
    reveal: (body: { source: "arena" | "diff" | "chat"; run_id: string }) =>
      post<{ status: string; path: string }>("/output/reveal", body),
    list: (source: string, runId: string) =>
      get<{ path: string; files: { name: string; bytes: number; modified: number }[] }>(
        `/output/list?source=${encodeURIComponent(source)}&run_id=${encodeURIComponent(runId)}`,
      ),
  },
  dflash: {
    get: (id: string) => get<DFlashStatus>(`/models/${encodeURIComponent(id)}/dflash`),
    toggle: (id: string, enabled: boolean, draftQuantBits?: number) =>
      put<DFlashToggleResult>(`/models/${encodeURIComponent(id)}/dflash`, {
        enabled,
        draft_quant_bits: draftQuantBits ?? 4,
      }),
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
  chat: (body: { messages: ChatMessage[]; temperature: number; max_tokens: number; rag_session_id?: string }) =>
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
    deleteAll: () => del<{ status: string; count: number }>("/benchmark/history"),
    modelHistory: (modelId: string, limit = 50) =>
      get<ModelBenchmarkPoint[]>(`/benchmark/model/${encodeURIComponent(modelId)}/history?limit=${limit}`),
    marketplace: () => get<MarketplaceData>("/benchmark/marketplace"),
  },
  hf: {
    search: (q: string, limit = 20) => get<HFSearchResult[]>(`/hf/search?q=${encodeURIComponent(q)}&limit=${limit}`),
    startDownload: (repo_id: string, kind: string, dest_dir?: string) =>
      post<{ job_id: string; status: string }>("/hf/download", { repo_id, kind, dest_dir }),
    listDownloads: () => get<DownloadJob[]>("/hf/downloads"),
    clearHistory: () => del<{ status: string; removed: number }>("/hf/downloads/history"),
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
  admin: {
    resetBackends: () => post<{ status: string; steps: string[] }>("/admin/reset-backends"),
  },
  agents: {
    list: () => get<AgentListEntry[]>("/agents"),
    add: (body: { name: string; url: string; api_key?: string; kind?: string }) =>
      post<{ status: string; name: string }>("/agents", body),
    update: (name: string, body: { name: string; url: string; api_key?: string; kind?: string }) =>
      put<{ status: string; name: string }>(`/agents/${encodeURIComponent(name)}`, body),
    remove: (name: string) => del<{ status: string; name: string }>(`/agents/${encodeURIComponent(name)}`),
    status: (name: string) => get<AgentStatus>(`/agents/${encodeURIComponent(name)}/status`),
    cron: (name: string) => get<{ jobs: AgentCronJob[]; last_tick_at: string | null }>(`/agents/${encodeURIComponent(name)}/cron`),
    sessions: (name: string, limit = 50, offset = 0) =>
      get<AgentSession[]>(`/agents/${encodeURIComponent(name)}/sessions?limit=${limit}&offset=${offset}`),
    session: (name: string, id: string) =>
      get<Record<string, unknown>>(`/agents/${encodeURIComponent(name)}/sessions/${encodeURIComponent(id)}`),
    logs: (name: string, tail = 500, since?: string) =>
      get<{ lines: string[]; tail: number; since: string | null }>(
        `/agents/${encodeURIComponent(name)}/logs?tail=${tail}${since ? `&since=${encodeURIComponent(since)}` : ""}`,
      ),
    pause: (name: string) => post<{ ok: boolean }>(`/agents/${encodeURIComponent(name)}/pause`),
    resume: (name: string) => post<{ ok: boolean }>(`/agents/${encodeURIComponent(name)}/resume`),
    restart: (name: string) => post<{ ok: boolean }>(`/agents/${encodeURIComponent(name)}/restart`),
    pruneOrphans: (name: string) =>
      post<{ removed: string[]; skipped: number }>(`/agents/${encodeURIComponent(name)}/orphans/prune`),
    chat: (name: string, body: { prompt: string; session_id?: string | null; max_turns?: number; skills?: string[] }, signal?: AbortSignal) =>
      stream(`/agents/${encodeURIComponent(name)}/chat`, body, signal),
  },
  rag: {
    info: (sessionId: string) => get<{ chunk_count: number; files: Record<string, number> }>(`/rag/${sessionId}/info`),
    clear: (sessionId: string) => del<{ status: string }>(`/rag/${sessionId}`),
    addText: (sessionId: string, name: string, text: string) =>
      post<{ status: string; chunks_added: number; chunk_count: number; files: Record<string, number> }>(
        "/rag/add-text", { session_id: sessionId, name, text }
      ),
    addPath: (sessionId: string, path: string) =>
      post<{ status: string; chunks_added: number; chunk_count: number; files: Record<string, number> }>(
        "/rag/add-path", { session_id: sessionId, path }
      ),
    upload: async (sessionId: string, file: File) => {
      const form = new FormData();
      form.append("session_id", sessionId);
      form.append("file", file);
      const res = await fetch(`${BASE}/rag/upload?session_id=${encodeURIComponent(sessionId)}`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      return res.json() as Promise<{ status: string; chunks_added: number; chunk_count: number; files: Record<string, number> }>;
    },
  },
  finetune: {
    list: () => get<FinetuneJob[]>("/finetune/jobs"),
    create: (body: {
      model_id: string; data_path: string; output_dir: string;
      num_iters?: number; learning_rate?: number; lora_rank?: number;
      batch_size?: number; grad_checkpoint?: boolean;
    }) => post<FinetuneJob>("/finetune/jobs", body),
    run: (id: string) => stream(`/finetune/jobs/${id}/run`, {}),
    cancel: (id: string) => post<{ status: string }>(`/finetune/jobs/${id}/cancel`),
    delete: (id: string) => del<{ status: string }>(`/finetune/jobs/${id}`),
  },
  templates: {
    list: () => get<PromptTemplate[]>("/templates"),
    create: (name: string, content: string, description?: string) =>
      post<PromptTemplate>("/templates", { name, content, description: description || "" }),
    update: (id: string, patch: Partial<Pick<PromptTemplate, "name" | "content" | "description">>) =>
      put<PromptTemplate>(`/templates/${id}`, patch),
    delete: (id: string) => del<{ status: string }>(`/templates/${id}`),
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
