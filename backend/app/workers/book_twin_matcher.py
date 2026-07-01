"""Worker: find users with similar reading taste (book twins) and notify them.

Builds a category profile for each active user from the categories of their
listed (non-deleted) books, then compares every pair using Jaccard similarity
over those category sets. For pairs with similarity >= 0.5 an in-app
``book_twin`` notification is created for BOTH users along with a Turkish push
notification that deep-links to the other user's profile.

Idempotency: a notification is only created when no existing ``book_twin``
notification links the same two users (checked in both directions), so
re-running the worker never re-notifies an already-matched pair.
"""

import logging
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User, UserStatus
from app.modules.books.models import Book
from app.modules.notifications.models import Notification
from app.modules.notifications.service import NotificationService

logger = logging.getLogger(__name__)

SIMILARITY_THRESHOLD = 0.5
MIN_BOOKS = 3


def _cat_value(category) -> str:
    """Normalize a loaded category value to its string code."""
    if category is None:
        return ""
    return category.value if hasattr(category, "value") else str(category)


async def _category_profile(session: AsyncSession, user_id) -> set[str]:
    """Return the set of distinct book category codes a user owns."""
    stmt = select(Book.category).where(
        Book.owner_id == user_id,
        Book.deleted_at.is_(None),
    )
    result = await session.execute(stmt)
    return {_cat_value(row[0]) for row in result.all() if row[0] is not None}


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


async def _twin_pair_exists(session: AsyncSession, user_id, twin_id) -> bool:
    """True if a ``book_twin`` notification already links ``user_id`` to ``twin_id``."""
    stmt = select(func.count()).select_from(Notification).where(
        Notification.type == "book_twin",
        Notification.user_id == user_id,
        Notification.payload["twin_user_id"].astext == str(twin_id),
    )
    result = await session.execute(stmt)
    return (result.scalar() or 0) > 0


async def find_and_notify_book_twins(session: AsyncSession) -> int:
    """Match users by reading taste and notify both sides of each twin pair.

    Returns the number of notifications created.
    """
    from app.modules.push_tokens.service import PushMessage, send_push_to_user

    # Active users owning at least MIN_BOOKS non-deleted books.
    book_counts = await session.execute(
        select(Book.owner_id, func.count(Book.id))
        .where(Book.deleted_at.is_(None))
        .group_by(Book.owner_id)
    )
    counts = {row[0]: row[1] for row in book_counts.all()}
    eligible_ids = [uid for uid, c in counts.items() if c >= MIN_BOOKS]
    if len(eligible_ids) < 2:
        return 0

    users_result = await session.execute(
        select(User).where(
            User.status == UserStatus.active,
            User.id.in_(eligible_ids),
        )
    )
    active_users = users_result.scalars().all()
    if len(active_users) < 2:
        return 0

    # Build a category profile + name lookup for each eligible user.
    profiles: dict[uuid.UUID, set[str]] = {}
    for user in active_users:
        profiles[user.id] = await _category_profile(session, user.id)

    notif_service = NotificationService(session)
    created = 0

    users = list(active_users)
    for i in range(len(users)):
        a = users[i]
        profile_a = profiles[a.id]
        if not profile_a:
            continue

        for j in range(i + 1, len(users)):
            b = users[j]
            profile_b = profiles[b.id]
            if not profile_b:
                continue

            sim = _jaccard(profile_a, profile_b)
            if sim < SIMILARITY_THRESHOLD:
                continue

            # Skip pairs already notified in either direction.
            if await _twin_pair_exists(session, a.id, b.id) or await _twin_pair_exists(
                session, b.id, a.id
            ):
                continue

            shared = sorted(profile_a & profile_b)

            for user, twin in ((a, b), (b, a)):
                try:
                    await notif_service.create_notification(
                        user_id=user.id,
                        type_="book_twin",
                        payload={
                            "twin_user_id": str(twin.id),
                            "twin_name": twin.name,
                            "similarity": round(sim, 2),
                            "shared_categories": shared,
                        },
                    )
                    try:
                        await send_push_to_user(
                            str(user.id),
                            PushMessage(
                                title="Kitap İkizi",
                                body=(
                                    f"{twin.name} ile benzer kitap zevkleriniz var. "
                                    "Profili görmek için dokun."
                                ),
                                data={
                                    "type": "book_twin",
                                    "twin_user_id": str(twin.id),
                                },
                            ),
                            session=session,
                        )
                    except Exception as exc:
                        logger.warning(
                            "book_twin push failed for %s: %s", user.id, exc
                        )
                    created += 1
                except Exception:
                    logger.exception(
                        "Failed to create book_twin notification %s -> %s",
                        user.id,
                        twin.id,
                    )

        if (i + 1) % 50 == 0:
            await session.commit()

    if created > 0:
        await session.commit()

    return created
