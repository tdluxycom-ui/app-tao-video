from __future__ import annotations

import base64
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import AsyncMock

from PIL import Image

from muse_ai.attachments import build_image_item, build_items
from muse_ai.client import MuseClient
from muse_ai.filesystem import normalize_gateway_path
from muse_ai.media import (
    VideoRef,
    extract_image_refs,
    extract_session_ids,
    extract_video_refs,
)
from muse_ai.noise import CipherState, NoiseXXInitiator, PROTOCOL, SymmetricState, hkdf_noise, nonce12
from muse_ai.wire import NoiseChunk, NoiseReassembler, split_noise_payload


def test_cipher_state_roundtrip():
    key = bytes(range(32))
    tx = CipherState(key)
    rx = CipherState(key)
    ciphertext = tx.encrypt_with_ad(b"ad", b"hello")
    assert rx.decrypt_with_ad(b"ad", ciphertext) == b"hello"


def test_noise_nonce_big_endian():
    assert nonce12(1) == b"\x00" * 11 + b"\x01"
    assert nonce12(0x0102030405060708)[4:] == bytes.fromhex("0102030405060708")


def test_hkdf_is_deterministic():
    a = hkdf_noise(b"a" * 32, b"b" * 32)
    b = hkdf_noise(b"a" * 32, b"b" * 32)
    assert a == b
    assert all(len(item) == 32 for item in a)


def test_noise_protocol_name_initialization():
    # Noise spec: protocol names <= HASHLEN are zero-padded to HASHLEN.
    assert len(PROTOCOL) < 32
    state = SymmetricState()
    assert len(state.ck) == 32
    assert len(state.h) == 32

    initiator = NoiseXXInitiator()
    message1 = initiator.write_message1(b"")
    assert len(message1) == 32


def test_noise_fragment_reassembly():
    raw = b"x" * 140_000
    chunks = split_noise_payload(raw)
    assert len(chunks) == 3
    reassembler = NoiseReassembler()
    result = None
    for chunk in chunks:
        result = reassembler.feed(chunk)
    assert result == raw


def test_gateway_path_normalization():
    assert normalize_gateway_path(r"C:\Users\alice\workspace\user\files\a.mp4") == "workspace/user/files/a.mp4"
    assert normalize_gateway_path("/home/alice/workspace/user/files/a.mp4") == "workspace/user/files/a.mp4"
    assert normalize_gateway_path("file:///workspace/user/files/a.mp4?x=1") == "workspace/user/files/a.mp4"


def test_media_extraction_prefers_stable_path():
    data = {
        "session_id": "session-1",
        "media": {
            "kind": "video",
            "mime_type": "video/mp4",
            "path": "workspace/user/files/result.mp4",
            "resource_id": "resource-1",
            "media_handle": "media-handle-1",
            "variants": {
                "original": "https://cdn.example.invalid/result.mp4?grant=one"
            },
        },
    }
    refs = extract_video_refs(data)
    assert len(refs) == 1
    assert refs[0].identity == "workspace/user/files/result.mp4"
    assert refs[0].media_handle == "media-handle-1"
    assert extract_session_ids(data) == ["session-1"]


def test_image_media_extraction_supports_inline_and_muse_media_references():
    data = {
        "messages": [
            {
                "role": "assistant",
                "content": [
                    {
                        "type": "image",
                        "mime_type": "image/png",
                        "data_base64": "aW1hZ2UtYnl0ZXM=",
                    },
                    {
                        "kind": "image",
                        "mime_type": "image/webp",
                        "path": "workspace/output/generated.webp",
                        "media_handle": "image-handle",
                    },
                    {
                        "type": "image",
                        "url": "https://cdn.example.invalid/result",
                        "mimeType": "image/jpeg",
                    },
                ],
            }
        ]
    }

    refs = extract_image_refs(data)

    assert len(refs) == 3
    assert refs[0].data_base64 == "aW1hZ2UtYnl0ZXM="
    assert refs[1].path == "workspace/output/generated.webp"
    assert refs[1].media_handle == "image-handle"
    assert refs[2].url == "https://cdn.example.invalid/result"


def test_build_inline_image_item(tmp_path: Path):
    path = tmp_path / "image.png"
    Image.new("RGB", (16, 16), (10, 20, 30)).save(path)
    item = build_image_item(path)
    assert item["type"] == "image"
    assert item["mime_type"] == "image/png"
    assert base64.b64decode(item["data_base64"]).startswith(b"\x89PNG")


def test_build_text_only_items():
    items = build_items([], "Create a cinematic 10-second video")
    assert items == [
        {"type": "text", "text": "Create a cinematic 10-second video"}
    ]


async def test_generate_video_submits_prompt_and_images_through_muse_chat(tmp_path: Path):
    client = MuseClient(
        auth=SimpleNamespace(state_dir=tmp_path),
        state_dir=tmp_path,
    )
    prompt = "Create a vertical product video."
    session_id = "shared-muse-chat"
    image_path = tmp_path / "reference.png"
    Image.new("RGB", (16, 16), (10, 20, 30)).save(image_path)
    client.history = AsyncMock(return_value={})
    client.chat_stream = AsyncMock(return_value=[])
    client.wait_for_videos = AsyncMock(
        return_value=([VideoRef(path="workspace/result.mp4")], {})
    )

    result = await client.generate_video(
        prompt=prompt,
        images=[image_path],
        output_dir=tmp_path / "outputs",
        session_id=session_id,
        download=False,
    )

    client.chat_stream.assert_awaited_once_with(
        prompt=prompt,
        images=[image_path],
        session_id=session_id,
    )
    client.wait_for_videos.assert_awaited_once()
    assert result.session_id == session_id
    assert result.videos == [VideoRef(path="workspace/result.mp4")]
