"""Untrusted image uploads: real type, bomb limits, metadata stripping.

Every user image (avatar, book photo, loan photo, fetched cover) passes
through :func:`sanitize_image` before it is stored:

1. **Type from the bytes**, never the client's Content-Type label.
2. **Decompression-bomb limits** from the file header (no decoding here):
   a 1 KB file can declare 30000×30000 px or thousands of GIF frames — the
   server never opens it, but every phone that renders it would try to and
   freeze/crash.
3. **Metadata stripped** (EXIF/XMP/IPTC): phone photos carry the GPS
   coordinates where they were taken — often the uploader's home — readable
   by anyone who downloads the image. The JPEG orientation tag is kept (as a
   minimal EXIF block) so photos aren't shown sideways.

Pure-Python header parsing on purpose: no image library decoding untrusted
input on the server.
"""

import struct
from dataclasses import dataclass


class UnsafeImageError(ValueError):
    """Raised with a stable error code for the API response."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class ImageLimits:
    allowed: frozenset[str]
    max_side: int
    max_pixels: int  # width × height of one frame
    max_frames: int = 1
    max_total_pixels: int | None = None  # width × height × frames (animations)


AVATAR_LIMITS = ImageLimits(
    allowed=frozenset({"image/jpeg", "image/png", "image/webp", "image/gif"}),
    max_side=4096,
    max_pixels=16_000_000,
    max_frames=300,
    max_total_pixels=30_000_000,
)
PHOTO_LIMITS = ImageLimits(
    allowed=frozenset({"image/jpeg", "image/png", "image/webp"}),
    max_side=8192,
    max_pixels=50_000_000,  # 48–50 MP phone cameras
)


@dataclass(frozen=True)
class SafeImage:
    content_type: str
    data: bytes
    width: int
    height: int
    frames: int


def sniff_image_type(data: bytes) -> str | None:
    """Content type from the file's magic bytes (jpeg/png/webp/gif) or None."""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return None


def sanitize_image(data: bytes, limits: ImageLimits) -> SafeImage:
    ctype = sniff_image_type(data)
    if ctype is None or ctype not in limits.allowed:
        raise UnsafeImageError("INVALID_IMAGE_FORMAT")
    try:
        if ctype == "image/jpeg":
            (w, h), frames = _jpeg_size(data), 1
            clean = _strip_jpeg(data)
        elif ctype == "image/png":
            (w, h), frames = _png_size(data), _png_frames(data)
            clean = _strip_png(data)
        elif ctype == "image/webp":
            w, h, frames = _webp_info(data)
            clean = _strip_webp(data)
        else:
            w, h, frames = _gif_info(data)
            clean = data  # GIFs carry no location metadata
    except (IndexError, struct.error, ValueError) as exc:
        if isinstance(exc, UnsafeImageError):
            raise
        raise UnsafeImageError("INVALID_IMAGE") from None

    if w <= 0 or h <= 0:
        raise UnsafeImageError("INVALID_IMAGE")
    if w > limits.max_side or h > limits.max_side or w * h > limits.max_pixels:
        raise UnsafeImageError("IMAGE_TOO_LARGE")
    if frames > limits.max_frames:
        raise UnsafeImageError("TOO_MANY_FRAMES")
    if limits.max_total_pixels is not None and w * h * frames > limits.max_total_pixels:
        raise UnsafeImageError("IMAGE_TOO_LARGE")
    return SafeImage(content_type=ctype, data=clean, width=w, height=h, frames=frames)


# ── JPEG ──────────────────────────────────────────────────────────────────

_SOF = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
_STANDALONE = {0x01, *range(0xD0, 0xD8)}  # TEM, RSTn


