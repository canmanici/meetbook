"""Push token registration — auth-gated."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.push_tokens.models import PushToken
from app.modules.push_tokens.schemas import PushTokenRegisterRequest, PushTokenResponse

router = APIRouter(prefix="/auth/push-token", tags=["push"])


@router.post("", response_model=PushTokenResponse)
async def register_push_token(
    body: PushTokenRegisterRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PushTokenResponse:
    # If same device_id exists for this user, update it instead of creating duplicate
    if body.device_id:
        existing = await session.execute(
            select(PushToken).where(
                PushToken.user_id == user.id,
                PushToken.device_id == body.device_id,
            )
        )
        row = existing.scalar_one_or_none()
        if row:
            row.token = body.token
            row.platform = body.platform
            await session.commit()
            return PushTokenResponse(ok=True)

    # Otherwise, create new. If same token already exists for ANOTHER user
    # (device transfer?), delete old.
    await session.execute(delete(PushToken).where(PushToken.token == body.token))
    entry = PushToken(
        user_id=user.id,
        token=body.token,
        platform=body.platform,
        device_id=body.device_id,
    )
    session.add(entry)
    await session.commit()
    return PushTokenResponse(ok=True)


@router.delete("", response_model=PushTokenResponse)
async def unregister_push_token(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    token: str | None = Query(None),
    device_id: str | None = Query(None),
) -> PushTokenResponse:
    stmt = delete(PushToken).where(PushToken.user_id == user.id)
    if token:
        stmt = stmt.where(PushToken.token == token)
    elif device_id:
        stmt = stmt.where(PushToken.device_id == device_id)
    # else delete all tokens for user (logout all devices)
    await session.execute(stmt)
    await session.commit()
    return PushTokenResponse(ok=True)
