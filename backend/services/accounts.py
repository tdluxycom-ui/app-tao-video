from __future__ import annotations
import hashlib, hmac, json, logging, os, re, secrets, sqlite3, uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterator
import time
from fastapi import HTTPException
from cryptography.fernet import Fernet, InvalidToken
PASSWORD_ITERATIONS = 310_000
logger = logging.getLogger("sangtao.muse.accounts")

class UserStore:
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
                CREATE TABLE IF NOT EXISTS tdluxy_users (
                    id TEXT PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE,
                    password_salt BLOB NOT NULL,
                    password_hash BLOB NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('user', 'admin')),
                    created_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS tdluxy_sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES tdluxy_users(id) ON DELETE CASCADE,
                    expires_at REAL NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS muse_chat_sessions (
                    session_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES tdluxy_users(id) ON DELETE CASCADE,
                    account_id TEXT
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS tdluxy_muse_accounts (
                    id TEXT PRIMARY KEY,
                    email TEXT NOT NULL,
                    cookies_ciphertext BLOB NOT NULL,
                    active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL
                )
                """
            )
            chat_columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(muse_chat_sessions)")
            }
            if "account_id" not in chat_columns:
                connection.execute(
                    "ALTER TABLE muse_chat_sessions ADD COLUMN account_id TEXT"
                )
        admin_email = os.environ.get("TDLUXY_ADMIN_EMAIL", "").strip()
        admin_password = os.environ.get("TDLUXY_ADMIN_PASSWORD", "")
        if bool(admin_email) != bool(admin_password):
            raise RuntimeError(
                "Set both TDLUXY_ADMIN_EMAIL and TDLUXY_ADMIN_PASSWORD to bootstrap an administrator."
            )
        if admin_email:
            if len(admin_password) < 12:
                raise RuntimeError("TDLUXY_ADMIN_PASSWORD must be at least 12 characters.")
            with self._connect() as connection:
                has_admin = connection.execute(
                    "SELECT 1 FROM tdluxy_users WHERE role = 'admin' LIMIT 1"
                ).fetchone()
            if not has_admin:
                user = self.authenticate(admin_email, admin_password)
                if user is None:
                    try:
                        self.create_user(admin_email, admin_password, role="admin")
                    except HTTPException as exc:
                        if exc.status_code != 409:
                            raise
                        raise RuntimeError(
                            "The configured TDLUXY admin email exists but its password does not match."
                        ) from exc
                else:
                    with self._connect() as connection:
                        connection.execute(
                            "UPDATE tdluxy_users SET role = 'admin' WHERE id = ?",
                            (user["id"],),
                        )

    @staticmethod
    def _password_hash(password: str, salt: bytes) -> bytes:
        return hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt,
            PASSWORD_ITERATIONS,
        )

    def create_user(self, email: str, password: str, role: str = "user") -> dict:
        normalized_email = email.strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized_email):
            raise HTTPException(status_code=422, detail="Hãy nhập địa chỉ email hợp lệ.")
        if role not in {"user", "admin"}:
            raise ValueError("Unsupported user role.")
        user_id = uuid.uuid4().hex
        salt = secrets.token_bytes(16)
        password_hash = self._password_hash(password, salt)
        try:
            with self._connect() as connection:
                connection.execute(
                    """
                    INSERT INTO tdluxy_users
                        (id, email, password_salt, password_hash, role, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        user_id,
                        normalized_email,
                        salt,
                        password_hash,
                        role,
                        datetime.now(UTC).isoformat(),
                    ),
                )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="Email này đã được đăng ký.") from exc
        return {"id": user_id, "email": normalized_email, "role": role}

    def authenticate(self, email: str, password: str) -> dict | None:
        with self._connect() as connection:
            user = connection.execute(
                "SELECT * FROM tdluxy_users WHERE email = ?",
                (email.strip().lower(),),
            ).fetchone()
        if user is None:
            return None
        password_hash = self._password_hash(password, user["password_salt"])
        if not hmac.compare_digest(password_hash, user["password_hash"]):
            return None
        return {"id": user["id"], "email": user["email"], "role": user["role"]}

    def issue_session(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO tdluxy_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                (hashlib.sha256(token.encode("ascii")).hexdigest(), user_id, time.time() + 30 * 86400),
            )
        return token

    def get_session_user(self, token: str) -> dict | None:
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT u.id, u.email, u.role
                FROM tdluxy_sessions s
                JOIN tdluxy_users u ON u.id = s.user_id
                WHERE s.token_hash = ? AND s.expires_at > ?
                """,
                (token_hash, time.time()),
            ).fetchone()
        return dict(row) if row is not None else None

    def revoke_session(self, token: str) -> None:
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        with self._connect() as connection:
            connection.execute(
                "DELETE FROM tdluxy_sessions WHERE token_hash = ?",
                (token_hash,),
            )

    def owns_chat_session(self, session_id: str, user_id: str) -> bool:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT 1 FROM muse_chat_sessions WHERE session_id = ? AND user_id = ?",
                (session_id, user_id),
            ).fetchone()
        return row is not None

    def chat_session_account(self, session_id: str, user_id: str) -> str | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT account_id FROM muse_chat_sessions WHERE session_id = ? AND user_id = ?",
                (session_id, user_id),
            ).fetchone()
        return row["account_id"] if row is not None else None

    def save_chat_session(
        self,
        session_id: str,
        user_id: str,
        account_id: str | None,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO muse_chat_sessions (session_id, user_id, account_id)
                VALUES (?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    account_id = excluded.account_id
                WHERE muse_chat_sessions.user_id = excluded.user_id
                    AND muse_chat_sessions.account_id IS NULL
                """,
                (session_id, user_id, account_id),
            )

    @staticmethod
    def _vault() -> Fernet:
        key = os.environ.get("TDLUXY_MUSE_VAULT_KEY")
        if not key:
            raise HTTPException(
                status_code=503,
                detail="Quản trị viên cần cấu hình TDLUXY_MUSE_VAULT_KEY để lưu tài khoản Muse an toàn.",
            )
        try:
            return Fernet(key.encode("ascii"))
        except (ValueError, UnicodeEncodeError) as exc:
            raise HTTPException(
                status_code=500,
                detail="TDLUXY_MUSE_VAULT_KEY không hợp lệ.",
            ) from exc

    def save_muse_account(self, account_id: str, email: str, cookies: bytes) -> None:
        encrypted = self._vault().encrypt(cookies)
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO tdluxy_muse_accounts
                    (id, email, cookies_ciphertext, active, created_at)
                VALUES (?, ?, ?, 1, ?)
                """,
                (account_id, email.strip().lower(), encrypted, datetime.now(UTC).isoformat()),
            )

    def muse_account(self, account_id: str) -> dict | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM tdluxy_muse_accounts WHERE id = ?",
                (account_id,),
            ).fetchone()
        if row is None:
            return None
        try:
            cookies = self._vault().decrypt(row["cookies_ciphertext"])
        except InvalidToken as exc:
            logger.exception("Could not decrypt Muse account %s", account_id)
            raise HTTPException(
                status_code=500,
                detail="Không mở được thông tin xác thực Muse đã mã hóa.",
            ) from exc
        return {**dict(row), "cookies": cookies}

    def muse_accounts(self) -> list[dict]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT id, email, active, created_at FROM tdluxy_muse_accounts ORDER BY created_at"
            ).fetchall()
        return [{**dict(row), "active": bool(row["active"])} for row in rows]

    def set_muse_account_active(self, account_id: str, active: bool) -> bool:
        with self._connect() as connection:
            cursor = connection.execute(
                "UPDATE tdluxy_muse_accounts SET active = ? WHERE id = ?",
                (int(active), account_id),
            )
        return cursor.rowcount > 0

    def delete_muse_account(self, account_id: str) -> bool:
        with self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM tdluxy_muse_accounts WHERE id = ?",
                (account_id,),
            )
        return cursor.rowcount > 0


