"""Annual worker: generate year-in-review summaries and notify each user.

For every active user it counts the exchanges they completed during the current
calendar year, creates an in-app ``year_in_review`` notification carrying the
summary, and sends a push notification with a Turkish title/body.

Idempotency: the notification payload stores the reviewed ``year``, so
re-running the worker within the same year never double-notifies a user.
"""

import logging
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User, UserStatus
from app.modules.exchanges.models import ExchangeRequest, ExchangeStatus
from app.modules.notifications.models import Notification
from app.modules.notifications.service import NotificationService

logger = logging.getLogger(__name__)


async def _review_exists(session: AsyncSession, user_id, year: int) -> bool:
    """True if a ``year_in_review`` notification already exists for user+year."""
    stmt = select(func.count()).select_from(Notification).where(
        Notification.user_id == user_id,
        Notification.type == "year_in_review",
        Notification.payload["year"].astext == str(year),
    )
    result = await session.execute(stmt)
    return (result.scalar() or 0) > 0


async def _count_completed_this_year(
    session: AsyncSession, user_id, year_start: datetime
) -> int:
    """Count exchanges the user took part in that completed since ``year_start``.

    Uses ``updated_at`` as the completion timestamp: ``completed`` is a terminal
    status, so its ``updated_at`` reflects when the exchange was finalized.
    """
    stmt = select(func.count()).select_from(ExchangeRequest).where(
        ExchangeRequest.status == ExchangeStatus.completed,
        ExchangeRequest.updated_at >= year_start,
        (
            (ExchangeRequest.requested_by == user_id)
            | (ExchangeRequest.requested_to == user_id)
        ),
    )
    result = await session.execute(stmt)
    return result.scalar() or 0


async def generate_year_in_review(session: AsyncSession) -> int:
    """Generate year-in-review summaries and notify active users.

    Returns the number of notifications created.
    """
    from app.modules.push_tokens.service import PushMessage, send_push_to_user

    now = datetime.now(UTC)
    year = now.year
    year_start = datetime(year, 1, 1, tzinfo=UTC)

    users = await session.execute(
        select(User).where(User.status == UserStatus.active)
    )
    active_users = users.scalars().all()

    notif_service = NotificationService(session)
    created = 0

    for i, user in enumerate(active_users):
        try:
            if await _review_exists(session, user.id, year):
                continue

            completed = await _count_completed_this_year(session, user.id, year_start)

            await notif_service.create_notification(
                user_id=user.id,
                type_="year_in_review",
                payload={
                    "year": year,
                    "completed_count": completed,
                    "user_name": user.name,
                },
            )

            if completed > 0:
                body = (
                    f"{completed} kitap takası tamamladın. "
                    "Yılın özetini görmek için dokun."
                )
            else:
                body = "Bu yıl seninle olan kitap yolculuğunu keşfetmek için dokun."

            try:
                await send_push_to_user(
                    str(user.id),
                    PushMessage(
                        title="Yılın Özeti",
                        body=body,
                        data={"type": "year_in_review", "year": str(year)},
                    ),
                    session=session,
                )
            except Exception as exc:
                logger.warning("year_in_review push failed for %s: %s", user.id, exc)

            created += 1
        except Exception:
            logger.exception("Failed to build year-in-review for user %s", user.id)

        if (i + 1) % 50 == 0:
            await session.commit()

    if created > 0:
        await session.commit()

    return created
