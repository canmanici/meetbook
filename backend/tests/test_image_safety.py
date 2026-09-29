"""Upload sanitizer: type from bytes, image-bomb limits, metadata stripping."""

import struct

import pytest

from app.core.image_safety import (
    AVATAR_LIMITS,
    PHOTO_LIMITS,
    UnsafeImageError,
    sanitize_image,
)


def _seg(marker: int, body: bytes) -> bytes:
    return bytes([0xFF, marker]) + struct.pack(">H", len(body) + 2) + body


def _exif_app1(orientation: int, secret: bytes) -> bytes:
    """APP1 Exif with Orientation + a fake GPS payload we must not leak."""
    ifd = struct.pack("<H", 1) + struct.pack("<HHIHH", 0x0112, 3, 1, orientation, 0)
    tiff = b"II*\x00" + struct.pack("<I", 8) + ifd + struct.pack("<I", 0) + secret
    return _seg(0xE1, b"Exif\x00\x00" + tiff)


def _jpeg(w: int, h: int, *, app1: bytes = b"") -> bytes:
    sof = _seg(0xC0, b"\x08" + struct.pack(">HH", h, w) + b"\x01\x01\x11\x00")
    sos = _seg(0xDA, b"\x01\x01\x00\x00\x3f\x00")
    return (
        b"\xff\xd8"
        + _seg(0xE0, b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00")
        + app1
        + sof
        + sos
        + b"\x12\x34"
        + b"\xff\xd9"
    )


def _png(w: int, h: int, extra: bytes = b"") -> bytes:
    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + b"\x00\x00\x00\x00"

    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    return b"\x89PNG\r\n\x1a\n" + ihdr + extra + chunk(b"IDAT", b"\x00") + chunk(b"IEND", b"")


def _gif(frames: int, w: int = 10, h: int = 10) -> bytes:
    out = b"GIF89a" + struct.pack("<HHBBB", w, h, 0, 0, 0)
    frame = b"\x2c" + struct.pack("<HHHHB", 0, 0, w, h, 0) + b"\x02\x02\x4c\x01\x00"
    return out + frame * frames + b"\x3b"


def test_jpeg_gps_is_stripped_but_orientation_survives() -> None:
    secret = b"GPSLatitude=41.0082N,28.9784E"
    safe = sanitize_image(_jpeg(4000, 3000, app1=_exif_app1(6, secret)), PHOTO_LIMITS)
    assert safe.content_type == "image/jpeg"
    assert (safe.width, safe.height) == (4000, 3000)
    assert secret not in safe.data  # location gone
    assert struct.pack("<HHIHH", 0x0112, 3, 1, 6, 0) in safe.data  # still rotated right
    assert safe.data.endswith(b"\x12\x34\xff\xd9")  # image data untouched


def test_label_is_ignored_png_detected_from_bytes() -> None:
    safe = sanitize_image(_png(800, 600), PHOTO_LIMITS)
    assert safe.content_type == "image/png"


def test_png_metadata_chunks_removed() -> None:
    text = struct.pack(">I", 11) + b"tEXt" + b"GPS\x0041.0,28" + b"\x00" * 4
    safe = sanitize_image(_png(100, 100, extra=text), PHOTO_LIMITS)
    assert b"tEXt" not in safe.data


def test_tiny_file_claiming_huge_canvas_is_rejected() -> None:
    bomb = _png(50_000, 50_000)
    assert len(bomb) < 100
    with pytest.raises(UnsafeImageError) as err:
        sanitize_image(bomb, PHOTO_LIMITS)
    assert err.value.code == "IMAGE_TOO_LARGE"


def test_gif_frame_bomb_is_rejected_normal_gif_allowed() -> None:
    assert sanitize_image(_gif(20), AVATAR_LIMITS).frames == 20
    with pytest.raises(UnsafeImageError) as err:
        sanitize_image(_gif(400), AVATAR_LIMITS)
    assert err.value.code == "TOO_MANY_FRAMES"


def test_gif_not_allowed_for_book_photos() -> None:
    with pytest.raises(UnsafeImageError) as err:
        sanitize_image(_gif(1), PHOTO_LIMITS)
    assert err.value.code == "INVALID_IMAGE_FORMAT"


def test_truncated_or_fake_files_are_rejected() -> None:
    with pytest.raises(UnsafeImageError) as err:
        sanitize_image(_jpeg(100, 100)[:12], PHOTO_LIMITS)
    assert err.value.code == "INVALID_IMAGE"
    with pytest.raises(UnsafeImageError):
        sanitize_image(b"<svg onload=alert(1)>", AVATAR_LIMITS)


def test_webp_exif_chunk_removed_and_flag_cleared() -> None:
    vp8x = (
        b"VP8X"
        + struct.pack("<I", 10)
        + bytes([0x08, 0, 0, 0])
        + (99).to_bytes(3, "little")
        + (99).to_bytes(3, "little")
    )
    exif = b"EXIF" + struct.pack("<I", 4) + b"GPS!"
    vp8l = b"VP8L" + struct.pack("<I", 6) + b"\x2f" + b"\x00" * 5
    body = b"WEBP" + vp8x + exif + vp8l
    data = b"RIFF" + struct.pack("<I", len(body)) + body
    safe = sanitize_image(data, AVATAR_LIMITS)
    assert b"GPS!" not in safe.data and b"EXIF" not in safe.data
    assert safe.data[20] & 0x08 == 0  # EXIF flag cleared in VP8X
    assert (safe.width, safe.height) == (100, 100)
    assert struct.unpack("<I", safe.data[4:8])[0] == len(safe.data) - 8
