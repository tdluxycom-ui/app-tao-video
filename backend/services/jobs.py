from __future__ import annotations
import asyncio, json, sqlite3
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterator, Literal

@dataclass
class VideoJob:
    id: str
    status: Literal["queued", "running", "completed", "failed"] = "queued"
    prompt: str = ""
    session_id: str | None = None
    files: list[Path] = field(default_factory=list)
    error: str | None = None
    user_id: str | None = None
    account_id: str | None = None
    task: asyncio.Task[None] | None = None
    created_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    # A legacy row has no checkpoint: it must never be automatically submitted again.
    phase: str = "legacy"
    image_paths: list[Path] = field(default_factory=list)
    baseline: list[str] = field(default_factory=list)
    timeout_seconds: int = 600
    request_id: str | None = None
    request_hash: str | None = None
    max_output_bytes: int = 256 * 1024 * 1024
    deleted: bool = False
    title: str = ""
    favorite: bool = False
    settings: dict = field(default_factory=dict)
    reference_names: list[str] = field(default_factory=list)


class JobStore:
    def __init__(self, path: Path) -> None:
        self.path = path

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS muse_video_jobs (
                    id TEXT PRIMARY KEY,
                    owner_user_id TEXT,
                    account_id TEXT,
                    status TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    session_id TEXT,
                    files_json TEXT NOT NULL,
                    error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(muse_video_jobs)")
            }
            if "owner_user_id" not in columns:
                connection.execute(
                    "ALTER TABLE muse_video_jobs ADD COLUMN owner_user_id TEXT"
                )
            if "account_id" not in columns:
                connection.execute(
                    "ALTER TABLE muse_video_jobs ADD COLUMN account_id TEXT"
                )
            if "checkpoint_json" not in columns:
                connection.execute("ALTER TABLE muse_video_jobs ADD COLUMN checkpoint_json TEXT NOT NULL DEFAULT '{}'")

    def save(self, job: VideoJob) -> None:
        self.initialize()
        job.updated_at = datetime.now(UTC).isoformat()
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO muse_video_jobs
                    (id, owner_user_id, account_id, status, prompt, session_id, files_json, error, created_at, updated_at, checkpoint_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    owner_user_id = excluded.owner_user_id,
                    account_id = excluded.account_id,
                    status = excluded.status,
                    prompt = excluded.prompt,
                    session_id = excluded.session_id,
                    files_json = excluded.files_json,
                    error = excluded.error,
                    updated_at = excluded.updated_at,
                    checkpoint_json = excluded.checkpoint_json
                """,
                (
                    job.id,
                    job.user_id,
                    job.account_id,
                    job.status,
                    job.prompt,
                    job.session_id,
                    json.dumps([str(path) for path in job.files]),
                    job.error,
                    job.created_at,
                    job.updated_at,
                    json.dumps({
                        "phase": job.phase, "image_paths": [str(p) for p in job.image_paths],
                        "baseline": job.baseline, "timeout_seconds": job.timeout_seconds,
                        "request_id": job.request_id, "request_hash": job.request_hash,
                        "max_output_bytes": job.max_output_bytes, "deleted": job.deleted,
                        "title": job.title, "favorite": job.favorite,
                        "settings": job.settings, "reference_names": job.reference_names,
                    }),
                ),
            )

    def load(self) -> list[VideoJob]:
        self.initialize()
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM muse_video_jobs ORDER BY created_at DESC"
            ).fetchall()
        return [
            VideoJob(
                id=row["id"],
                status=row["status"],
                prompt=row["prompt"],
                user_id=row["owner_user_id"],
                account_id=row["account_id"],
                session_id=row["session_id"],
                files=[Path(path) for path in json.loads(row["files_json"])],
                error=row["error"],
                created_at=row["created_at"],
                updated_at=row["updated_at"],
                **self._checkpoint(row["checkpoint_json"]),
            )
            for row in rows
        ]

    @staticmethod
    def _checkpoint(raw: str) -> dict:
        data = json.loads(raw)
        allowed = {"phase", "baseline", "timeout_seconds", "request_id", "request_hash", "max_output_bytes", "deleted", "title", "favorite", "settings", "reference_names"}
        return {**{k: v for k, v in data.items() if k in allowed},
                "image_paths": [Path(p) for p in data.get("image_paths", [])]}


