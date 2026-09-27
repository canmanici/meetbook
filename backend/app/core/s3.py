"""Photo storage — S3 when configured, local filesystem fallback."""

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from app.core.config import get_settings

logger = logging.getLogger(__name__)

LOCAL_STORAGE_DIR = Path("/app/media/book_photos")


def _is_s3_configured() -> bool:
    settings = get_settings()
    return bool(settings.s3_bucket and settings.s3_access_key)


# One S3 client per process (per event loop). Building an aioboto3 Session +
# client costs ~80 ms of CPU and leaves ~5 MB of cyclic garbage behind; doing
# it per request (the storage proxy serves every photo) measured 184 → 403 MB
# RSS over 45 requests. A shared client answers in ~4 ms and keeps its
# connection pool warm.
_client: Any = None
_client_cm: Any = None
_client_loop: asyncio.AbstractEventLoop | None = None
_client_lock: asyncio.Lock | None = None
_lock_loop: asyncio.AbstractEventLoop | None = None


async def _shared_client() -> Any:
    global _client, _client_cm, _client_loop, _client_lock, _lock_loop

    loop = asyncio.get_running_loop()
    if _client is not None and _client_loop is loop:
        return _client
    if _client_lock is None or _lock_loop is not loop:
        # A new loop (tests create one per test): locks and clients are loop-bound.
        _client_lock, _lock_loop = asyncio.Lock(), loop
    async with _client_lock:
        if _client is not None and _client_loop is loop:
            return _client

        import aioboto3
        from botocore.config import Config

        settings = get_settings()
        cm = aioboto3.Session().client(
            "s3",
            endpoint_url=settings.s3_endpoint or None,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            config=Config(signature_version="s3v4", max_pool_connections=50),
        )
        client = await cm.__aenter__()
        _client, _client_cm, _client_loop = client, cm, loop
        return client


@asynccontextmanager
async def get_s3_client() -> AsyncIterator[Any]:
    """Shared S3 client used by lifespan, storage proxy, and uploads.

    The client is created once and reused; leaving the context does NOT close
    it (see ``close_s3_client``, called on app shutdown).

    Usage:
        async with get_s3_client() as client:
            await client.put_object(Bucket=..., Key=..., Body=...)
    """
    yield await _shared_client()


async def close_s3_client() -> None:
    """Close the shared client (app shutdown)."""
    global _client, _client_cm, _client_loop

    cm, loop = _client_cm, _client_loop
    _client = _client_cm = _client_loop = None
    if cm is not None and loop is asyncio.get_running_loop():
        try:
            await cm.__aexit__(None, None, None)
        except Exception:
            logger.warning("Closing the S3 client failed", exc_info=True)


async def upload_photo(
    book_id: uuid.UUID,
    file_bytes: bytes,
    content_type: str,
    thumb_bytes: bytes | None = None,
) -> dict[str, Any]:
    """Upload a photo and return {"url": ..., "thumbnail_url": ...}.

    Thumbnail is provided by the client (resized on-device).
    If no thumbnail is provided, thumbnail_url will be None.
    """
    ext = _get_extension(content_type)
    filename = f"{uuid.uuid7()}.{ext}"

    if _is_s3_configured():
        logger.info("Uploading to S3: book=%s file=%s size=%d", book_id, filename, len(file_bytes))
        url = await _upload_s3(book_id, filename, file_bytes, content_type)
        thumb_url = None
        if thumb_bytes:
            thumb_filename = f"{uuid.uuid7()}_thumb.{ext}"
            thumb_url = await _upload_s3(book_id, thumb_filename, thumb_bytes, content_type)
        logger.info("S3 upload complete: %s (thumb: %s)", url, thumb_url)
        return {"url": url, "thumbnail_url": thumb_url}

    logger.info("Uploading locally: book=%s file=%s size=%d", book_id, filename, len(file_bytes))
    url = await _upload_local(book_id, filename, file_bytes)
    thumb_url = None
    if thumb_bytes:
        thumb_filename = f"{uuid.uuid7()}_thumb.{ext}"
        thumb_url = await _upload_local(book_id, thumb_filename, thumb_bytes)
    logger.info("Local upload complete: %s (thumb: %s)", url, thumb_url)
    return {"url": url, "thumbnail_url": thumb_url}


async def delete_photo(url: str) -> None:
    """Delete a photo by URL."""
    if _is_s3_configured():
        logger.info("Deleting from S3: %s", url)
        await _delete_s3(url)
    else:
        logger.info("Deleting locally: %s", url)
        await _delete_local(url)


# ---------------------------------------------------------------------------
# Local filesystem
# ---------------------------------------------------------------------------


async def _upload_local(book_id: uuid.UUID, filename: str, file_bytes: bytes) -> str:
    book_dir = LOCAL_STORAGE_DIR / str(book_id)
    book_dir.mkdir(parents=True, exist_ok=True)
    (book_dir / filename).write_bytes(file_bytes)
    return f"/media/book_photos/{book_id}/{filename}"


async def _delete_local(url: str) -> None:
    if url.startswith("/media/book_photos/"):
        path = Path("/app") / url.lstrip("/")
        if path.exists():
            path.unlink()


# ---------------------------------------------------------------------------
# S3
# ---------------------------------------------------------------------------


async def _upload_s3(
    book_id: uuid.UUID, filename: str, file_bytes: bytes, content_type: str
) -> str:
    settings = get_settings()
    key = f"books/{book_id}/{filename}"

    async with get_s3_client() as client:
        await client.put_object(
            Bucket=settings.s3_bucket,
            Key=key,
            Body=file_bytes,
            ContentType=content_type,
        )

    external = settings.s3_external_endpoint or settings.s3_endpoint
    if external:
        return f"{external}/{settings.s3_bucket}/{key}"
    return f"https://{settings.s3_bucket}.s3.amazonaws.com/{key}"


async def _delete_s3(url: str) -> None:
    settings = get_settings()
    key = _extract_key(url, settings.s3_bucket)

    async with get_s3_client() as client:
        await client.delete_object(Bucket=settings.s3_bucket, Key=key)


def _get_extension(content_type: str) -> str:
    mapping = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
    }
    return mapping.get(content_type, "jpg")


def _extract_key(url: str, bucket: str) -> str:
    if f"{bucket}.s3" in url:
        return url.split(f"{bucket}.s3")[1].split("/", 1)[1].lstrip(".")
    return url.split(f"{bucket}/", 1)[1]
