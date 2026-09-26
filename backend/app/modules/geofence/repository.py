"""Database queries for the geofence module."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.geofence.models import GeofenceAlert


class GeofenceAlertRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_alert(
        self, user_id: uuid.UUID, wishlist_item_id: uuid.UUID, book_id: uuid.UUID
    ) -> GeofenceAlert:
        alert = GeofenceAlert(user_id=user_id, wishlist_item_id=wishlist_item_id, book_id=book_id)
        self.session.add(alert)
        await self.session.flush()
        return alert

    async def get_unread_by_user(self, user_id: uuid.UUID) -> list[GeofenceAlert]:
        result = await self.session.execute(
            select(GeofenceAlert)
            .where(GeofenceAlert.user_id == user_id, GeofenceAlert.read_at.is_(None))
            .order_by(GeofenceAlert.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_all_unread(self) -> list[GeofenceAlert]:
        result = await self.session.execute(
            select(GeofenceAlert).where(GeofenceAlert.read_at.is_(None))
        )
        return list(result.scalars().all())

    async def mark_read(self, user_id: uuid.UUID, alert_id: uuid.UUID) -> GeofenceAlert | None:
        result = await self.session.execute(
            select(GeofenceAlert).where(
                GeofenceAlert.id == alert_id,
                GeofenceAlert.user_id == user_id,
                GeofenceAlert.read_at.is_(None),
            )
        )
        alert = result.scalar_one_or_none()
        if alert:
            alert.read_at = datetime.now(UTC)
            await self.session.flush()
        return alert

    async def exists(
        self, user_id: uuid.UUID, wishlist_item_id: uuid.UUID, book_id: uuid.UUID
    ) -> bool:
        result = await self.session.execute(
            select(GeofenceAlert.id)
            .where(
                GeofenceAlert.user_id == user_id,
                GeofenceAlert.wishlist_item_id == wishlist_item_id,
                GeofenceAlert.book_id == book_id,
            )
            .limit(1)
        )
        return result.scalar_one_or_none() is not None
