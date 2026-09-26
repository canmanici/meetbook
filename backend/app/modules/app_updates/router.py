"""APK update distribution.

Public (no login — the app checks before/without a session):
  GET  /app/{platform}/latest?version_code=N   → is there something newer?
  GET  /app/{platform}/releases/{code}/download → the APK itself
Admin:
  GET    /admin/app-releases
  POST   /admin/app-releases            (multipart upload)
  PATCH  /admin/app-releases/{id}       (mandatory / active / changelog)
  DELETE /admin/app-releases/{id}
"""

import hashlib
import logging
import tempfile
import uuid
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_session
from app.core.s3 import _is_s3_configured, get_s3_client
from app.modules.app_updates.models import AppRelease, AppUpdatePolicy
from app.modules.auth.dependencies import get_admin_user
from app.modules.auth.models import User

logger = logging.getLogger(__name__)

public_router = APIRouter(prefix="/app", tags=["app-updates"])
admin_router = APIRouter(prefix="/admin/app-releases", tags=["admin-ext"])

Platform = Literal["android"]
APK_MIME = "application/vnd.android.package-archive"
MAX_APK_BYTES = 250 * 1024 * 1024
LOCAL_RELEASES_DIR = Path("/app/media/releases")


# ── Schemas ──────────────────────────────────────────────────────────────


class ReleaseView(BaseModel):
    id: uuid.UUID
    platform: str
    version_code: int
    version_name: str
    size_bytes: int
    sha256: str
    md5: str
    changelog: str | None
    mandatory: bool
    is_active: bool
    withdrawn_at: datetime | None
    withdrawn_reason: str | None
    created_at: datetime
    download_path: str


class LatestResponse(BaseModel):
    update_available: bool
    # True → the app can't be used until updated (a newer release is marked
    # mandatory, the device is below the minimum, or it runs a withdrawn build).
    mandatory: bool
    latest: ReleaseView | None
    # The installed build was pulled by an admin (emergency).
    current_withdrawn: bool = False
    # Installed versionCode is below the admin's minimum supported version.
    below_minimum: bool = False
    # Text to show the user (withdraw reason / policy message).
    notice: str | None = None


class PolicyView(BaseModel):
    platform: str
    min_supported_code: int
    message: str | None
    updated_at: datetime | None


class PolicyUpdate(BaseModel):
    min_supported_code: int = Field(ge=0)
    message: str | None = Field(default=None, max_length=1000)


class WithdrawRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


class ReleaseUpdate(BaseModel):
    mandatory: bool | None = None
    is_active: bool | None = None
    changelog: str | None = Field(default=None, max_length=5000)


def _view(r: AppRelease) -> ReleaseView:
    return ReleaseView(
        id=r.id, platform=r.platform, version_code=r.version_code, version_name=r.version_name,
        size_bytes=r.size_bytes, sha256=r.sha256, md5=r.md5, changelog=r.changelog,
        mandatory=r.mandatory, is_active=r.is_active, withdrawn_at=r.withdrawn_at,
        withdrawn_reason=r.withdrawn_reason, created_at=r.created_at,
        download_path=f"/api/v1/app/{r.platform}/releases/{r.version_code}/download",
    )


def _filename(r: AppRelease) -> str:
    return f"meetbook-{r.version_name}.apk"


# ── Public ───────────────────────────────────────────────────────────────


def _offerable(platform: str):
    """Releases we may hand out: active and not withdrawn."""
    return (
        AppRelease.platform == platform,
        AppRelease.is_active.is_(True),
        AppRelease.withdrawn_at.is_(None),
    )


@public_router.get("/{platform}/latest", response_model=LatestResponse)
async def latest_release(
    platform: Platform,
    version_code: int = Query(0, ge=0, description="versionCode installed on the device"),
    session: AsyncSession = Depends(get_session),
) -> LatestResponse:
    newest = (
        await session.execute(
            select(AppRelease).where(*_offerable(platform)).order_by(AppRelease.version_code.desc()).limit(1)
        )
    ).scalar_one_or_none()
    current = (
        await session.execute(
            select(AppRelease).where(AppRelease.platform == platform, AppRelease.version_code == version_code)
        )
    ).scalar_one_or_none()
    policy = await session.get(AppUpdatePolicy, platform)

    current_withdrawn = bool(current and current.withdrawn_at)
    below_minimum = bool(policy and version_code < policy.min_supported_code)
    update_available = bool(newest and newest.version_code > version_code)

    mandatory = False
    if update_available:
        mandatory_newer = await session.scalar(
            select(func.count()).where(
                *_offerable(platform), AppRelease.mandatory.is_(True), AppRelease.version_code > version_code
            )
        )
        mandatory = bool(mandatory_newer) or current_withdrawn or below_minimum

    notice = None
    if current_withdrawn:
        notice = current.withdrawn_reason  # type: ignore[union-attr]
    elif below_minimum:
        notice = policy.message  # type: ignore[union-attr]

    return LatestResponse(
        update_available=update_available,
        mandatory=mandatory,
        latest=_view(newest) if newest else None,
        current_withdrawn=current_withdrawn,
        below_minimum=below_minimum,
        notice=notice,
    )


