from __future__ import annotations

import os
from pathlib import Path

import uvicorn

root = Path(__file__).resolve().parent
env_file = root / ".env"
if env_file.is_file():
    for line in env_file.read_text(encoding="utf-8").splitlines():
        entry = line.strip()
        if not entry or entry.startswith("#") or "=" not in entry:
            continue
        name, value = entry.split("=", 1)
        os.environ.setdefault(name.strip(), value.strip().strip("\"'"))

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(root / ".playwright-browsers"))
uvicorn.run(
    "main:app",
    app_dir=str(root),
    host=os.environ.get("MUSE_BRIDGE_HOST", "127.0.0.1"),
    port=int(os.environ.get("MUSE_BRIDGE_PORT", "8787")),
)
