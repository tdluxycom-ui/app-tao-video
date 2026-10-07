from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import hmac
import ipaddress
import json
import logging
import os
import re
import secrets
import sqlite3
import sys
import socket
import tempfile
import time
import uuid
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from typing import Iterator, Literal
from urllib.parse import unquote
from urllib.parse import urlsplit

# Configure Windows console streams BEFORE anything else
if sys.platform == "win32":
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="backslashreplace")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    force=True,
)
logging.getLogger("curl_cffi").setLevel(logging.WARNING)

ROOT = Path(__file__).resolve().parent
MUSE_SOURCE = ROOT / "vendor" / "MuseAI-API"
if not MUSE_SOURCE.is_dir():
    raise RuntimeError("Muse client source is missing from backend/vendor/MuseAI-API.")
sys.path.insert(0, str(MUSE_SOURCE))
sys.path.insert(0, str(ROOT / ".venv" / "Lib" / "site-packages"))

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from cryptography.fernet import Fernet, InvalidToken
from muse_ai import MuseAuth, MuseClient
from muse_ai.errors import MuseError
from muse_ai.media import ImageRef, extract_image_refs, extract_session_ids
from PIL import Image, ImageEnhance, ImageFilter, ImageOps, UnidentifiedImageError
from playwright.async_api import Browser, BrowserContext, Page, Playwright, async_playwright
from pydantic import BaseModel, Field

if __package__:
    from .services.accounts import UserStore
    from .services.jobs import JobStore, VideoJob
    from .services import limits, video_engine
    from .services.worker_lease import WorkerLease
    from .services.studio import StudioStore
else:
    from services.accounts import UserStore
    from services.jobs import JobStore, VideoJob
    from services import limits, video_engine
    from services.worker_lease import WorkerLease
    from services.studio import StudioStore

logger = logging.getLogger("sangtao.muse")

STATE_DIR = Path(os.environ.get("MUSE_STATE_DIR", ROOT / ".muse-state"))
OUTPUT_DIR = Path(os.environ.get("MUSE_OUTPUT_DIR", ROOT / "outputs"))
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_IMAGE_BYTES = 16 * 1024 * 1024
MAX_PUBLISHER_MEDIA_BYTES = 250 * 1024 * 1024
MAX_MUSE_IMAGE_OUTPUTS = 6
MAX_MUSE_IMAGE_OUTPUT_BYTES = 24 * 1024 * 1024
MAX_MUSE_IMAGE_PREVIEW_BYTES = 450_000
ALLOWED_IMAGE_FORMATS = {
    "JPEG": ".jpg",
    "PNG": ".png",
    "WEBP": ".webp",
    "GIF": ".gif",
}
BRIDGE_TOKEN = os.environ.get("MUSE_BRIDGE_TOKEN")
ACCESS_PASSWORD = os.environ.get("TDLUXY_ACCESS_PASSWORD")
AUTH_DB = STATE_DIR / "tdluxy.sqlite3"
ACCESS_SESSION_COOKIE = "tdluxy_access"
ACCESS_SESSION_MAX_AGE = 12 * 60 * 60
ACCESS_SESSION_SECRET = secrets.token_bytes(32)
PROCESS_STARTED_AT = time.monotonic()
access_login_attempts: dict[str, list[float]] = {}
account_login_attempts: dict[str, list[float]] = {}
PASSWORD_ITERATIONS = 310_000


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=12, max_length=256)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class OtpRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    account_id: str | None = Field(default=None, max_length=64)


class OtpVerifyRequest(BaseModel):
    account_id: str = Field(min_length=1, max_length=64)
    code: str = Field(min_length=4, max_length=12)


class MuseAccountActivationRequest(BaseModel):
    active: bool


class PublisherStartRequest(BaseModel):
    platform: Literal["tiktok", "youtube"]


class PublisherInputRequest(BaseModel):
    action: Literal["click", "type", "press", "scroll", "back", "reload"]
    x: int | None = Field(default=None, ge=0, le=1280)
    y: int | None = Field(default=None, ge=0, le=800)
    text: str | None = Field(default=None, max_length=2500)
    key: str | None = Field(default=None, max_length=24)
    delta_y: int = Field(default=0, ge=-1200, le=1200)

class AccessLoginRequest(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class ImageInput(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    base64: str = Field(min_length=1, max_length=11_184_812)


class ChatRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=8000)
    session_id: str | None = Field(default=None, max_length=256)


class VideoSettings(BaseModel):
    industry: str = Field(default="", max_length=80)
    goal: str = Field(default="", max_length=1000)
    audience: str = Field(default="", max_length=1000)


class VideoRequest(ChatRequest):
    settings: VideoSettings = Field(default_factory=VideoSettings)
    request_id: str | None = Field(default=None, min_length=8, max_length=100)
    images: list[ImageInput] = Field(default_factory=list, max_length=4)
    timeout_seconds: int = Field(default=600, ge=30, le=900)


class ImageEditRequest(BaseModel):
    image: ImageInput
    preset: Literal["clean", "warm", "mono"] = "clean"


class WorkspaceDraft(BaseModel):
    videoPrompt: str = Field(default="", max_length=8000)
    chatDraft: str = Field(default="", max_length=8000)
    brief: str = Field(default="", max_length=8000)
    industry: str = Field(default="", max_length=80)
    goal: str = Field(default="", max_length=1000)
    audience: str = Field(default="", max_length=1000)


class WorkspaceUpdate(BaseModel):
    draft: WorkspaceDraft = Field(default_factory=WorkspaceDraft)
    read_at: str = Field(default="", max_length=40)


class JobMetadataUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=120)
    favorite: bool | None = None


class CollageRequest(BaseModel):
    images: list[ImageInput] = Field(min_length=2, max_length=4)


@dataclass
class MuseAccountRuntime:
    id: str
    email: str
    client: MuseClient
    temp_dir: tempfile.TemporaryDirectory[str]
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


@dataclass
class PublisherSession:
    user_id: str
    platform: str
    context: BrowserContext
    page: Page
    media_dir: Path
    latest_upload: Path | None = None


@dataclass
class PendingMuseAuth:
    email: str
    auth: MuseAuth
    temp_dir: tempfile.TemporaryDirectory[str]


@dataclass
class BridgeState:
    client: MuseClient | None = None
    pending_auth: dict[str, PendingMuseAuth] = field(default_factory=dict)
    muse_accounts: dict[str, MuseAccountRuntime] = field(default_factory=dict)
    publisher_sessions: dict[str, PublisherSession] = field(default_factory=dict)
    playwright: Playwright | None = None
    browser: Browser | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    video_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    jobs: dict[str, VideoJob] = field(default_factory=dict)
    download_grants: dict[str, tuple[str, int, float]] = field(default_factory=dict)
    image_grants: dict[str, tuple[str, Path, str, float]] = field(default_factory=dict)


state = BridgeState()
video_limits = limits.VideoLimits.from_env()
admission_lock = asyncio.Lock()
account_connect_locks: dict[str, asyncio.Lock] = {}
job_store = JobStore(STATE_DIR / "jobs.sqlite3")
user_store = UserStore(AUTH_DB)


def _bearer_token(request: Request) -> str | None:
    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def _request_user(request: Request) -> dict:
    user = getattr(request.state, "user", None)
    if user is None:
        raise HTTPException(status_code=401, detail="Hãy đăng nhập TDLUXY để tiếp tục.")
    return user


def _require_job_owner(job: VideoJob, request: Request) -> None:
    user = _request_user(request)
    if user["role"] != "admin" and job.user_id != user["id"]:
        raise HTTPException(status_code=404, detail="Video job not found.")


