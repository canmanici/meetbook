"""Notifications business logic.

``NotificationService.notify`` is the single entry point for telling a user
something happened: it writes the in-app (bell) entry, honours the user's
per-event push preferences, sends the push and prunes dead device tokens.
Emitters should call it instead of pairing ``create_notification`` with
``send_push_to_user`` by hand.
"""

import logging
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.notifications.models import Notification
from app.modules.notifications.repository import NotificationRepository
from app.modules.notifications.schemas import NotificationListResponse, NotificationView

logger = logging.getLogger(__name__)

# Notification type → key in ``User.notification_settings`` (the toggles on the
# mobile settings screen). A key set to False mutes the PUSH for that event;
# the bell entry is still written so nothing is silently lost. Types missing
# here (calls, admin broadcasts, report results, year in review) always push.
PREFERENCE_KEY: dict[str, str] = {
    "exchange_request": "new_exchange_request",
    "chat_system": "exchange_updates",
    "location_started": "exchange_updates",
    "new_message": "new_message",
    "club_message": "new_message",
    "loan_due_3d": "meetup_reminder",
    "loan_due_1d": "meetup_reminder",
    "loan_overdue": "meetup_reminder",
    "wishlist_match": "wishlist_match",
    "geofence_match": "wishlist_match",
    "club_invite": "clubs",
    "club_shuffled": "clubs",
    "book_twin": "book_twin",
}


def _to_view(notification: Notification) -> NotificationView:
    return NotificationView(
        id=notification.id,
        type=notification.type,
        payload=notification.payload,
        read_at=notification.read_at,
        created_at=notification.created_at,
    )


def _push_data(type_: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Deep-link data for the push: scalar ids only, stringified."""
    data: dict[str, Any] = {"type": type_}
    for key, value in payload.items():
        if key in ("title", "message"):
            continue
        if isinstance(value, uuid.UUID):
            data[key] = str(value)
        elif isinstance(value, (str, int, float, bool)) or value is None:
            data[key] = value
    return data


class NotificationService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = NotificationRepository(session)

    async def create_notification(
        self, user_id: uuid.UUID, type_: str, payload: dict[str, Any]
    ) -> Notification:
        notification = await self.repo.create(user_id, type_, payload)
        return notification

    async def push_enabled(self, user_id: uuid.UUID, type_: str) -> bool:
        key = PREFERENCE_KEY.get(type_)
        if key is None:
            return True
        from app.modules.auth.models import User

        settings = await self.session.scalar(
            select(User.notification_settings).where(User.id == user_id)
        )
        return (settings or {}).get(key) is not False

    async def notify(
        self,
        user_id: uuid.UUID,
        type_: str,
        payload: dict[str, Any],
        *,
        title: str,
        body: str,
        inbox: bool = True,
        push: bool = True,
        skip_push_if_online: bool = False,
        channel_id: str = "default",
    ) -> Notification | None:
        """Record a bell entry and/or send a push. Never raises on push failure.

        The caller owns the transaction: this only flushes, so commit after.
        ``title``/``body`` are stored on the entry too, so the in-app list
        shows exactly what the push said.
        """
        notification: Notification | None = None
        if inbox:
            notification = await self.repo.create(
                user_id, type_, {"title": title, "message": body, **payload}
            )

        if not push:
            return notification
        try:
            if skip_push_if_online:
                from app.modules.chat.service import ConnectionManager

                if await ConnectionManager.check_online(user_id):
                    return notification
            if not await self.push_enabled(user_id, type_):
                return notification

            from app.modules.push_tokens.service import PushMessage, send_push_to_user

            data = _push_data(type_, payload)
            if notification is not None:
                data["notification_id"] = str(notification.id)
            await send_push_to_user(
                str(user_id),
                PushMessage(title=title, body=body, data=data, channel_id=channel_id),
                session=self.session,
            )
        except Exception as exc:
            logger.warning("%s push failed for user %s: %s", type_, user_id, exc)
        return notification

    async def broadcast(
        self,
        user_ids: list[uuid.UUID],
        type_: str,
        payload: dict[str, Any],
        *,
        push_title: str | None = None,
        push_body: str | None = None,
    ) -> int:
        """Create one notification per user (admin broadcast) and push them all.

        Returns count created."""
        count = await self.repo.create_many(user_ids, type_, payload)
        if push_title and user_ids:
            from app.modules.push_tokens.service import PushMessage, send_push_to_users

            try:
                await send_push_to_users(
                    user_ids,
                    PushMessage(
                        title=push_title, body=push_body or "", data=_push_data(type_, payload)
                    ),
                    session=self.session,
                )
            except Exception as exc:
                logger.warning("broadcast push failed: %s", exc)
        return count

    async def list_notifications(self, user_id: uuid.UUID) -> NotificationListResponse:
        notifications = await self.repo.list_by_user(user_id)
        return NotificationListResponse(items=[_to_view(n) for n in notifications])

    async def mark_read(self, user_id: uuid.UUID, notification_ids: list[uuid.UUID]) -> None:
        await self.repo.mark_read(user_id, notification_ids)
        await self.session.commit()

    async def mark_all_read(self, user_id: uuid.UUID) -> None:
        await self.repo.mark_all_read(user_id)
        await self.session.commit()
