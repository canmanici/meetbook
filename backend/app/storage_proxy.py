"""MinIO storage proxy endpoint — fallback when Traefik→MinIO routing is broken."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.core.config import get_settings
from app.core.s3 import get_s3_client

router = APIRouter()

SAFE_MEDIA_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


@router.get("/storage/{bucket}/{path:path}")
@router.head("/storage/{bucket}/{path:path}")
async def proxy_storage(bucket: str, path: str):
    """Fetch a file from MinIO and return it directly."""
    settings = get_settings()
    if not settings.s3_endpoint or not settings.s3_access_key:
        raise HTTPException(status_code=404, detail="Storage not configured")
    # Only the public media bucket — never let callers read other buckets
    # the S3 credentials can reach.
    if bucket != settings.s3_bucket:
        raise HTTPException(status_code=404, detail="File not found")

    try:
        async with get_s3_client() as client:
            response = await client.get_object(Bucket=bucket, Key=path)
            body = await response["Body"].read()
            ct = response.get("ContentType", "application/octet-stream")
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
    return Response(content=body, media_type=ct, headers=headers)