def _job_response(job: VideoJob) -> dict:
    return {
        "title": job.title,
        "favorite": job.favorite,
        "settings": job.settings,
        "reference_names": job.reference_names,
        "job_id": job.id,
        "status": job.status,
        "phase": job.phase,
        "can_resume": job.status == "failed" and ((job.phase == "tracking" and bool(job.session_id)) or job.phase == "prepared"),
        "prompt": job.prompt,
        "session_id": job.session_id,
        "error": job.error,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
        "videos": [
            {
                "name": path.name,
                "url": f"/api/muse/jobs/{job.id}/files/{index}",
            }
            for index, path in enumerate(job.files)
            if path.is_file()
        ],
    }


def _restore_jobs() -> None:
    job_store.initialize()
    for job in reversed(job_store.load()):
        if job.deleted:
            state.jobs[job.id] = job
            continue
        video_engine.restore_job(job)
        if job.status == "completed" and (not job.files or any(not p.is_file() for p in job.files)):
            job.status = "failed"
            job.error = "Không tìm thấy tệp video đã lưu."
        job_store.save(job)
        state.jobs[job.id] = job


def _origin_list() -> list[str]:
    raw = os.environ.get(
        "MUSE_APP_ORIGINS",
        "http://localhost:8081,http://127.0.0.1:8081,http://localhost:19006",
    )
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def _require_bridge_token(request: Request) -> None:
    if BRIDGE_TOKEN and request.headers.get("x-bridge-token") != BRIDGE_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid bridge token.")


def _access_session_token(issued_at: int, nonce: str) -> str:
    payload = f"{issued_at}.{nonce}"
    signature = hmac.new(
        ACCESS_SESSION_SECRET,
        payload.encode("ascii"),
        sha256,
    ).hexdigest()
    return f"{payload}.{signature}"


def _has_access_session(request: Request) -> bool:
    token = request.cookies.get(ACCESS_SESSION_COOKIE, "")
    try:
        issued_at_text, nonce, signature = token.split(".", 2)
        issued_at = int(issued_at_text)
    except (TypeError, ValueError):
        return False
    now = int(time.time())
    if issued_at > now or now - issued_at > ACCESS_SESSION_MAX_AGE:
        return False
    expected = _access_session_token(issued_at, nonce).rsplit(".", 1)[1]
    return hmac.compare_digest(signature, expected)


def _login_rate_key(request: Request) -> str:
    return request.headers.get("cf-connecting-ip") or (
        request.client.host if request.client else "unknown"
    )


def _connect_error(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=502,
        detail=f"Không thể kết nối Muse: {exc}",
    )


async def _get_client() -> MuseClient:
    async with state.lock:
        if state.client is not None:
            return state.client

        auth = MuseAuth(state_dir=STATE_DIR)
        client = MuseClient(auth, state_dir=STATE_DIR)
        try:
            await client.connect()
        except Exception as exc:
            await client.close()
            logger.exception("Muse bridge could not open its saved session")
            raise _connect_error(exc) from exc
        state.client = client
        return client


async def _get_muse_account(account_id: str) -> MuseAccountRuntime:
    lock = account_connect_locks.setdefault(account_id, asyncio.Lock())
    try:
        async with asyncio.timeout(15):
            async with lock:
                return await _connect_muse_account(account_id)
    except TimeoutError as exc:
        raise HTTPException(503, "Kết nối tài khoản Muse quá lâu. Vui lòng thử lại sau.") from exc


async def _connect_muse_account(account_id: str) -> MuseAccountRuntime:
    existing = state.muse_accounts.get(account_id)
    if existing is not None:
        return existing
    if account_id == "legacy" and (STATE_DIR / "cookies.json").is_file():
        client = await _get_client()
        state.client = None
        runtime = MuseAccountRuntime(
            id="legacy",
            email="Muse account (legacy session)",
            client=client,
            temp_dir=tempfile.TemporaryDirectory(prefix="tdluxy-muse-legacy-"),
        )
        state.muse_accounts["legacy"] = runtime
        return runtime
    record = user_store.muse_account(account_id)
    if record is None or not record["active"]:
        raise HTTPException(status_code=503, detail="Tài khoản Muse này hiện không hoạt động.")
    temp_dir = tempfile.TemporaryDirectory(prefix=f"tdluxy-muse-{account_id}-")
    cookie_path = Path(temp_dir.name) / "cookies.json"
    cookie_path.write_bytes(record["cookies"])
    auth = MuseAuth(state_dir=temp_dir.name)
    client = MuseClient(auth, state_dir=temp_dir.name)
    try:
        await client.connect()
    except Exception as exc:
        await client.close()
        temp_dir.cleanup()
        logger.exception("Could not connect Muse account %s", account_id)
        raise _connect_error(exc) from exc
    finally:
        cookie_path.unlink(missing_ok=True)
    runtime = MuseAccountRuntime(
        id=account_id,
        email=record["email"],
        client=client,
        temp_dir=temp_dir,
    )
    state.muse_accounts[account_id] = runtime
    return runtime


async def _select_muse_account(account_id: str | None = None, *, for_chat: bool = False) -> MuseAccountRuntime:
    records = user_store.muse_accounts()
    if account_id is not None:
        record = next(
            (item for item in records if item["id"] == account_id and item["active"]),
            None,
        )
        if record is None:
            raise HTTPException(status_code=503, detail="Phiên chat Muse không khả dụng.")
        return await _get_muse_account(account_id)
    candidates = [item for item in records if item["active"]]
    if not candidates:
        if (STATE_DIR / "cookies.json").is_file():
            return await _get_muse_account("legacy")
        raise HTTPException(
            status_code=503,
            detail="Quản trị viên chưa thêm tài khoản Muse hoạt động vào nhóm xử lý.",
        )
    active_counts = {
        account["id"]: sum(
            job.account_id == account["id"] and job.status in {"queued", "running"}
            for job in state.jobs.values()
        )
        for account in candidates
    }
    if for_chat:
        idle = [item for item in candidates if not (
            state.muse_accounts.get(item["id"]) and state.muse_accounts[item["id"]].lock.locked()
        ) and active_counts[item["id"]] == 0]
        if idle:
            candidates = idle
    selected = min(candidates, key=lambda item: active_counts[item["id"]])
    return await _get_muse_account(selected["id"])


def _validated_images(images: list[ImageInput], job_id: str) -> list[Path]:
    if len(images) > 4:
        raise HTTPException(status_code=413, detail="Maximum 4 reference images allowed.")

    validated: list[tuple[bytes, str]] = []
    total_bytes = 0
    for index, item in enumerate(images):
        try:
            data = base64.b64decode(item.base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise HTTPException(status_code=400, detail="Invalid uploaded image.") from exc

        if not data or len(data) > MAX_IMAGE_BYTES:
            raise HTTPException(
                status_code=413,
                detail="Each image must be smaller than 8 MB.",
            )
        total_bytes += len(data)
        if total_bytes > MAX_TOTAL_IMAGE_BYTES:
            raise HTTPException(
                status_code=413,
                detail="Total image size must be smaller than 16 MB.",
            )

        try:
            with Image.open(BytesIO(data)) as image:
                image_format = image.format
                image.verify()
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Reference image {index + 1} could not be read.",
            ) from exc

        extension = ALLOWED_IMAGE_FORMATS.get(image_format or "")
        if extension is None:
            raise HTTPException(
                status_code=415,
                detail="Only JPEG, PNG, WEBP, or GIF images are supported.",
            )
        validated.append((data, extension))

    job_dir = ROOT / "uploads" / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    for index, (data, extension) in enumerate(validated):
        path = job_dir / f"reference-{index + 1}{extension}"
        path.write_bytes(data)
        paths.append(path)

    return paths


