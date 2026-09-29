"""Avatar upload: animated GIFs allowed, type decided by the bytes, URL versioned."""

import struct
from pathlib import Path

import httpx
import pytest

import app.core.s3 as s3

GIF = b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x00\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"


def _png(w: int, h: int) -> bytes:
    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + b"\x00\x00\x00\x00"

    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    return b"\x89PNG\r\n\x1a\n" + ihdr + chunk(b"IDAT", b"\x00") + chunk(b"IEND", b"")


PNG = _png(64, 64)


@pytest.fixture(autouse=True)
def local_storage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(s3, "_is_s3_configured", lambda: False)
    monkeypatch.setattr(s3, "LOCAL_STORAGE_DIR", tmp_path)
    return tmp_path


async def _register(client: httpx.AsyncClient, email: str) -> dict:
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "securepass123", "name": "Avatar", "kvkk_consent": True},
    )
    body = resp.json()
    return {"id": body["user_id"], "headers": {"Authorization": f"Bearer {body['access_token']}"}}


async def _upload(client: httpx.AsyncClient, user: dict, data: bytes, ctype: str) -> httpx.Response:
    return await client.post(
        "/api/v1/auth/me/avatar",
        files={"file": ("avatar", data, ctype)},
        headers=user["headers"],
    )


@pytest.mark.asyncio
async def test_animated_gif_avatar_is_accepted_and_served_as_gif(
    client: httpx.AsyncClient, local_storage: Path
) -> None:
    user = await _register(client, "avatar_gif@example.com")
    resp = await _upload(client, user, GIF, "image/gif")
    assert resp.status_code == 200, resp.text
    url = resp.json()["avatar_url"]
    assert url.split("?")[0].endswith(f"avatar_{user['id']}.gif")
    assert "?v=" in url  # versioned so the new GIF isn't masked by caches
    assert (local_storage / user["id"] / f"avatar_{user['id']}.gif").read_bytes() == GIF


@pytest.mark.asyncio
async def test_type_comes_from_bytes_not_the_client_label(client: httpx.AsyncClient) -> None:
    # The app labels every upload image/jpeg — a PNG must still be a .png.
    user = await _register(client, "avatar_png@example.com")
    resp = await _upload(client, user, PNG, "image/jpeg")
    assert resp.status_code == 200, resp.text
    assert resp.json()["avatar_url"].split("?")[0].endswith(".png")


@pytest.mark.asyncio
async def test_non_image_labelled_gif_is_rejected(client: httpx.AsyncClient) -> None:
    user = await _register(client, "avatar_fake@example.com")
    resp = await _upload(client, user, b"<script>alert(1)</script>", "image/gif")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_gif_frame_bomb_avatar_is_rejected(client: httpx.AsyncClient) -> None:
    user = await _register(client, "avatar_bomb@example.com")
    frame = b"\x2c" + struct.pack("<HHHHB", 0, 0, 1, 1, 0) + b"\x02\x02\x4c\x01\x00"
    bomb = b"GIF89a" + struct.pack("<HHBBB", 1, 1, 0, 0, 0) + frame * 400 + b"\x3b"
    resp = await _upload(client, user, bomb, "image/gif")
    assert resp.status_code == 400
    assert resp.json()["detail"] == "TOO_MANY_FRAMES"
