"""Notifications business logic."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.notifications.models import Notification
from app.modules.notifications.repository import NotificationRepository
from app.modules.notifications.schemas import NotificationListResponse, NotificationView


def _to_view(notification: Notification) -> NotificationView:
    return NotificationView(
        id=notification.id,
        type=notification.type,
        payload=notification.payload,
        read_at=notification.read_at,
        created_at=notification.created_at,
    )


class NotificationService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = NotificationRepository(session)

    async def create_notification(self, user_id: uuid.UUID, type_: str, payload: dict) -> Notification:
        notification = await self.repo.create(user_id, type_, payload)
        return notification

    async def list_notifications(self, user_id: uuid.UUID) -> NotificationListResponse:
        notifications = await self.repo.list_by_user(user_id)
        return NotificationListResponse(items=[_to_view(n) for n in notifications])

    async def mark_read(self, user_id: uuid.UUID, notification_ids: list[uuid.UUID]) -> None:
        await self.repo.mark_read(user_id, notification_ids)
        await self.session.commit()