def _remove_uploads(paths: list[Path], job_id: str) -> None:
    for path in paths:
        path.unlink(missing_ok=True)
    try:
        (ROOT / "uploads" / job_id).rmdir()
    except OSError:
        pass


async def _muse_image_previews(
    account: MuseAccountRuntime,
    history: object,
    user_id: str,
) -> tuple[list[dict[str, str | int]], list[str]]:
    previews: list[dict[str, str | int]] = []
    errors: list[str] = []
    seen: set[str] = set()
    for grant, access in list(state.image_grants.items()):
        if access[3] <= time.monotonic():
            state.image_grants.pop(grant, None)
    refs: list[ImageRef] = []
    ref_ids: set[str] = set()

    def collect_assistant_images(node: object) -> None:
        if isinstance(node, list):
            for item in node:
                collect_assistant_images(item)
            return
        if not isinstance(node, dict):
            return
        role_value = (
            node.get("role")
            or node.get("sender")
            or node.get("author")
            or node.get("speaker")
        )
        if isinstance(role_value, dict):
            role_value = role_value.get("role") or role_value.get("name")
        if isinstance(role_value, str):
            role = role_value.lower()
            if any(marker in role for marker in ("user", "human")):
                return
            if role in {"ai", "bot"} or any(
                marker in role for marker in ("assistant", "model", "muse")
            ):
                content = (
                    node.get("content")
                    or node.get("parts")
                    or node.get("items")
                    or node.get("message")
                    or node.get("output")
                    or node
                )
                for ref in extract_image_refs(content):
                    if ref.identity not in ref_ids:
                        refs.append(ref)
                        ref_ids.add(ref.identity)
                return
        for item in node.values():
            collect_assistant_images(item)

    collect_assistant_images(history)
    visible_refs = refs[-MAX_MUSE_IMAGE_OUTPUTS:]
    for index, ref in enumerate(visible_refs):
        if ref.identity in seen:
            continue
        seen.add(ref.identity)
        source_path: Path | None = None
        saved_path: Path | None = None
        try:
            if ref.data_base64:
                data = base64.b64decode(ref.data_base64, validate=True)
                if len(data) > MAX_MUSE_IMAGE_OUTPUT_BYTES:
                    raise ValueError("inline image exceeds preview limit")
            else:
                suffix = Path(urlsplit(ref.path or ref.url or "").path).suffix.lower()
                if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}:
                    suffix = ".img"
                source_path = Path(account.temp_dir.name) / f"muse-preview-{uuid.uuid4().hex}{suffix}"
                await account.client.download_image(ref, source_path)
                if source_path.stat().st_size > MAX_MUSE_IMAGE_OUTPUT_BYTES:
                    raise ValueError("image exceeds preview limit")
                data = source_path.read_bytes()

            with Image.open(BytesIO(data)) as source:
                if source.width * source.height > 24_000_000:
                    raise ValueError("image exceeds pixel limit")
                image_format = source.format or "PNG"
                source.seek(0)
                image = ImageOps.exif_transpose(source).convert("RGB")
                original_size = image.size
            file_suffix = {
                "JPEG": ".jpg",
                "PNG": ".png",
                "WEBP": ".webp",
                "GIF": ".gif",
            }.get(image_format)
            if file_suffix is None:
                raise ValueError(f"unsupported image format: {image_format}")
            image_directory = OUTPUT_DIR / "muse-images" / user_id
            image_directory.mkdir(parents=True, exist_ok=True)
            saved_path = image_directory / f"{uuid.uuid4().hex}{file_suffix}"
            saved_path.write_bytes(data)

            thumbnail = image.copy()
            thumbnail.thumbnail((640, 640), Image.Resampling.LANCZOS)
            output = BytesIO()
            for quality in (82, 72, 62, 52):
                output = BytesIO()
                thumbnail.save(output, format="JPEG", quality=quality, optimize=True)
                if len(output.getvalue()) <= MAX_MUSE_IMAGE_PREVIEW_BYTES:
                    break
            if len(output.getvalue()) > MAX_MUSE_IMAGE_PREVIEW_BYTES:
                raise ValueError("image preview exceeds response limit")
            encoded = base64.b64encode(output.getvalue()).decode("ascii")
            fallback_name = Path(urlsplit(ref.path or ref.url or "").path).name
            safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", fallback_name)[:100]
            name = safe_name or f"muse-image-{index + 1}{file_suffix}"
            grant = secrets.token_urlsafe(32)
            state.image_grants[grant] = (
                user_id,
                saved_path,
                name,
                time.monotonic() + 12 * 60 * 60,
            )
            previews.append(
                {
                    "name": name,
                    "media_type": Image.MIME.get(image_format, "image/jpeg"),
                    "preview_base64": encoded,
                    "image_url": f"/api/muse/media/{grant}",
                    "width": original_size[0],
                    "height": original_size[1],
                }
            )
        except Exception:
            logger.exception("Could not load Muse image output %s", index + 1)
            if saved_path is not None:
                saved_path.unlink(missing_ok=True)
            errors.append(f"Không thể tải ảnh Muse số {index + 1} để hiển thị.")
        finally:
            if source_path is not None:
                source_path.unlink(missing_ok=True)
    if len(refs) > MAX_MUSE_IMAGE_OUTPUTS:
        errors.append(
            f"Chỉ hiển thị {MAX_MUSE_IMAGE_OUTPUTS} ảnh mới nhất trong phản hồi Muse này."
        )
    return previews, errors


def _encode_image(image: Image.Image, *, image_format: str = "JPEG") -> str:
    output = BytesIO()
    image.convert("RGB").save(output, format=image_format, quality=92, optimize=True)
    return base64.b64encode(output.getvalue()).decode("ascii")


def _cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    fitted = ImageOps.fit(image.convert("RGB"), size, method=Image.Resampling.LANCZOS)
    return fitted


def _load_image(path: Path) -> Image.Image:
    with Image.open(path) as source:
        if source.width * source.height > 24_000_000:
            raise HTTPException(status_code=413, detail="Ảnh vượt giới hạn 24 megapixel.")
        source.seek(0)
        return ImageOps.exif_transpose(source).convert("RGB")


def _bind_video_session(session_id: str, job: VideoJob) -> None:
    user_store.save_chat_session(session_id, job.user_id, job.account_id)
    if not user_store.owns_chat_session(session_id, job.user_id) or user_store.chat_session_account(session_id, job.user_id) != job.account_id:
        raise video_engine.ReviewRequired("Muse trả phiên không thuộc tác vụ này; cần quản trị viên kiểm tra.")


async def _run_video_job(job: VideoJob, image_paths=None, timeout=None) -> None:
    try:
        if job.account_id is None:
            raise RuntimeError("Không có tài khoản Muse cho tác vụ.")
        account = await _get_muse_account(job.account_id)
        async with account.lock:
            job.status = "running"
            job_store.save(job)
            async with asyncio.timeout(job.timeout_seconds + 90):
                await video_engine.execute(job, account.client, job_store.save,
                    _bind_video_session, OUTPUT_DIR)
    except asyncio.CancelledError:
        # Shutdown is a pause. Keep references and checkpoint for the next startup.
        if job.phase == "submitting":
            job.status = "failed"
            job.phase = "review"
            job.error = "Gián đoạn khi gửi Muse; cần kiểm tra lịch sử trước khi tạo lại."
        elif job.phase != "cancelled":
            job.status = "queued"
        job_store.save(job)
        raise
    except Exception as exc:
        job.status = "failed"
        if job.phase == "submitting" or isinstance(exc, video_engine.ReviewRequired):
            job.phase = "review"
            job.error = "Chưa xác nhận được Muse đã nhận yêu cầu. Không tự gửi lại; hãy kiểm tra lịch sử Muse."
        elif job.phase == "tracking":
            job.error = "Chưa lấy được kết quả. Dùng Tiếp tục theo dõi trong Lịch sử; thao tác này không tạo video mới."
        else:
            job.error = str(exc)
        logger.warning("Video job %s stopped at %s: %s", job.id, job.phase, exc)
        job_store.save(job)
    finally:
        if job.status == "completed" or (job.status == "failed" and job.phase != "prepared"):
            _remove_uploads(job.image_paths, job.id)


