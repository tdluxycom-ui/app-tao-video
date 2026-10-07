#!/usr/bin/env python3
"""
Backend startup script with UTF-8 encoding fix for Windows
"""
import sys
import os
from pathlib import Path

# Configure UTF-8 encoding for Windows
if sys.platform == "win32":
    import codecs
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "strict")
    sys.stderr = codecs.getwriter("utf-8")(sys.stderr.buffer, "strict")
    os.environ["PYTHONIOENCODING"] = "utf-8"
    os.environ["PYTHONUTF8"] = "1"

# Set PYTHONPATH to include MuseAI-API
root = Path(__file__).resolve().parent
muse_source = root / "vendor" / "MuseAI-API"
if muse_source.is_dir():
    sys.path.insert(0, str(muse_source))

# Import and run the backend
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        app_dir=str(root),
        host=os.environ.get("MUSE_BRIDGE_HOST", "127.0.0.1"),
        port=int(os.environ.get("MUSE_BRIDGE_PORT", "8787")),
        log_config=None,
    )
