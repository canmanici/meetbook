"""Photo storage — S3 when configured, local filesystem fallback."""

import logging
import os
import uuid
from pathlib import Path

from app.core.config import get_settings

logger = logging.getLogger(__name__)

LOCAL_STORAGE_DIR = Path("/app/media/book_photos")

_session = None


def _is_s3_configured() -> bool:
    settings = get_settings()
    return bool(settings.s3_bucket and settings.s3_access_key)


async def upload_photo(book_id: uuid.UUID, file_bytes: bytes, content_type: str) -> str:
    """Upload a photo and return the URL."""
    ext = _get_extension(content_type)
    filename = f"{uuid.uuid4()}.{ext}"

    if _is_s3_configured():
        logger.info("Uploading to S3: book=%s file=%s size=%d", book_id, filename, len(file_bytes))
        url = await _upload_s3(book_id, filename, file_bytes, content_type)
        logger.info("S3 upload complete: %s", url)
        return url
    logger.info("Uploading locally: book=%s file=%s size=%d", book_id, filename, len(file_bytes))
    url = await _upload_local(book_id, filename, file_bytes)
    logger.info("Local upload complete: %s", url)
    return url


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
    import aioboto3
    from botocore.config import Config

    global _session
    if _session is None:
        _session = aioboto3.Session()

    settings = get_settings()
    key = f"books/{book_id}/{filename}"

    async with _session.client(
        "s3",
        endpoint_url=settings.s3_endpoint or None,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        config=Config(signature_version="s3v4"),
    ) as client:
        await client.put_object(
            Bucket=settings.s3_bucket,
            Key=key,
            Body=file_bytes,
            ContentType=content_type,
        )

    # Use external-facing URL (mobile needs to reach this)
    external = settings.s3_external_endpoint or settings.s3_endpoint
    if external:
        return f"{external}/{settings.s3_bucket}/{key}"
    return f"https://{settings.s3_bucket}.s3.amazonaws.com/{key}"


async def _delete_s3(url: str) -> None:
    import aioboto3
    from botocore.config import Config

    global _session
    if _session is None:
        _session = aioboto3.Session()

    settings = get_settings()
    key = _extract_key(url, settings.s3_bucket)

    async with _session.client(
        "s3",
        endpoint_url=settings.s3_endpoint or None,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        config=Config(signature_version="s3v4"),
    ) as client:
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