@asynccontextmanager
async def _chat_slot(account):
    try:
        await asyncio.wait_for(account.lock.acquire(), timeout=0.25)
    except TimeoutError:
        raise HTTPException(409,
            "Tài khoản Muse của cuộc trò chuyện đang xử lý yêu cầu khác. Tin nhắn chưa được gửi; hãy thử lại sau hoặc mở cuộc trò chuyện mới.",
            headers={"Retry-After": "5"})
    try:
        yield
    finally:
        account.lock.release()


def _require_available_session(session_id: str | None):
    if session_id and any(not j.deleted and j.session_id == session_id and
        (j.status in limits.ACTIVE or (j.status == "failed" and j.phase in {"tracking", "review"}))
        for j in state.jobs.values()):
        raise HTTPException(409, "Phiên này còn video chưa xác nhận kết quả. Hãy tiếp tục theo dõi trong Lịch sử hoặc mở cuộc trò chuyện mới.")


@asynccontextmanager
async def lifespan(_: FastAPI):
    if ACCESS_PASSWORD is not None and len(ACCESS_PASSWORD) < 12:
        raise RuntimeError("TDLUXY_ACCESS_PASSWORD must be at least 12 characters.")
    if os.environ.get("MUSE_BRIDGE_HOST", "127.0.0.1") not in {
        "127.0.0.1",
        "localhost",
        "::1",
    } and not BRIDGE_TOKEN:
        raise RuntimeError(
            "MUSE_BRIDGE_TOKEN is required when exposing the bridge beyond localhost."
        )
    with WorkerLease(STATE_DIR):
        user_store.initialize()
        _restore_jobs()
        for job in state.jobs.values():
            if not job.deleted and job.status == "queued":
                job.task = asyncio.create_task(_run_video_job(job), name=f"muse-video-{job.id}")
        try:
            yield
        finally:
            for job in state.jobs.values():
                if job.task and not job.task.done():
                    job.task.cancel()
            tasks = [j.task for j in state.jobs.values() if j.task is not None]
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            for pending in state.pending_auth.values():
                await pending.auth.close()
                pending.temp_dir.cleanup()
            for account in state.muse_accounts.values():
                await account.client.close()
                account.temp_dir.cleanup()
            for user_id in list(state.publisher_sessions):
                await _close_publisher_session(user_id)
            if state.browser is not None:
                await state.browser.close()
            if state.playwright is not None:
                await state.playwright.stop()
            if state.client is not None:
                await state.client.close()


app = FastAPI(
    title="TDLUXY Studio — Muse Bridge",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origin_list(),
    allow_credentials=False,
    allow_methods=["DELETE", "GET", "PATCH", "POST", "PUT"],
    allow_headers=["Authorization", "Content-Type", "X-Bridge-Token"],
)


@app.middleware("http")
async def require_remote_access(request: Request, call_next):
    if (
        ACCESS_PASSWORD
        and request.url.path.startswith("/api/")
        and request.url.path
        not in {
            "/api/access/status",
            "/api/access/login",
        }
        and not _has_access_session(request)
    ):
        return JSONResponse(
            status_code=401,
            content={"detail": "Nhập mật khẩu chia sẻ để tiếp tục."},
        )
    grant_download = (
        request.url.path.startswith("/api/muse/jobs/")
        and re.fullmatch(r"/api/muse/jobs/[^/]+/files/\d+", request.url.path)
        and request.query_params.get("grant")
    ) or re.fullmatch(r"/api/muse/media/[^/]+", request.url.path)
    if request.url.path.startswith("/api/") and request.url.path not in {
        "/api/access/status",
        "/api/access/login",
        "/api/auth/register",
        "/api/auth/login",
    } and not grant_download:
        token = _bearer_token(request)
        user = user_store.get_session_user(token) if token else None
        if user is None:
            return JSONResponse(
                status_code=401,
                content={"detail": "Phiên TDLUXY đã hết hạn. Hãy đăng nhập lại."},
            )
        if (
            request.url.path.startswith("/api/admin/")
            or request.url.path.startswith("/api/muse/auth/")
            or request.url.path.startswith("/api/muse/accounts")
        ) and user["role"] != "admin":
            return JSONResponse(
                status_code=403,
                content={"detail": "Chức năng này chỉ dành cho quản trị viên."},
            )
        request.state.user = user
    return await call_next(request)


@app.get("/api/access/status")
async def access_status(request: Request) -> dict[str, bool]:
    return {
        "required": ACCESS_PASSWORD is not None,
        "authenticated": ACCESS_PASSWORD is None or _has_access_session(request),
    }


@app.post("/api/access/login")
async def access_login(body: AccessLoginRequest, request: Request) -> dict[str, bool]:
    if ACCESS_PASSWORD is None:
        return {"authenticated": True}

    now = time.monotonic()
    key = _login_rate_key(request)
    attempts = [attempt for attempt in access_login_attempts.get(key, []) if now - attempt < 60]
    if len(attempts) >= 5:
        access_login_attempts[key] = attempts
        raise HTTPException(
            status_code=429,
            detail="Thử đăng nhập quá nhiều lần. Vui lòng đợi một phút.",
        )
    attempts.append(now)
    access_login_attempts[key] = attempts

    if not hmac.compare_digest(
        body.password.encode("utf-8"),
        ACCESS_PASSWORD.encode("utf-8"),
    ):
        raise HTTPException(status_code=401, detail="Mật khẩu chưa chính xác.")

    access_login_attempts.pop(key, None)
    response = JSONResponse({"authenticated": True})
    response.set_cookie(
        ACCESS_SESSION_COOKIE,
        _access_session_token(int(time.time()), secrets.token_urlsafe(18)),
        max_age=ACCESS_SESSION_MAX_AGE,
        httponly=True,
        secure=True,
        samesite="strict",
        path="/",
    )
    return response


@app.post("/api/auth/register")
async def register(body: RegisterRequest) -> dict:
    user = user_store.create_user(body.email, body.password)
    token = user_store.issue_session(user["id"])
    return {"user": user, "token": token}