@public_router.get("/{platform}/releases/{version_code}/download")
async def download_release(
    platform: Platform, version_code: int, session: AsyncSession = Depends(get_session)
) -> Response:
    r = (
        await session.execute(
            select(AppRelease).where(
                AppRelease.platform == platform,
                AppRelease.version_code == version_code,
                AppRelease.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if r is None:
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    headers = {
        "Content-Disposition": f'attachment; filename="{_filename(r)}"',
        "Content-Length": str(r.size_bytes),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=86400",
    }
    if r.storage_key.startswith("local:"):
        path = LOCAL_RELEASES_DIR / r.storage_key.removeprefix("local:")
        if not path.exists():
            raise HTTPException(status_code=404, detail="NOT_FOUND")
        return FileResponse(path, media_type=APK_MIME, headers=headers)

    async def stream():
        async with get_s3_client() as client:
            obj = await client.get_object(Bucket=get_settings().s3_bucket, Key=r.storage_key)
            async for chunk in obj["Body"].iter_chunks(1024 * 256):
                yield chunk

    return StreamingResponse(stream(), media_type=APK_MIME, headers=headers)


# ── Admin ────────────────────────────────────────────────────────────────


@admin_router.get("", response_model=list[ReleaseView])
async def list_releases(
    _: User = Depends(get_admin_user), session: AsyncSession = Depends(get_session)
) -> list[ReleaseView]:
    rows = await session.execute(select(AppRelease).order_by(AppRelease.version_code.desc()))
    return [_view(r) for r in rows.scalars().all()]


@admin_router.post("", response_model=ReleaseView, status_code=201)
async def upload_release(
    file: UploadFile = File(...),
    version_code: int = Form(..., ge=1),
    version_name: str = Form(..., min_length=1, max_length=30, pattern=r"^[0-9A-Za-z.\-+]+$"),
    changelog: str | None = Form(None, max_length=5000),
    mandatory: bool = Form(False),
    platform: Platform = Form("android"),
    admin: User = Depends(get_admin_user),
    session: AsyncSession = Depends(get_session),
) -> ReleaseView:
    existing_max = await session.scalar(
        select(func.max(AppRelease.version_code)).where(AppRelease.platform == platform)
    )
    if existing_max is not None and version_code <= existing_max:
        raise HTTPException(status_code=409, detail=f"VERSION_CODE_MUST_INCREASE (current max {existing_max})")

    # Spool to disk while hashing — APKs are tens of MB.
    sha256, md5, size = hashlib.sha256(), hashlib.md5(), 0  # noqa: S324 (md5 = transport checksum only)
    with tempfile.NamedTemporaryFile(suffix=".apk", delete=False) as tmp:
        tmp_path = Path(tmp.name)
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_APK_BYTES:
                tmp_path.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="APK_TOO_LARGE")
            sha256.update(chunk)
            md5.update(chunk)
            tmp.write(chunk)
    try:
        # Must be a real APK: a zip with a manifest and dex code.
        try:
            with zipfile.ZipFile(tmp_path) as z:
                names = set(z.namelist())
        except zipfile.BadZipFile:
            raise HTTPException(status_code=400, detail="NOT_AN_APK") from None
        if "AndroidManifest.xml" not in names or not any(n.endswith(".dex") for n in names):
            raise HTTPException(status_code=400, detail="NOT_AN_APK")

        key_name = f"meetbook-{version_name}-{version_code}.apk"
        if _is_s3_configured():
            storage_key = f"releases/{platform}/{key_name}"
            async with get_s3_client() as client:
                with tmp_path.open("rb") as fh:
                    await client.put_object(
                        Bucket=get_settings().s3_bucket, Key=storage_key, Body=fh.read(), ContentType=APK_MIME
                    )
        else:
            LOCAL_RELEASES_DIR.mkdir(parents=True, exist_ok=True)
            tmp_path.replace(LOCAL_RELEASES_DIR / key_name)
            storage_key = f"local:{key_name}"
    finally:
        tmp_path.unlink(missing_ok=True)

    r = AppRelease(
        platform=platform, version_code=version_code, version_name=version_name, storage_key=storage_key,
        size_bytes=size, sha256=sha256.hexdigest(), md5=md5.hexdigest(), changelog=changelog,
        mandatory=mandatory, uploaded_by=admin.id,
    )
    session.add(r)
    await session.commit()
    logger.info("App release %s (%s) uploaded by %s", version_name, version_code, admin.id)
    return _view(r)


@admin_router.get("/policy", response_model=PolicyView)
async def get_policy(
    platform: Platform = Query("android"),
    _: User = Depends(get_admin_user),
    session: AsyncSession = Depends(get_session),
) -> PolicyView:
    pol = await session.get(AppUpdatePolicy, platform)
    if pol is None:
        return PolicyView(platform=platform, min_supported_code=0, message=None, updated_at=None)
    return PolicyView(platform=platform, min_supported_code=pol.min_supported_code,
                      message=pol.message, updated_at=pol.updated_at)


@admin_router.put("/policy", response_model=PolicyView)
async def set_policy(
    body: PolicyUpdate,
    platform: Platform = Query("android"),
    admin: User = Depends(get_admin_user),
    session: AsyncSession = Depends(get_session),
) -> PolicyView:
    """Everything below min_supported_code must update before it can be used."""
    newest = await session.scalar(
        select(func.max(AppRelease.version_code)).where(*_offerable(platform))
    )
    if body.min_supported_code > (newest or 0):
        # Otherwise every device would be locked out with nothing to update to.
        raise HTTPException(status_code=409, detail=f"MIN_ABOVE_LATEST_RELEASE (latest offerable {newest or 0})")
    pol = await session.get(AppUpdatePolicy, platform)
    if pol is None:
        pol = AppUpdatePolicy(platform=platform)
        session.add(pol)
    pol.min_supported_code = body.min_supported_code
    pol.message = body.message
    pol.updated_by = admin.id
    pol.updated_at = datetime.now(UTC)
    await session.commit()
    logger.warning("App update policy %s: min_supported_code=%s by %s", platform, body.min_supported_code, admin.id)
    return PolicyView(platform=platform, min_supported_code=pol.min_supported_code,
                      message=pol.message, updated_at=pol.updated_at)


@admin_router.post("/{release_id}/withdraw", response_model=ReleaseView)
async def withdraw_release(
    release_id: uuid.UUID, body: WithdrawRequest,
    admin: User = Depends(get_admin_user), session: AsyncSession = Depends(get_session),
) -> ReleaseView:
    """EMERGENCY: stop offering this build and warn every device running it."""
    r = await session.get(AppRelease, release_id)
    if r is None:
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    r.withdrawn_at = datetime.now(UTC)
    r.withdrawn_reason = body.reason
    await session.commit()
    logger.warning("App release %s (%s) WITHDRAWN by %s: %s", r.version_name, r.version_code, admin.id, body.reason)
    return _view(r)


@admin_router.post("/{release_id}/restore", response_model=ReleaseView)
async def restore_release(
    release_id: uuid.UUID, _: User = Depends(get_admin_user), session: AsyncSession = Depends(get_session),
) -> ReleaseView:
    r = await session.get(AppRelease, release_id)
    if r is None:
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    r.withdrawn_at = None
    r.withdrawn_reason = None
    await session.commit()
    return _view(r)


@admin_router.patch("/{release_id}", response_model=ReleaseView)
async def update_release(
    release_id: uuid.UUID, body: ReleaseUpdate,
    _: User = Depends(get_admin_user), session: AsyncSession = Depends(get_session),
) -> ReleaseView:
    r = await session.get(AppRelease, release_id)
    if r is None:
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    for field in ("mandatory", "is_active", "changelog"):
        value = getattr(body, field)
        if value is not None:
            setattr(r, field, value)
    await session.commit()
    return _view(r)


@admin_router.delete("/{release_id}", status_code=204)
async def delete_release(
    release_id: uuid.UUID, _: User = Depends(get_admin_user), session: AsyncSession = Depends(get_session)
) -> Response:
    r = await session.get(AppRelease, release_id)
    if r is None:
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    try:
        if r.storage_key.startswith("local:"):
            (LOCAL_RELEASES_DIR / r.storage_key.removeprefix("local:")).unlink(missing_ok=True)
        else:
            async with get_s3_client() as client:
                await client.delete_object(Bucket=get_settings().s3_bucket, Key=r.storage_key)
    except Exception:
        logger.exception("Failed to delete stored APK %s", r.storage_key)
    await session.delete(r)
    await session.commit()
    return Response(status_code=204)
