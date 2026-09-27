"""MinIO storage proxy endpoint — fallback when Traefik→MinIO routing is broken."""

from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from app.core.config import get_settings
from app.core.s3 import get_s3_client

router = APIRouter()

SAFE_MEDIA_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
# Objects above this are streamed instead of buffered (photos are ~100 KB–
# 2 MB; the bucket also holds release APKs of up to 250 MB).
BUFFER_LIMIT_BYTES = 4 * 1024 * 1024


@router.get("/storage/{bucket}/{path:path}")
@router.head("/storage/{bucket}/{path:path}")
async def proxy_storage(request: Request, bucket: str, path: str) -> Response:
    """Fetch a file from MinIO and return it directly."""
    settings = get_settings()
    if not settings.s3_endpoint or not settings.s3_access_key:
        raise HTTPException(status_code=404, detail="Storage not configured")
    # Only the public media bucket — never let callers read other buckets
    # the S3 credentials can reach.
    if bucket != settings.s3_bucket:
        raise HTTPException(status_code=404, detail="File not found")

    body: bytes | None = None
    stream_body: Any = None
    try:
        async with get_s3_client() as client:
            if request.method == "HEAD":
                # HEAD used to download the whole object just to drop it.
                response = await client.head_object(Bucket=bucket, Key=path)
            else:
                response = await client.get_object(Bucket=bucket, Key=path)
                if (response.get("ContentLength") or 0) > BUFFER_LIMIT_BYTES:
                    stream_body = response["Body"]
                else:
                    body = await response["Body"].read()
            ct = response.get("ContentType", "application/octet-stream")
            length = response.get("ContentLength")
    except Exception:
        raise HTTPException(status_code=404, detail="File not found") from None

    # This is served from the same origin as the admin panel: never let a
    # stored object render as HTML/SVG/JS there.
    headers = {
        "Cache-Control": "public, max-age=31536000",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
    }
    if ct not in SAFE_MEDIA_TYPES:
        ct = "application/octet-stream"
        headers["Content-Disposition"] = "attachment"
    if length is not None:
        headers["Content-Length"] = str(length)
    if stream_body is not None:

        async def _iter() -> AsyncIterator[bytes]:
            try:
                async for chunk in stream_body.iter_chunks(256 * 1024):
                    yield chunk
            finally:
                stream_body.close()

        return StreamingResponse(_iter(), media_type=ct, headers=headers)
    if body is None:  # HEAD
        return Response(media_type=ct, headers=headers)
    return Response(content=body, media_type=ct, headers=headers)