@app.post("/api/auth/login")
async def login(body: LoginRequest, request: Request) -> dict:
    now = time.monotonic()
    key = f"{_login_rate_key(request)}:{body.email.strip().lower()}"
    attempts = [attempt for attempt in account_login_attempts.get(key, []) if now - attempt < 300]
    if len(attempts) >= 10:
        account_login_attempts[key] = attempts
        raise HTTPException(
            status_code=429,
            detail="Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 5 phút.",
        )
    attempts.append(now)
    account_login_attempts[key] = attempts
    user = user_store.authenticate(body.email, body.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Email hoặc mật khẩu chưa chính xác.")
    account_login_attempts.pop(key, None)
    return {"user": user, "token": user_store.issue_session(user["id"])}


@app.get("/api/auth/me")
async def auth_me(request: Request) -> dict:
    return {"user": _request_user(request)}


@app.post("/api/auth/logout")
async def auth_logout(request: Request) -> dict[str, bool]:
    token = _bearer_token(request)
    if token:
        user = _request_user(request)
        await _close_publisher_session(user["id"])
        for grant, access in list(state.image_grants.items()):
            if access[0] == user["id"]:
                state.image_grants.pop(grant, None)
        user_store.revoke_session(token)
    return {"logged_out": True}


@app.get("/api/health")
async def health(request: Request) -> dict[str, bool]:
    _require_bridge_token(request)
    return {
        "ok": True,
        "authenticated": state.client is not None
        or bool(state.muse_accounts)
        or any(account["active"] for account in user_store.muse_accounts()),
    }


@app.post("/api/media/images/edit")
async def edit_image(body: ImageEditRequest, request: Request) -> dict[str, str]:
    _request_user(request)
    upload_id = uuid.uuid4().hex
    paths = _validated_images([body.image], upload_id)
    try:
        image = _load_image(paths[0])
        image = ImageOps.autocontrast(image, cutoff=1)
        image = ImageEnhance.Contrast(image).enhance(1.08)
        image = ImageEnhance.Color(image).enhance(1.12)
        image = ImageEnhance.Sharpness(image).enhance(1.15)
        if body.preset == "warm":
            red, green, blue = image.split()
            image = Image.merge(
                "RGB",
                (
                    red.point(lambda value: min(255, int(value * 1.04))),
                    green,
                    blue.point(lambda value: int(value * 0.96)),
                ),
            )
        elif body.preset == "mono":
            image = ImageOps.grayscale(image).convert("RGB")
        image = image.filter(ImageFilter.UnsharpMask(radius=1.1, percent=110, threshold=3))
        return {
            "image_base64": _encode_image(image),
            "media_type": "image/jpeg",
            "filename": "tdluxy-edited.jpg",
        }
    finally:
        _remove_uploads(paths, upload_id)


@app.post("/api/media/images/collage")
async def create_collage(body: CollageRequest, request: Request) -> dict[str, str]:
    _request_user(request)
    upload_id = uuid.uuid4().hex
    paths = _validated_images(body.images, upload_id)
    try:
        images = [_load_image(path) for path in paths]
        canvas = Image.new("RGB", (1080, 1350), "#F4F0FF")
        margin = 28
        gap = 18
        cell_width = (1080 - margin * 2 - gap) // 2
        cell_height = (1350 - margin * 2 - gap) // 2
        for index, image in enumerate(images):
            column = index % 2
            row = index // 2
            left = margin + column * (cell_width + gap)
            top = margin + row * (cell_height + gap)
            canvas.paste(_cover(image, (cell_width, cell_height)), (left, top))
        return {
            "image_base64": _encode_image(canvas),
            "media_type": "image/jpeg",
            "filename": "tdluxy-collage.jpg",
        }
    finally:
        _remove_uploads(paths, upload_id)


@app.get("/api/admin/overview")
async def admin_overview(request: Request) -> dict:
    _require_bridge_token(request)
    user = _request_user(request)
    counts = {
        status: sum(
            job.status == status
            for job in state.jobs.values()
            if user["role"] == "admin" or job.user_id == user["id"]
        )
        for status in ("queued", "running", "completed", "failed")
    }
    return {
        "backend": {
            "status": "online",
            "uptime_seconds": int(time.monotonic() - PROCESS_STARTED_AT),
        },
        "muse": {
            "authenticated": state.client is not None
            or bool(state.muse_accounts)
            or any(account["active"] for account in user_store.muse_accounts()),
            "accounts": len(user_store.muse_accounts()),
        },
        "jobs": {**counts, "total": len(state.jobs)},
    }


@app.get("/api/muse/accounts")
async def list_muse_accounts(request: Request) -> dict:
    _require_bridge_token(request)
    _request_user(request)
    active_jobs = {
        account_id: sum(
            job.account_id == account_id and job.status in {"queued", "running"}
            for job in state.jobs.values()
        )
        for account_id in {job.account_id for job in state.jobs.values() if job.account_id}
    }
    return {
        "accounts": [
            {**account, "active_jobs": active_jobs.get(account["id"], 0)}
            for account in user_store.muse_accounts()
        ]
    }


@app.patch("/api/muse/accounts/{account_id}")
async def update_muse_account(
    account_id: str,
    body: MuseAccountActivationRequest,
    request: Request,
) -> dict[str, bool]:
    _require_bridge_token(request)
    if body.active is False and any(
        job.account_id == account_id and job.status in {"queued", "running"}
        for job in state.jobs.values()
    ):
        raise HTTPException(
            status_code=409,
            detail="Không thể tắt tài khoản Muse khi còn job đang chờ hoặc chạy.",
        )
    if not user_store.set_muse_account_active(account_id, body.active):
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản Muse.")
    return {"active": body.active}


@app.delete("/api/muse/accounts/{account_id}")
async def remove_muse_account(account_id: str, request: Request) -> dict[str, bool]:
    _require_bridge_token(request)
    if any(
        job.account_id == account_id and job.status in {"queued", "running"}
        for job in state.jobs.values()
    ):
        raise HTTPException(
            status_code=409,
            detail="Không thể xóa tài khoản Muse khi còn job đang chờ hoặc chạy.",
        )
    runtime = state.muse_accounts.pop(account_id, None)
    if runtime is not None:
        await runtime.client.close()
        runtime.temp_dir.cleanup()
    if not user_store.delete_muse_account(account_id):
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản Muse.")
    return {"deleted": True}


def _publisher_session(request: Request) -> PublisherSession:
    user = _request_user(request)
    session = state.publisher_sessions.get(user["id"])
    if session is None or session.page.is_closed():
        raise HTTPException(status_code=404, detail="Chưa mở phiên trình duyệt đăng video.")
    return session


async def _guard_browser_request(route) -> None:
    url = urlsplit(route.request.url)
    if url.scheme in {"data", "blob", "about"}:
        await route.continue_()
        return
    if url.scheme not in {"http", "https"} or not url.hostname:
        await route.abort("blockedbyclient")
        return
    host = url.hostname.lower().rstrip(".")
    if host == "localhost" or host.endswith((".localhost", ".local")):
        await route.abort("blockedbyclient")
        return
    try:
        target_ip = ipaddress.ip_address(host)
        is_public = target_ip.is_global
    except ValueError:
        try:
            addresses = await asyncio.get_running_loop().getaddrinfo(
                host,
                url.port or (443 if url.scheme == "https" else 80),
                type=socket.SOCK_STREAM,
            )
        except OSError:
            await route.abort("failed")
            return
        is_public = bool(addresses) and all(
            ipaddress.ip_address(address[4][0].split("%", 1)[0]).is_global
            for address in addresses
        )
    if not is_public:
        await route.abort("blockedbyclient")
        return
    await route.continue_()


async def _close_publisher_session(user_id: str) -> None:
    session = state.publisher_sessions.pop(user_id, None)
    if session is None:
        return
    await session.context.close()
    try:
        for path in session.media_dir.iterdir():
            if path.is_file():
                path.unlink()
        session.media_dir.rmdir()
    except OSError:
        logger.warning("Could not remove temporary publisher media for user %s", user_id)


@app.post("/api/publisher/session")
async def start_publisher_session(
    body: PublisherStartRequest,
    request: Request,
) -> dict[str, str]:
    user = _request_user(request)
    _require_bridge_token(request)
    await _close_publisher_session(user["id"])
    try:
        if state.playwright is None:
            state.playwright = await async_playwright().start()
        if state.browser is None or not state.browser.is_connected():
            state.browser = await state.playwright.chromium.launch(headless=True)
        context = await state.browser.new_context(
            viewport={"width": 1280, "height": 800},
            accept_downloads=False,
        )
        await context.route("**/*", _guard_browser_request)
        page = await context.new_page()
        media_dir = STATE_DIR / "publisher" / user["id"] / uuid.uuid4().hex
        media_dir.mkdir(parents=True, exist_ok=True)
        session = PublisherSession(
            user_id=user["id"],
            platform=body.platform,
            context=context,
            page=page,
            media_dir=media_dir,
        )

        async def select_uploaded_media(file_chooser) -> None:
            try:
                if session.latest_upload and session.latest_upload.is_file():
                    await file_chooser.set_files(str(session.latest_upload))
                else:
                    await file_chooser.set_files([])
            except Exception:
                logger.exception("Remote browser file selection failed for user %s", user["id"])

        page.on("filechooser", select_uploaded_media)
        state.publisher_sessions[user["id"]] = session
        target_url = (
            "https://www.tiktok.com/upload"
            if body.platform == "tiktok"
            else "https://studio.youtube.com/channel/UC/videos/upload"
        )
        await page.goto(target_url, wait_until="commit", timeout=30_000)
        return {
            "platform": body.platform,
            "url": page.url,
            "message": "Trình duyệt riêng đã mở. Hãy tự đăng nhập và xác nhận thao tác đăng bài.",
        }
    except Exception as exc:
        await _close_publisher_session(user["id"])
        logger.exception("Could not start remote publisher browser")
        raise HTTPException(
            status_code=503,
            detail=f"Không mở được trình duyệt đăng bài: {exc}",
        ) from exc


@app.get("/api/publisher/session/frame")
async def publisher_frame(request: Request) -> dict[str, str | int]:
    _require_bridge_token(request)
    session = _publisher_session(request)
    try:
        frame = await session.page.screenshot(type="jpeg", quality=72)
    except Exception as exc:
        logger.exception("Could not capture remote publisher frame")
        raise HTTPException(status_code=503, detail="Không thể chụp khung hình trình duyệt.") from exc
    return {
        "image_base64": base64.b64encode(frame).decode("ascii"),
        "width": 1280,
        "height": 800,
        "platform": session.platform,
        "url": session.page.url,
    }


@app.post("/api/publisher/session/input")
async def publisher_input(
    body: PublisherInputRequest,
    request: Request,
) -> dict[str, bool]:
    _require_bridge_token(request)
    session = _publisher_session(request)
    try:
        if body.action == "click":
            if body.x is None or body.y is None:
                raise HTTPException(status_code=422, detail="Click cần tọa độ x và y.")
            await session.page.mouse.click(body.x, body.y)
        elif body.action == "type":
            if not body.text:
                raise HTTPException(status_code=422, detail="Không có nội dung để nhập.")
            await session.page.keyboard.insert_text(body.text)
        elif body.action == "press":
            allowed_keys = {
                "Enter",
                "Tab",
                "Escape",
                "Backspace",
                "Delete",
                "ArrowUp",
                "ArrowDown",
                "ArrowLeft",
                "ArrowRight",
                "Space",
            }
            if body.key not in allowed_keys:
                raise HTTPException(status_code=422, detail="Phím này không được hỗ trợ.")
            await session.page.keyboard.press(body.key)
        elif body.action == "scroll":
            await session.page.mouse.wheel(0, body.delta_y)
        elif body.action == "back":
            await session.page.go_back(wait_until="domcontentloaded", timeout=15_000)
        elif body.action == "reload":
            await session.page.reload(wait_until="domcontentloaded", timeout=20_000)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Remote browser input failed")
        raise HTTPException(status_code=503, detail="Không thực hiện được thao tác trình duyệt.") from exc
    return {"ok": True}


@app.post("/api/publisher/session/media")
async def upload_publisher_media(request: Request) -> dict[str, str | int]:
    _require_bridge_token(request)
    session = _publisher_session(request)
    file_name = request.headers.get("x-file-name", "video.mp4")
    file_name = Path(unquote(file_name)).name
    suffix = Path(file_name).suffix.lower()
    if suffix not in {".mp4", ".mov", ".webm", ".m4v"}:
        raise HTTPException(status_code=415, detail="Chỉ nhận video MP4, MOV, WEBM hoặc M4V.")
    length_header = request.headers.get("content-length")
    if length_header:
        try:
            request_size = int(length_header)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Content-Length không hợp lệ.") from exc
        if request_size > MAX_PUBLISHER_MEDIA_BYTES:
            raise HTTPException(status_code=413, detail="Video phải nhỏ hơn 250 MB.")
    target = session.media_dir / f"{uuid.uuid4().hex}{suffix}"
    size = 0
    try:
        with target.open("wb") as output:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_PUBLISHER_MEDIA_BYTES:
                    raise HTTPException(status_code=413, detail="Video phải nhỏ hơn 250 MB.")
                output.write(chunk)
    except HTTPException:
        target.unlink(missing_ok=True)
        raise
    except OSError as exc:
        target.unlink(missing_ok=True)
        logger.exception("Could not save publisher upload")
        raise HTTPException(status_code=500, detail="Không lưu được video tạm.") from exc
    if size == 0:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Tệp video đang trống.")
    if session.latest_upload and session.latest_upload.exists():
        session.latest_upload.unlink(missing_ok=True)
    session.latest_upload = target
    return {"filename": file_name, "bytes": size}


@app.delete("/api/publisher/session")
async def stop_publisher_session(request: Request) -> dict[str, bool]:
    _require_bridge_token(request)
    user = _request_user(request)
    await _close_publisher_session(user["id"])
    return {"stopped": True}


@app.post("/api/muse/auth/otp")
async def request_otp(body: OtpRequest, request: Request) -> dict[str, str]:
    _require_bridge_token(request)
    if "@" not in body.email:
        raise HTTPException(status_code=422, detail="Please enter a valid email.")
    user_store._vault()
    account_id = body.account_id or uuid.uuid4().hex
    if account_id in state.pending_auth:
        pending = state.pending_auth.pop(account_id)
        await pending.auth.close()
        pending.temp_dir.cleanup()
    temp_dir = tempfile.TemporaryDirectory(prefix=f"tdluxy-muse-pending-{account_id}-")
    auth = MuseAuth(state_dir=temp_dir.name)
    try:
        await auth.restart_login()
        await auth.send_otp(body.email.strip(), region="VN")
    except (MuseError, OSError, TimeoutError, ValueError) as exc:
        await auth.close()
        temp_dir.cleanup()
        raise _connect_error(exc) from exc
    except Exception as exc:
        await auth.close()
        temp_dir.cleanup()
        logger.exception("Unexpected Muse OTP request failure")
        raise _connect_error(exc) from exc
    state.pending_auth[account_id] = PendingMuseAuth(
        email=body.email.strip(),
        auth=auth,
        temp_dir=temp_dir,
    )
    return {"message": "OTP code sent to your Muse email.", "account_id": account_id}


@app.post("/api/muse/auth/verify")
async def verify_otp(body: OtpVerifyRequest, request: Request) -> dict[str, bool]:
    _require_bridge_token(request)
    async with state.lock:
        pending = state.pending_auth.get(body.account_id)
        if pending is None:
            raise HTTPException(
                status_code=409,
                detail="Verification session expired. Please request a new code.",
            )
        auth = pending.auth
        try:
            await auth.confirm_otp(body.code.strip())
            await auth.save_account()
            check = await auth.auth_check()
            if check.get("ok") is not True:
                raise HTTPException(
                    status_code=401,
                    detail="Muse could not verify account. Check the code and try again.",
                )
            await auth.save_cookies()
            cookies = auth.cookie_path.read_bytes()
            client = MuseClient(auth, state_dir=pending.temp_dir.name)
            await client.connect()
            user_store.save_muse_account(body.account_id, pending.email, cookies)
            auth.cookie_path.unlink(missing_ok=True)
        except HTTPException:
            raise
        except (MuseError, OSError, TimeoutError, ValueError) as exc:
            await auth.close()
            pending.temp_dir.cleanup()
            state.pending_auth.pop(body.account_id, None)
            raise _connect_error(exc) from exc
        except Exception as exc:
            await auth.close()
            pending.temp_dir.cleanup()
            state.pending_auth.pop(body.account_id, None)
            logger.exception("Unexpected Muse authentication failure")
            raise _connect_error(exc) from exc
        state.pending_auth.pop(body.account_id, None)
        state.muse_accounts[body.account_id] = MuseAccountRuntime(
            id=body.account_id,
            email=pending.email,
            client=client,
            temp_dir=pending.temp_dir,
        )
    return {"authenticated": True}


@app.get("/api/muse/status")
async def muse_status(request: Request) -> dict[str, bool | str]:
    _require_bridge_token(request)
    accounts = [item for item in user_store.muse_accounts() if item["active"]]
    if not accounts and (STATE_DIR / "cookies.json").is_file():
        await _get_muse_account("legacy")
        return {"authenticated": True, "connected": True}
    return {
        "authenticated": bool(accounts) or bool(state.muse_accounts) or state.client is not None,
        "connected": bool(accounts) or bool(state.muse_accounts) or state.client is not None,
    }


@app.post("/api/muse/chat")
async def chat(body: ChatRequest, request: Request) -> dict:
    _require_bridge_token(request)
    user = _request_user(request)
    prompt = body.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=422, detail="Please enter message to send to Muse.")
    if body.session_id and not user_store.owns_chat_session(body.session_id, user["id"]):
        raise HTTPException(status_code=404, detail="Muse chat session not found.")
    _require_available_session(body.session_id)
    account_id = (
        user_store.chat_session_account(body.session_id, user["id"])
        if body.session_id
        else None
    )
    if body.session_id and account_id is None:
        raise HTTPException(status_code=409, detail="Phiên chat Muse cũ không còn gắn với tài khoản.")
    account = await _select_muse_account(account_id, for_chat=True)
    previews: list[dict[str, str]] = []
    media_errors: list[str] = []
    try:
        async with _chat_slot(account):
            events = await account.client.chat_stream(
                prompt=prompt,
                session_id=body.session_id,
                stream_timeout=30,
            )
            resolved_session = body.session_id
            if resolved_session is None:
                session_ids = extract_session_ids(events)
                if session_ids:
                    resolved_session = session_ids[-1]
            history = None
            if resolved_session:
                existing_account = user_store.chat_session_account(
                    resolved_session,
                    user["id"],
                )
                if existing_account is None:
                    user_store.save_chat_session(resolved_session, user["id"], account.id)
                    if not user_store.owns_chat_session(resolved_session, user["id"]):
                        raise HTTPException(
                            status_code=502,
                            detail="Không thể gắn phiên chat Muse vào tài khoản TDLUXY.",
                        )
                elif existing_account != account.id:
                    raise HTTPException(
                        status_code=404,
                        detail="Muse chat session not found.",
                    )
                history = await account.client.history(session_id=resolved_session, limit=40)
                previews, media_errors = await _muse_image_previews(
                    account,
                    {"history": history, "events": events},
                    user["id"],
                )
    except HTTPException:
        raise
    except (MuseError, OSError, TimeoutError, ValueError) as exc:
        raise _connect_error(exc) from exc
    except Exception as exc:
        logger.exception("Unexpected Muse chat failure")
        raise _connect_error(exc) from exc
    return {
        "session_id": resolved_session,
        "events": events,
        "history": history,
        "media": previews,
        "media_errors": media_errors,
    }


