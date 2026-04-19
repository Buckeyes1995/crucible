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
