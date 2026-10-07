"""Small per-user workspace state: text drafts and notification read position."""
import json
from pathlib import Path
import sqlite3
from contextlib import closing

class StudioStore:
    def __init__(self, path: Path):
        self.path = path

    def get(self, user_id: str) -> dict:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path)) as db:
            db.execute('CREATE TABLE IF NOT EXISTS studio_workspace (user_id TEXT PRIMARY KEY, data TEXT NOT NULL)')
            db.commit()
            row=db.execute('SELECT data FROM studio_workspace WHERE user_id=?',(user_id,)).fetchone()
        return json.loads(row[0]) if row else {}

    def save(self, user_id: str, data: dict) -> dict:
        self.get(user_id)
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('INSERT INTO studio_workspace VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data',
                       (user_id,json.dumps(data,ensure_ascii=False)))
        return data