@app.get("/api/muse/history")
async def chat_history(
    request: Request,
    session_id: str | None = None,
    limit: int = 40,
) -> dict:
    _require_bridge_token(request)
    user = _request_user(request)
    if not 1 <= limit <= 100:
        raise HTTPException(status_code=422, detail="History limit must be between 1 and 100.")
    if session_id is None or not user_store.owns_chat_session(session_id, user["id"]):
        raise HTTPException(status_code=404, detail="Muse chat session not found.")
    account_id = user_store.chat_session_account(session_id, user["id"])
    account = await _select_muse_account(account_id, for_chat=True)
    async with _chat_slot(account):
        try:
            history = await account.client.history(session_id=session_id, limit=limit)
            previews, media_errors = await _muse_image_previews(
                account,
                history,
                user["id"],
            )
        except (MuseError, OSError, TimeoutError, ValueError) as exc:
            raise _connect_error(exc) from exc
    return {
        "session_id": session_id,
        "history": history,
        "media": previews,
        "media_errors": media_errors,
    }


@app.post("/api/muse/videos")
async def create_video(body: VideoRequest, request: Request) -> dict:
    _require_bridge_token(request)
    user = _request_user(request)
    prompt = body.prompt.strip()
    if not prompt:
        raise HTTPException(422, "Hãy mô tả video muốn tạo.")
    payload = body.model_dump(exclude={"request_id"})
    fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    async with admission_lock:
        if body.request_id:
            prior = next((j for j in state.jobs.values() if j.user_id == user["id"] and j.request_id == body.request_id), None)
            if prior:
                if prior.request_hash != fingerprint:
                    raise HTTPException(409, "Mã yêu cầu đã được dùng cho nội dung khác.")
                if prior.deleted:
                    raise HTTPException(410, "Tác vụ này đã bị xóa; hãy tạo yêu cầu mới.")
                return {"job_id": prior.id, "status": prior.status}
        limits.check_admission(state.jobs.values(), user["id"], OUTPUT_DIR, video_limits)
        if body.session_id and not user_store.owns_chat_session(body.session_id, user["id"]):
            raise HTTPException(404, "Muse chat session not found.")
        _require_available_session(body.session_id)
        account_id = user_store.chat_session_account(body.session_id, user["id"]) if body.session_id else None
        if body.session_id and account_id is None:
            raise HTTPException(409, "Phiên chat cũ không còn gắn với tài khoản Muse.")
        account = await _select_muse_account(account_id)
        job_id = uuid.uuid4().hex
        paths = _validated_images(body.images, job_id)
        job = VideoJob(id=job_id, prompt=prompt, user_id=user["id"], account_id=account.id,
            session_id=body.session_id, phase="prepared", image_paths=paths,
            settings=body.settings.model_dump(), reference_names=[image.name for image in body.images],
            timeout_seconds=body.timeout_seconds, request_id=body.request_id,
            request_hash=fingerprint, max_output_bytes=video_limits.output_bytes)
        try:
            job_store.save(job)
        except Exception:
            _remove_uploads(paths, job_id)
            raise
        state.jobs[job_id] = job
        job.task = asyncio.create_task(_run_video_job(job), name=f"muse-video-{job_id}")
    return {"job_id": job_id, "status": job.status}


