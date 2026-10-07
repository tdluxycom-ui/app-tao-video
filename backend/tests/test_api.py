from __future__ import annotations

import base64
import asyncio
from io import BytesIO
import time
import unittest
from unittest.mock import patch
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from fastapi.testclient import TestClient

from fastapi import HTTPException
from cryptography.fernet import Fernet
from PIL import Image

from backend.main import (
    ImageInput,
    JobStore,
    UserStore,
    VideoJob,
    account_login_attempts,
    _connect_error,
    _muse_image_previews,
    _validated_images,
    access_login_attempts,
    app,
    state,
    user_store,
    _guard_browser_request,
)


class BridgeApiTests(unittest.TestCase):
    def setUp(self) -> None:
        access_login_attempts.clear()
        account_login_attempts.clear()
        self.original_auth_path = user_store.path
        self.auth_directory = TemporaryDirectory()
        user_store.path = Path(self.auth_directory.name) / "tdluxy.sqlite3"
        user_store.initialize()
        self.user = user_store.create_user(
            "admin@example.com",
            "TestPassword!234",
            role="admin",
        )
        self.token = user_store.issue_session(self.user["id"])
        self.client = TestClient(app)
        self.client.headers.update({"Authorization": f"Bearer {self.token}"})

    def tearDown(self) -> None:
        self.client.close()
        user_store.path = self.original_auth_path
        self.auth_directory.cleanup()

    @staticmethod
    def image_payload(name: str, color: tuple[int, int, int]) -> dict[str, str]:
        output = BytesIO()
        Image.new("RGB", (40, 30), color).save(output, format="JPEG")
        return {"name": name, "base64": base64.b64encode(output.getvalue()).decode("ascii")}

    def test_health_does_not_claim_muse_is_authenticated(self) -> None:
        response = self.client.get("/api/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["ok"], True)
        self.assertEqual(response.json()["authenticated"], False)

    def test_access_gate_requires_password_and_sets_secure_session(self) -> None:
        with patch("backend.main.ACCESS_PASSWORD", "a-strong-shared-passphrase"):
            client = TestClient(app, base_url="https://testserver")
            client.headers.update({"Authorization": f"Bearer {self.token}"})
            self.assertEqual(client.get("/api/health").status_code, 401)
            status = client.get("/api/access/status")
            self.assertEqual(status.json(), {"required": True, "authenticated": False})
            self.assertEqual(
                client.post(
                    "/api/access/login",
                    json={"password": "wrong-password"},
                ).status_code,
                401,
            )

            login = client.post(
                "/api/access/login",
                json={"password": "a-strong-shared-passphrase"},
            )
            self.assertEqual(login.status_code, 200)
            self.assertIn("httponly", login.headers["set-cookie"].lower())
            self.assertIn("secure", login.headers["set-cookie"].lower())
            self.assertEqual(client.get("/api/health").status_code, 200)
            self.assertEqual(client.get("/api/admin/overview").status_code, 200)
            client.close()

    def test_access_gate_limits_repeated_login_attempts(self) -> None:
        with patch("backend.main.ACCESS_PASSWORD", "a-strong-shared-passphrase"):
            client = TestClient(app, base_url="https://testserver")
            for _ in range(5):
                response = client.post(
                    "/api/access/login",
                    json={"password": "wrong-password"},
                )
                self.assertEqual(response.status_code, 401)
            limited = client.post(
                "/api/access/login",
                json={"password": "a-strong-shared-passphrase"},
            )
            self.assertEqual(limited.status_code, 429)

    def test_admin_overview_reports_live_bridge_and_job_counts(self) -> None:
        response = self.client.get("/api/admin/overview")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["backend"]["status"], "online")
        self.assertEqual(response.json()["muse"]["authenticated"], False)
        self.assertEqual(
            set(response.json()["jobs"]),
            {"queued", "running", "completed", "failed", "total"},
        )

    def test_connection_error_preserves_unicode_for_diagnostics(self) -> None:
        error = _connect_error(ValueError("Muse từ chối ý tưởng tiếng Việt."))

        self.assertIn("ý tưởng", error.detail)
        self.assertIn("Muse", error.detail)

    def test_video_job_store_persists_jobs_and_files(self) -> None:
        with TemporaryDirectory() as directory:
            store = JobStore(Path(directory) / "jobs.sqlite3")
            job = VideoJob(
                id="persistent-job",
                status="completed",
                prompt="Một video quảng cáo sản phẩm.",
                files=[Path(directory) / "result.mp4"],
                session_id="muse-session",
            )
            store.save(job)

            restored = store.load()

        self.assertEqual(len(restored), 1)
        self.assertEqual(restored[0].status, "completed")
        self.assertEqual(restored[0].prompt, job.prompt)
        self.assertEqual(restored[0].files, job.files)
        self.assertEqual(restored[0].session_id, job.session_id)

    def test_generated_muse_chat_session_keeps_its_account_assignment(self) -> None:
        user_store.save_chat_session("generated-session", self.user["id"], None)
        user_store.save_chat_session("generated-session", self.user["id"], "muse-account")

        self.assertTrue(user_store.owns_chat_session("generated-session", self.user["id"]))
        self.assertEqual(
            user_store.chat_session_account("generated-session", self.user["id"]),
            "muse-account",
        )

    def test_download_grant_allows_opening_protected_video_without_bridge_header(self) -> None:
        job_id = uuid4().hex
        with TemporaryDirectory() as directory:
            video_path = Path(directory) / "clip.mp4"
            video_path.write_bytes(b"test-video")
            state.jobs[job_id] = VideoJob(
                id=job_id,
                status="completed",
                user_id=self.user["id"],
                files=[video_path],
            )
            try:
                access = self.client.get(
                    f"/api/muse/jobs/{job_id}/files/0/access"
                )
                self.assertEqual(access.status_code, 200)

                video = self.client.get(access.json()["url"])
                self.assertEqual(video.status_code, 200)
                self.assertEqual(video.content, b"test-video")
            finally:
                state.jobs.pop(job_id, None)
                for grant, target in list(state.download_grants.items()):
                    if target[0] == job_id:
                        state.download_grants.pop(grant, None)

    def test_chat_requires_a_muse_session(self) -> None:
        with TemporaryDirectory() as directory:
            with (
                patch("backend.main.STATE_DIR", Path(directory)),
                patch.object(user_store, "muse_accounts", return_value=[]),
            ):
                response = self.client.post(
                    "/api/muse/chat",
                    json={"prompt": "Giúp tôi viết một ý tưởng video."},
                )

        self.assertEqual(response.status_code, 503)
        self.assertIn("nhóm xử lý", response.json()["detail"])

    def test_video_requires_a_muse_session(self) -> None:
        with TemporaryDirectory() as directory:
            with (
                patch("backend.main.STATE_DIR", Path(directory)),
                patch.object(user_store, "muse_accounts", return_value=[]),
            ):
                response = self.client.post(
                    "/api/muse/videos",
                    json={"prompt": "Một chiếc thuyền trên biển lúc bình minh."},
                )

        self.assertEqual(response.status_code, 503)

    def test_invalid_image_payload_is_rejected(self) -> None:
        with self.assertRaises(HTTPException) as error:
            _validated_images(
                [ImageInput(name="bad.jpg", base64="not valid base64")],
                "unit-test",
            )

        self.assertEqual(error.exception.status_code, 400)

    def test_registration_issues_session_and_logout_revokes_it(self) -> None:
        client = TestClient(app)
        response = client.post(
            "/api/auth/register",
            json={"email": " Person@Example.com ", "password": "A-long-test-password-123"},
        )

        self.assertEqual(response.status_code, 200)
        token = response.json()["token"]
        self.assertEqual(response.json()["user"]["role"], "user")
        client.headers.update({"Authorization": f"Bearer {token}"})
        self.assertEqual(client.get("/api/auth/me").json()["user"]["email"], "person@example.com")
        self.assertEqual(client.post("/api/auth/logout").status_code, 200)
        self.assertEqual(client.get("/api/auth/me").status_code, 401)
        client.close()

    def test_registration_rejects_duplicate_email_and_short_password(self) -> None:
        duplicate = self.client.post(
            "/api/auth/register",
            json={"email": "admin@example.com", "password": "A-long-test-password-123"},
        )
        short_password = self.client.post(
            "/api/auth/register",
            json={"email": "new@example.com", "password": "short"},
        )

        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(short_password.status_code, 422)

    def test_logout_revokes_image_preview_links_for_user(self) -> None:
        client = TestClient(app)
        registration = client.post(
            "/api/auth/register",
            json={"email": "preview-owner@example.com", "password": "A-long-preview-password-123"},
        )
        user_id = registration.json()["user"]["id"]
        token = registration.json()["token"]
        client.headers.update({"Authorization": "Bearer " + token})
        grant = uuid4().hex
        state.image_grants[grant] = (
            user_id,
            Path("image.png"),
            "image.png",
            time.monotonic() + 60,
        )
        try:
            self.assertEqual(client.post("/api/auth/logout").status_code, 200)
            self.assertNotIn(grant, state.image_grants)
        finally:
            state.image_grants.pop(grant, None)
            client.close()

    def test_admin_bootstrap_requires_strong_password_and_creates_admin(self) -> None:
        with TemporaryDirectory() as directory:
            store = UserStore(Path(directory) / "tdluxy.sqlite3")
            with patch.dict(
                "os.environ",
                {
                    "TDLUXY_ADMIN_EMAIL": "owner@example.com",
                    "TDLUXY_ADMIN_PASSWORD": "short",
                },
            ):
                with self.assertRaisesRegex(RuntimeError, "at least 12 characters"):
                    store.initialize()

        with TemporaryDirectory() as directory:
            store = UserStore(Path(directory) / "tdluxy.sqlite3")
            with patch.dict(
                "os.environ",
                {
                    "TDLUXY_ADMIN_EMAIL": "owner@example.com",
                    "TDLUXY_ADMIN_PASSWORD": "A-strong-admin-password-123",
                },
            ):
                store.initialize()
                admin = store.authenticate(
                    "owner@example.com",
                    "A-strong-admin-password-123",
                )

        self.assertIsNotNone(admin)
        self.assertEqual(admin["role"], "admin")

    def test_user_cannot_access_admin_routes_or_another_users_job(self) -> None:
        user = user_store.create_user("member@example.com", "Another-test-password-123")
        token = user_store.issue_session(user["id"])
        client = TestClient(app)
        client.headers.update({"Authorization": f"Bearer {token}"})
        job_id = uuid4().hex
        state.jobs[job_id] = VideoJob(id=job_id, user_id=self.user["id"])
        try:
            self.assertEqual(client.get("/api/admin/overview").status_code, 403)
            self.assertEqual(client.get("/api/muse/accounts").status_code, 403)
            self.assertEqual(client.get(f"/api/muse/jobs/{job_id}").status_code, 404)
        finally:
            state.jobs.pop(job_id, None)
            client.close()

    def test_image_edit_returns_processed_jpeg(self) -> None:
        response = self.client.post(
            "/api/media/images/edit",
            json={
                "image": self.image_payload("sample.jpg", (120, 90, 60)),
                "preset": "warm",
            },
        )

        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["media_type"], "image/jpeg")
        decoded = base64.b64decode(result["image_base64"])
        with Image.open(BytesIO(decoded)) as image:
            self.assertEqual(image.format, "JPEG")
            self.assertEqual(image.size, (40, 30))

    def test_collage_requires_two_images_and_exports_portrait_canvas(self) -> None:
        response = self.client.post(
            "/api/media/images/collage",
            json={
                "images": [
                    self.image_payload("one.jpg", (180, 20, 20)),
                    self.image_payload("two.jpg", (20, 20, 180)),
                ]
            },
        )

        self.assertEqual(response.status_code, 200)
        result = response.json()
        with Image.open(BytesIO(base64.b64decode(result["image_base64"]))) as image:
            self.assertEqual(image.size, (1080, 1350))
            self.assertEqual(image.format, "JPEG")

    def test_muse_image_outputs_are_returned_as_displayable_previews(self) -> None:
        output = BytesIO()
        Image.new("RGB", (32, 24), (45, 90, 135)).save(output, format="PNG")
        encoded = base64.b64encode(output.getvalue()).decode("ascii")
        with TemporaryDirectory() as directory:
            grants_before = set(state.image_grants)
            account = type(
                "FakeMuseAccount",
                (),
                {"temp_dir": type("FakeTempDir", (), {"name": directory})()},
            )()
            with patch("backend.main.OUTPUT_DIR", Path(directory) / "outputs"):
                previews, errors = asyncio.run(
                    _muse_image_previews(
                        account,
                        {
                            "messages": [
                                {
                                    "role": "user",
                                    "content": [
                                        {
                                            "type": "image",
                                            "mime_type": "image/png",
                                            "data_base64": encoded,
                                        }
                                    ],
                                },
                                {
                                    "role": "assistant",
                                    "content": [
                                        {
                                            "type": "image",
                                            "mime_type": "image/png",
                                            "data_base64": encoded,
                                        }
                                    ],
                                },
                            ]
                        },
                        self.user["id"],
                    )
                )
                preview = previews[0]
                grant = preview["image_url"].rsplit("/", 1)[-1]
                stored = state.image_grants[grant][1]
                self.assertEqual(stored.read_bytes(), output.getvalue())
                with Image.open(
                    BytesIO(base64.b64decode(preview["preview_base64"]))
                ) as image:
                    self.assertEqual(image.size, (32, 24))
                    self.assertEqual(image.format, "JPEG")
                image_response = self.client.get(preview["image_url"])
                self.assertEqual(image_response.status_code, 200)
                self.assertEqual(image_response.content, output.getvalue())
                self.assertIn("inline", image_response.headers["content-disposition"])
                self.assertEqual(preview["width"], 32)
                self.assertEqual(preview["height"], 24)
            self.assertEqual(errors, [])
            self.assertEqual(len(previews), 1)
            for grant in set(state.image_grants) - grants_before:
                state.image_grants.pop(grant, None)

    def test_muse_cookie_vault_encrypts_and_restores_credentials(self) -> None:
        key = Fernet.generate_key().decode("ascii")
        cookie_bytes = b'[{"name":"session","value":"sensitive-cookie"}]'
        with patch.dict("os.environ", {"TDLUXY_MUSE_VAULT_KEY": key}):
            user_store.save_muse_account("account-one", "muse@example.com", cookie_bytes)
            record = user_store.muse_account("account-one")

        self.assertIsNotNone(record)
        self.assertEqual(record["cookies"], cookie_bytes)
        self.assertNotIn(cookie_bytes, record["cookies_ciphertext"])

    def test_muse_cookie_vault_requires_a_configured_key(self) -> None:
        with patch.dict("os.environ", {"TDLUXY_MUSE_VAULT_KEY": ""}):
            with self.assertRaises(HTTPException) as error:
                user_store.save_muse_account("account-one", "muse@example.com", b"[]")

        self.assertEqual(error.exception.status_code, 503)

    def test_remote_publisher_frame_requires_an_open_session(self) -> None:
        response = self.client.get("/api/publisher/session/frame")

        self.assertEqual(response.status_code, 404)
        self.assertIn("Chưa mở phiên", response.json()["detail"])

    def test_browser_guard_blocks_local_network_targets(self) -> None:
        class FakeRequest:
            url = "http://127.0.0.1:8787/api/health"

        class FakeRoute:
            request = FakeRequest()
            aborted = False
            continued = False

            async def abort(self, _reason: str) -> None:
                self.aborted = True

            async def continue_(self) -> None:
                self.continued = True

        route = FakeRoute()
        asyncio.run(_guard_browser_request(route))

        self.assertTrue(route.aborted)
        self.assertFalse(route.continued)


if __name__ == "__main__":
    unittest.main()