def _jpeg_segments(data: bytes):
    """Yield (marker, segment_start, segment_end) up to and including SOS."""
    i = 2
    n = len(data)
    while i < n:
        if data[i] != 0xFF:
            raise ValueError("bad marker")
        while i < n and data[i] == 0xFF:  # fill bytes
            i += 1
        marker = data[i]
        start = i - 1
        i += 1
        if marker in _STANDALONE:
            yield marker, start, i
            continue
        if marker == 0xD9:  # EOI
            yield marker, start, i
            return
        (length,) = struct.unpack(">H", data[i : i + 2])
        if length < 2:
            raise ValueError("bad length")
        end = i + length
        if end > n:
            raise ValueError("truncated")
        yield marker, start, end
        if marker == 0xDA:  # SOS: entropy-coded data follows
            return
        i = end
    raise ValueError("no SOS")


def _jpeg_size(data: bytes) -> tuple[int, int]:
    for marker, start, _end in _jpeg_segments(data):
        if marker in _SOF:
            h, w = struct.unpack(">HH", data[start + 5 : start + 9])
            return w, h
    raise ValueError("no SOF")


def _jpeg_orientation(segment: bytes) -> int | None:
    """Orientation (1–8) from an APP1 Exif segment, if present."""
    body = segment[4:]
    if not body.startswith(b"Exif\x00\x00"):
        return None
    tiff = body[6:]
    order = {b"II": "<", b"MM": ">"}.get(tiff[:2])
    if order is None:
        return None
    (ifd,) = struct.unpack(order + "I", tiff[4:8])
    (count,) = struct.unpack(order + "H", tiff[ifd : ifd + 2])
    for k in range(count):
        entry = tiff[ifd + 2 + 12 * k : ifd + 14 + 12 * k]
        tag, typ = struct.unpack(order + "HH", entry[:4])
        if tag == 0x0112 and typ == 3:
            (value,) = struct.unpack(order + "H", entry[8:10])
            return value if 1 <= value <= 8 else None
    return None


def _orientation_app1(orientation: int) -> bytes:
    """Minimal APP1 Exif segment holding only the Orientation tag."""
    tiff = b"II*\x00" + struct.pack("<I", 8)
    tiff += struct.pack("<H", 1) + struct.pack("<HHIHH", 0x0112, 3, 1, orientation, 0)
    tiff += struct.pack("<I", 0)
    body = b"Exif\x00\x00" + tiff
    return b"\xff\xe1" + struct.pack(">H", len(body) + 2) + body


def _strip_jpeg(data: bytes) -> bytes:
    """Drop EXIF/XMP (APP1), IPTC (APP13) and comments; keep JFIF, ICC,
    Adobe and everything needed to decode. Orientation survives."""
    out = [b"\xff\xd8"]
    orientation: int | None = None
    sos_end = None
    for marker, start, end in _jpeg_segments(data):
        seg = data[start:end]
        if marker == 0xE1:
            orientation = orientation or _safe(lambda s=seg: _jpeg_orientation(s))
            continue
        if marker in (0xED, 0xFE):  # APP13 IPTC, COM
            continue
        if marker == 0xDA:
            if orientation and orientation != 1:
                out.append(_orientation_app1(orientation))
            sos_end = end
            out.append(seg)
            break
        out.append(seg)
    if sos_end is None:
        raise ValueError("no SOS")
    out.append(data[sos_end:])
    return b"".join(out)


def _safe(fn):
    try:
        return fn()
    except IndexError, struct.error, ValueError:
        return None


# ── PNG ───────────────────────────────────────────────────────────────────


def _png_chunks(data: bytes):
    i = 8
    while i + 8 <= len(data):
        (length,) = struct.unpack(">I", data[i : i + 4])
        ctype = data[i + 4 : i + 8]
        end = i + 12 + length
        if end > len(data):
            raise ValueError("truncated")
        yield ctype, i, end
        if ctype == b"IEND":
            return
        i = end


def _png_size(data: bytes) -> tuple[int, int]:
    if data[12:16] != b"IHDR":
        raise ValueError("no IHDR")
    w, h = struct.unpack(">II", data[16:24])
    return w, h