@app.get("/api/muse/usage")
async def video_usage(request: Request) -> dict:
    _require_bridge_token(request)
    return limits.usage(state.jobs.values(), _request_user(request)["id"], OUTPUT_DIR, video_limits)


@app.get("/api/studio/workspace")
async def get_workspace(request: Request) -> dict:
    _require_bridge_token(request)
    return StudioStore(user_store.path).get(_request_user(request)["id"])


@app.put("/api/studio/workspace")
async def save_workspace(body: WorkspaceUpdate, request: Request) -> dict:
    _require_bridge_token(request)
    return StudioStore(user_store.path).save(_request_user(request)["id"], body.model_dump())


@app.patch("/api/muse/jobs/{job_id}")
async def update_job_metadata(job_id: str, body: JobMetadataUpdate, request: Request) -> dict:
    _require_bridge_token(request)
    job = state.jobs.get(job_id)
    if job is None or job.deleted:
        raise HTTPException(404, "Không tìm thấy tác vụ.")
    _require_job_owner(job, request)
    if body.title is not None:
        job.title = body.title.strip()
    if body.favorite is not None:
        job.favorite = body.favorite
    job_store.save(job)
    return _job_response(job)


@app.post("/api/muse/jobs/{job_id}/resume")
async def resume_video(job_id: str, request: Request) -> dict:
    _require_bridge_token(request)
    async with admission_lock:
        job = state.jobs.get(job_id)
        if job is None or job.deleted:
            raise HTTPException(404, "Không tìm thấy tác vụ.")
        _require_job_owner(job, request)
        if job.status != "failed" or not ((job.phase == "tracking" and job.session_id) or job.phase == "prepared"):
            raise HTTPException(409, "Tác vụ này không có điểm theo dõi an toàn.")
        limits.check_admission(state.jobs.values(), job.user_id, OUTPUT_DIR, video_limits, resume=True,
            reservation_bytes=max(0, job.max_output_bytes - limits.directory_size(OUTPUT_DIR / job.id)))
        job.status, job.error = "queued", None
        job_store.save(job)
        job.task = asyncio.create_task(_run_video_job(job), name=f"muse-video-{job.id}")
        return _job_response(job)


