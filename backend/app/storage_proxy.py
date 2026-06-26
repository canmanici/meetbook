"""MinIO storage proxy endpoint — fallback when Traefik→MinIO routing is broken."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.core.config import get_settings
from app.core.s3 import get_s3_client

router = APIRouter()


@router.get("/storage/{bucket}/{path:path}")
@router.head("/storage/{bucket}/{path:path}")
async def proxy_storage(bucket: str, path: str):
    """Fetch a file from MinIO and return it directly."""
    settings = get_settings()
    if not settings.s3_endpoint or not settings.s3_access_key:
        raise HTTPException(status_code=404, detail="Storage not configured")

    try:
        async with get_s3_client() as client:
            response = await client.get_object(Bucket=bucket, Key=path)
            body = await response["Body"].read()
            ct = response.get("ContentType", "application/octet-stream")
            return Response(content=body, media_type=ct, headers={
                "Cache-Control": "public, max-age=31536000",
            })
    except Exception:
        raise HTTPException(status_code=404, detail="File not found")