def _png_frames(data: bytes) -> int:
    for ctype, start, _end in _png_chunks(data):
        if ctype == b"acTL":  # animated PNG
            (frames,) = struct.unpack(">I", data[start + 8 : start + 12])
            return frames
    return 1


_PNG_METADATA = {b"eXIf", b"tEXt", b"zTXt", b"iTXt", b"tIME"}


def _strip_png(data: bytes) -> bytes:
    out = [data[:8]]
    for ctype, start, end in _png_chunks(data):
        if ctype not in _PNG_METADATA:
            out.append(data[start:end])
    return b"".join(out)


# ── WebP ──────────────────────────────────────────────────────────────────


def _webp_chunks(data: bytes):
    i = 12
    while i + 8 <= len(data):
        fourcc = data[i : i + 4]
        (size,) = struct.unpack("<I", data[i + 4 : i + 8])
        end = i + 8 + size + (size & 1)  # chunks are padded to even size
        if i + 8 + size > len(data):
            raise ValueError("truncated")
        yield fourcc, i, min(end, len(data))
        i = end


def _webp_info(data: bytes) -> tuple[int, int, int]:
    frames = 0
    w = h = 0
    for fourcc, start, _end in _webp_chunks(data):
        payload = start + 8
        if fourcc == b"VP8X":
            w = 1 + int.from_bytes(data[payload + 4 : payload + 7], "little")
            h = 1 + int.from_bytes(data[payload + 7 : payload + 10], "little")
        elif fourcc == b"VP8 " and not w:
            w, h = struct.unpack("<HH", data[payload + 6 : payload + 10])
            w, h = w & 0x3FFF, h & 0x3FFF
        elif fourcc == b"VP8L" and not w:
            bits = int.from_bytes(data[payload + 1 : payload + 5], "little")
            w, h = (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
        elif fourcc == b"ANMF":
            frames += 1
    return w, h, max(frames, 1)


def _strip_webp(data: bytes) -> bytes:
    parts: list[bytes] = []
    for fourcc, start, end in _webp_chunks(data):
        chunk = data[start:end]
        if fourcc in (b"EXIF", b"XMP "):
            continue
        if fourcc == b"VP8X":
            flags = chunk[8] & ~0x0C  # clear EXIF (0x08) and XMP (0x04) bits
            chunk = chunk[:8] + bytes([flags]) + chunk[9:]
        parts.append(chunk)
    body = b"WEBP" + b"".join(parts)
    return b"RIFF" + struct.pack("<I", len(body)) + body


# ── GIF ───────────────────────────────────────────────────────────────────


def _gif_skip_subblocks(data: bytes, i: int) -> int:
    while True:
        size = data[i]
        i += 1
        if size == 0:
            return i
        i += size
        if i > len(data):
            raise ValueError("truncated")


def _gif_info(data: bytes) -> tuple[int, int, int]:
    w, h, flags = struct.unpack("<HHB", data[6:11])
    i = 13
    if flags & 0x80:
        i += 3 * (2 ** ((flags & 0x07) + 1))
    frames = 0
    while i < len(data):
        block = data[i]
        if block == 0x3B:  # trailer
            break
        if block == 0x21:  # extension
            i = _gif_skip_subblocks(data, i + 2)
        elif block == 0x2C:  # image descriptor
            fw, fh, fflags = struct.unpack("<HHB", data[i + 5 : i + 10])
            if fw > w or fh > h:
                w, h = max(w, fw), max(h, fh)  # frames can't exceed the canvas
            frames += 1
            i += 10
            if fflags & 0x80:
                i += 3 * (2 ** ((fflags & 0x07) + 1))
            i = _gif_skip_subblocks(data, i + 1)  # LZW min code size + data
        else:
            raise ValueError("bad GIF block")
    if frames == 0:
        raise ValueError("no frames")
    return w, h, frames