@app.post("/api/muse/jobs/{job_id}/cancel")
async def cancel_video(job_id: str, request: Request) -> dict:
    _require_bridge_token(request)
    async with admission_lock:
        job = state.jobs.get(job_id)
        if job is None or job.deleted:
            raise HTTPException(404, "Không tìm thấy tác vụ.")
        _require_job_owner(job, request)
        if job.status != "queued" or job.phase != "prepared":
            raise HTTPException(409, "Chỉ hủy được tác vụ chưa gửi sang Muse.")
        job.phase, job.status, job.error = "cancelled", "failed", "Đã hủy trước khi gửi Muse."
        if job.task:
            job.task.cancel()
            await asyncio.gather(job.task, return_exceptions=True)
        _remove_uploads(job.image_paths, job.id)
        job_store.save(job)
        return _job_response(job)


@app.delete("/api/muse/jobs/{job_id}")
async def delete_video(job_id: str, request: Request) -> dict:
    _require_bridge_token(request)
    async with admission_lock:
        job = state.jobs.get(job_id)
        if job is None or job.deleted:
            raise HTTPException(404, "Không tìm thấy tác vụ.")
        _require_job_owner(job, request)
        if job.status in limits.ACTIVE or (job.task and not job.task.done()):
            raise HTTPException(409, "Hãy chờ tác vụ hoàn tất hoặc hủy trước khi xóa.")
        target = (OUTPUT_DIR / job.id).resolve()
        if not target.is_relative_to(OUTPUT_DIR.resolve()) or target == OUTPUT_DIR.resolve():
            raise HTTPException(400, "Đường dẫn tác vụ không hợp lệ.")
        # Only this job's server-owned output directory; never arbitrary stored paths.
        import shutil
        if target.exists():
            shutil.rmtree(target)
        _remove_uploads(job.image_paths, job.id)
        job.deleted, job.files = True, []
        job_store.save(job)  # tombstone retains the daily quota and idempotency key
        for grant, value in list(state.download_grants.items()):
            if value[0] == job.id:
                state.download_grants.pop(grant, None)
        return {"deleted": True}


@app.get("/api/muse/jobs")
async def list_video_jobs(request: Request, limit: int = 100) -> dict:
    _require_bridge_token(request)
    user = _request_user(request)
    if not 1 <= limit <= 500:
        raise HTTPException(status_code=422, detail="Job limit must be between 1 and 500.")
    jobs = sorted(
        (
            job
            for job in state.jobs.values()
            if not job.deleted and (user["role"] == "admin" or job.user_id == user["id"])
        ),
        key=lambda job: job.created_at,
        reverse=True,
    )
    return {"jobs": [_job_response(job) for job in jobs[:limit]]}


@app.get("/api/muse/jobs/{job_id}")
async def video_job(job_id: str, request: Request) -> dict:
    _require_bridge_token(request)
    job = state.jobs.get(job_id)
    if job is None or job.deleted:
        raise HTTPException(status_code=404, detail="Video job not found.")
    _require_job_owner(job, request)
    return _job_response(job)


@app.get("/api/muse/jobs/{job_id}/files/{index}/access")
async def video_file_access(
    job_id: str,
    index: int,
    request: Request,
) -> dict[str, str | int]:
    _require_bridge_token(request)
    job = state.jobs.get(job_id)
    if job is None or job.deleted or job.status != "completed":
        raise HTTPException(status_code=404, detail="Video not ready yet.")
    _require_job_owner(job, request)
    if index < 0 or index >= len(job.files) or not job.files[index].is_file():
        raise HTTPException(status_code=404, detail="Video file not found.")
    grant = secrets.token_urlsafe(32)
    state.download_grants[grant] = (job_id, index, time.monotonic() + 600)
    return {
        "url": f"/api/muse/jobs/{job_id}/files/{index}?grant={grant}",
        "expires_in": 600,
    }


@app.get("/api/muse/jobs/{job_id}/files/{index}")
async def video_file(
    job_id: str,
    index: int,
    request: Request,
    grant: str | None = None,
) -> FileResponse:
    if grant is None:
        _require_bridge_token(request)
    else:
        access = state.download_grants.get(grant)
        if access is None or access[2] <= time.monotonic():
            state.download_grants.pop(grant, None)
            raise HTTPException(status_code=401, detail="Video link has expired.")
        if access[:2] != (job_id, index):
            raise HTTPException(status_code=403, detail="Video link does not match this file.")
    job = state.jobs.get(job_id)
    if job is None or job.deleted or job.status != "completed":
        raise HTTPException(status_code=404, detail="Video not ready yet.")
    if grant is None:
        _require_job_owner(job, request)
    if index < 0 or index >= len(job.files):
        raise HTTPException(status_code=404, detail="Video file not found.")
    path = job.files[index]
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Video file no longer exists.")
    return FileResponse(path, media_type="video/mp4", filename=path.name)


@app.get("/api/muse/media/{grant}")
async def muse_image_file(grant: str) -> FileResponse:
    access = state.image_grants.get(grant)
    if access is None or access[3] <= time.monotonic():
        state.image_grants.pop(grant, None)
        raise HTTPException(status_code=401, detail="Image link has expired.")
    _, path, name, _ = access
    if not path.is_file():
        state.image_grants.pop(grant, None)
        raise HTTPException(status_code=404, detail="Image file no longer exists.")
    media_type = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }.get(path.suffix.lower())
    if media_type is None:
        raise HTTPException(status_code=415, detail="Unsupported image file.")
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", name)[:100] or "muse-image"
    return FileResponse(
        path,
        media_type=media_type,
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": f'inline; filename="{safe_name}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


WEB_BUILD_DIR = ROOT.parent / "dist"
if WEB_BUILD_DIR.is_dir():
    app.mount("/", StaticFiles(directory=WEB_BUILD_DIR, html=True), name="web")
