import sys
import os
from pathlib import Path

# Configure UTF-8
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    os.environ["PYTHONIOENCODING"] = "utf-8"
    os.environ["PYTHONUTF8"] = "1"

# Fix certifi path issue
import certifi
certifi_path = certifi.where()
print(f"Certifi path: {certifi_path}")

ROOT = Path(__file__).resolve().parent
MUSE_SOURCE = ROOT / "vendor" / "MuseAI-API"
sys.path.insert(0, str(MUSE_SOURCE))

import asyncio
from muse_ai import MuseAuth

async def test():
    try:
        auth = MuseAuth(state_dir=ROOT / ".muse-state")
        await auth.restart_login()
        print("Restart login OK")
        result = await auth.send_otp("test@example.com", region="VN")
        print(f"Send OTP result: {result}")
    except Exception as e:
        print(f"Error: {e}")
        print(f"Error type: {type(e)}")
        print(f"Error repr: {repr(e)}")

if __name__ == "__main__":
    asyncio.run(test())
