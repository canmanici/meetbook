"""Geofence business logic."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.geofence.models import GeofenceAlert
from app.modules.geofence.repository import GeofenceAlertRepository
from app.modules.geofence.schemas import GeofenceAlertListResponse, GeofenceAlertView


def _to_view(alert: GeofenceAlert) -> GeofenceAlertView:
    return GeofenceAlertView(
        id=alert.id,
        wishlist_item_id=alert.wishlist_item_id,
        book_id=alert.book_id,
        created_at=alert.created_at,
        read_at=alert.read_at,
    )


class GeofenceService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = GeofenceAlertRepository(session)

    async def get_alerts(self, user_id: uuid.UUID) -> GeofenceAlertListResponse:
        alerts = await self.repo.get_unread_by_user(user_id)
        return GeofenceAlertListResponse(items=[_to_view(a) for a in alerts])

    async def mark_read(self, user_id: uuid.UUID, alert_id: uuid.UUID) -> GeofenceAlertView | None:
        alert = await self.repo.mark_read(user_id, alert_id)
        if alert:
            await self.session.commit()
            return _to_view(alert)
        return None
