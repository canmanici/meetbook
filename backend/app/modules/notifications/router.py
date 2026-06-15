"""Notification endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.notifications.schemas import (
    NotificationListResponse,
    NotificationMarkReadRequest,
)
from app.modules.notifications.service import NotificationService

router = APIRouter(tags=["notifications"])


def _get_service(session: AsyncSession = Depends(get_session)) -> NotificationService:
    return NotificationService(session)


@router.get("/notifications", response_model=NotificationListResponse)
async def list_notifications(
    user: User = Depends(get_current_user),
    service: NotificationService = Depends(_get_service),
) -> NotificationListResponse:
    return await service.list_notifications(user.id)


@router.post("/notifications/read", status_code=204)
async def mark_notifications_read(
    body: NotificationMarkReadRequest,
    user: User = Depends(get_current_user),
    service: NotificationService = Depends(_get_service),
) -> None:
    await service.mark_read(user.id, body.notification_ids)
