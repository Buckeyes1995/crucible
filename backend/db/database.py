import aiosqlite
from pathlib import Path
from typing import AsyncGenerator

DB_PATH = Path.home() / ".config" / "crucible" / "crucible.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS benchmark_runs (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    name TEXT,
    config_json TEXT NOT NULL,
    summary_json TEXT
);

CREATE TABLE IF NOT EXISTS benchmark_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT REFERENCES benchmark_runs(id) ON DELETE CASCADE,
    model_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    backend_kind TEXT NOT NULL,
    prompt_id TEXT NOT NULL,
    prompt_text TEXT NOT NULL,
    rep INTEGER NOT NULL,
    metrics_json TEXT NOT NULL,
    response_text TEXT
);


CREATE INDEX IF NOT EXISTS idx_results_run_id ON benchmark_results(run_id);
CREATE INDEX IF NOT EXISTS idx_results_model_id ON benchmark_results(model_id);

CREATE TABLE IF NOT EXISTS arena_battles (
    id TEXT PRIMARY KEY,
    model_a TEXT NOT NULL,
    model_b TEXT NOT NULL,
    prompt TEXT NOT NULL,
    response_a TEXT,
    response_b TEXT,
    winner TEXT,
    elo_before_a REAL,
    elo_before_b REAL,
    elo_after_a REAL,
    elo_after_b REAL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    title TEXT,
    model_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);

CREATE TABLE IF NOT EXISTS inference_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    prompt_tokens INTEGER,
    output_tokens INTEGER,
    total_ms REAL,
    ttft_ms REAL,
    prefill_ms REAL,
    decode_ms REAL,
    tps REAL,
    prompt_tps REAL,
    memory_pressure_start REAL,
    memory_pressure_end REAL,
    thermal_state TEXT,
    dflash_enabled INTEGER DEFAULT 0,
    source TEXT DEFAULT 'chat'
);

CREATE INDEX IF NOT EXISTS idx_profiles_model ON inference_profiles(model_id);
CREATE INDEX IF NOT EXISTS idx_profiles_created ON inference_profiles(created_at);

CREATE TABLE IF NOT EXISTS arena_elo (
    model_id TEXT PRIMARY KEY,
    elo REAL NOT NULL DEFAULT 1500,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    ties INTEGER NOT NULL DEFAULT 0,
    battles INTEGER NOT NULL DEFAULT 0,
    last_battle_at TEXT
);

