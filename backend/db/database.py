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
"""


async def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(SCHEMA)
        # Migrate: add response_text if this is an existing DB without it
        try:
            await db.execute("ALTER TABLE benchmark_results ADD COLUMN response_text TEXT")
            await db.commit()
        except Exception:
            pass  # column already exists


async def get_db() -> AsyncGenerator[aiosqlite.Connection, None]:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        yield db
