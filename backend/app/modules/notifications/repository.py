"""Database queries for the notifications module."""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.notifications.models import Notification


class NotificationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(self, user_id: uuid.UUID, type_: str, payload: dict[str, Any]) -> Notification:
        notification = Notification(user_id=user_id, type=type_, payload=payload)
        self.session.add(notification)
        await self.session.flush()
        return notification

    async def exists_for_exchange(
        self, user_id: uuid.UUID, type_: str, exchange_id: uuid.UUID
    ) -> bool:
        """True if a notification of this type already exists for this user+exchange.

        Used by the loan reminder worker to stay idempotent across hourly runs.
        """
        from sqlalchemy import func

        stmt = (
            select(func.count())
            .select_from(Notification)
            .where(
                Notification.user_id == user_id,
                Notification.type == type_,
                Notification.payload["exchange_id"].astext == str(exchange_id),
            )
        )
        result = await self.session.execute(stmt)
        return (result.scalar() or 0) > 0

    async def create_many(
        self, user_ids: list[uuid.UUID], type_: str, payload: dict[str, Any]
    ) -> int:
        """Bulk-create one notification per user (admin broadcast). Returns count."""
        for uid in user_ids:
            self.session.add(Notification(user_id=uid, type=type_, payload=payload))
        await self.session.flush()
        return len(user_ids)

    async def list_by_user(self, user_id: uuid.UUID, limit: int = 100) -> list[Notification]:
        result = await self.session.execute(
            select(Notification)
            .where(Notification.user_id == user_id)
            .order_by(Notification.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def mark_all_read(self, user_id: uuid.UUID) -> None:
        await self.session.execute(
            update(Notification)
            .where(Notification.user_id == user_id, Notification.read_at.is_(None))
            .values(read_at=datetime.now(UTC))
        )

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