-- Projects (Roadmap v4 #4) — a scope for chats + snippets + settings.
-- Null project_id on existing rows = "uncategorized" / default bucket.
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT,
    default_model_id TEXT,
    system_prompt TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Agent runs (Roadmap v4 #1) — ReAct loop over MCP tools.
-- One row per run; agent_steps holds the trace.
CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    goal TEXT NOT NULL,
    model_id TEXT,
    project_id TEXT,
    status TEXT NOT NULL DEFAULT 'running',     -- running | done | error | cancelled
    tool_allowlist_json TEXT,                    -- ["fs","git",...] of mcp ids; null = all installed
    max_steps INTEGER NOT NULL DEFAULT 12,
    max_tokens INTEGER NOT NULL DEFAULT 2048,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    elapsed_ms REAL NOT NULL DEFAULT 0,
    final_answer TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_created ON agent_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_project ON agent_runs(project_id);

CREATE TABLE IF NOT EXISTS agent_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL,
    kind TEXT NOT NULL,            -- 'thought' | 'tool_call' | 'tool_result' | 'final' | 'error'
    name TEXT,                     -- tool name for tool_call / tool_result
    input_json TEXT,
    output_json TEXT,
    error TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    tokens INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_steps(run_id);

-- Prompt IDE (Roadmap v4 #10) — prompts as first-class versioned artifacts.
-- prompt_docs = the named prompt; prompt_versions = git-blob-style versions.
-- prompt_test_sets = saved {input, expected} pairs for A/B runs.
CREATE TABLE IF NOT EXISTS prompt_docs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    project_id TEXT,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prompt_docs_project ON prompt_docs(project_id);

CREATE TABLE IF NOT EXISTS prompt_versions (
    id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL REFERENCES prompt_docs(id) ON DELETE CASCADE,
    parent_version_id TEXT,
    content TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_doc ON prompt_versions(doc_id);

CREATE TABLE IF NOT EXISTS prompt_test_sets (
    id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL REFERENCES prompt_docs(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    inputs_json TEXT NOT NULL,   -- [{input: str, expected?: str}, ...]
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prompt_test_sets_doc ON prompt_test_sets(doc_id);

CREATE TABLE IF NOT EXISTS prompt_ab_runs (
    id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL REFERENCES prompt_docs(id) ON DELETE CASCADE,
    version_a_id TEXT NOT NULL,
    version_b_id TEXT NOT NULL,
    test_set_id TEXT,
    model_id TEXT,
    results_json TEXT NOT NULL,       -- [{input, a_output, b_output, a_tokens, b_tokens}]
    summary_json TEXT NOT NULL,       -- {a_avg_tokens, b_avg_tokens, n, ...}
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prompt_ab_runs_doc ON prompt_ab_runs(doc_id);

-- Automation / triggers (Roadmap v4 #8) — cron + condition-matched actions.
CREATE TABLE IF NOT EXISTS automation_triggers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    condition_type TEXT NOT NULL,       -- 'cron' | 'memory_pressure' | 'model_loaded' | 'hf_update_available'
    condition_args_json TEXT NOT NULL,
    action_type TEXT NOT NULL,          -- 'notify' | 'load_model' | 'unload_model' | 'run_benchmark' | 'webhook'
    action_args_json TEXT NOT NULL,
    last_fired_at TEXT,
    last_error TEXT,
    fire_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_fires (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger_id TEXT NOT NULL REFERENCES automation_triggers(id) ON DELETE CASCADE,
    fired_at TEXT NOT NULL,
    status TEXT NOT NULL,               -- 'ok' | 'error'
    message TEXT
);

CREATE INDEX IF NOT EXISTS idx_automation_fires_trigger ON automation_fires(trigger_id);
CREATE INDEX IF NOT EXISTS idx_automation_fires_time ON automation_fires(fired_at);

-- Fine-tuning jobs (Roadmap v4 #7 scaffold) — metadata + loss curve only.
-- Actual training shells out to mlx_lm.lora or similar; for now the row
-- tracks config + status + captured stdout lines.
CREATE TABLE IF NOT EXISTS finetune_jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_model_id TEXT NOT NULL,
    dataset_path TEXT NOT NULL,
    lora_rank INTEGER NOT NULL DEFAULT 8,
    lora_alpha INTEGER NOT NULL DEFAULT 16,
    learning_rate REAL NOT NULL DEFAULT 1e-4,
    max_steps INTEGER NOT NULL DEFAULT 200,
    status TEXT NOT NULL DEFAULT 'draft',   -- 'draft' | 'queued' | 'running' | 'done' | 'error' | 'cancelled'
    adapter_path TEXT,
    log_path TEXT,
    train_loss_json TEXT,                   -- [[step, loss], ...]
    eval_loss_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_finetune_jobs_created ON finetune_jobs(created_at);
"""


async def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(SCHEMA)
        # Lightweight migrations — each wrapped in try/except so
        # repeated boots on an already-migrated DB are no-ops.
        for stmt in (
            "ALTER TABLE benchmark_results ADD COLUMN response_text TEXT",
            "ALTER TABLE arena_battles ADD COLUMN norm_mode TEXT DEFAULT 'per_model'",
            "ALTER TABLE arena_battles ADD COLUMN extra_slots_json TEXT",
            # v3 chat-session additions — tags + pinned for better history management.
            "ALTER TABLE chat_sessions ADD COLUMN tags_json TEXT",
            "ALTER TABLE chat_sessions ADD COLUMN pinned INTEGER DEFAULT 0",
            # v4 #4 — projects scope.
            "ALTER TABLE chat_sessions ADD COLUMN project_id TEXT",
            "CREATE INDEX IF NOT EXISTS idx_chat_sessions_project ON chat_sessions(project_id)",
        ):
            try:
                await db.execute(stmt)
                await db.commit()
            except Exception:
                pass  # column already exists


async def get_db() -> AsyncGenerator[aiosqlite.Connection, None]:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        yield db
