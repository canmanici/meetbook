"""Database queries for the notifications module."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.notifications.models import Notification


class NotificationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(self, user_id: uuid.UUID, type_: str, payload: dict) -> Notification:
        notification = Notification(user_id=user_id, type=type_, payload=payload)
        self.session.add(notification)
        await self.session.flush()
        return notification

    async def list_by_user(self, user_id: uuid.UUID) -> list[Notification]:
        result = await self.session.execute(
            select(Notification)
            .where(Notification.user_id == user_id)
            .order_by(Notification.created_at.desc())
        )
        return list(result.scalars().all())

    async def mark_read(self, user_id: uuid.UUID, notification_ids: list[uuid.UUID]) -> None:
        await self.session.execute(
            update(Notification)
            .where(
                Notification.user_id == user_id,
                Notification.id.in_(notification_ids),
                Notification.read_at.is_(None),
            )
            .values(read_at=datetime.now(UTC))
        )
