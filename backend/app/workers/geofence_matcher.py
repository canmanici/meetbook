"""15-minute worker: match wishlist items against nearby books and create alerts."""

import logging

from sqlalchemy import func, select, true
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.modules.auth.models import User
from app.modules.books.models import Book
from app.modules.geofence.models import GeofenceAlert
from app.modules.geofence.repository import GeofenceAlertRepository
from app.modules.notifications.service import NotificationService
from app.modules.wishlist.models import WishlistItem

logger = logging.getLogger(__name__)


async def run_geofence_matcher(session: AsyncSession) -> int:
    """Match wishlist items against nearby books using ST_DWithin.

    Uses each user's most recently created book location as a position proxy.
    Returns the number of alerts created.

    One set-based query finds every new (wishlist item, nearby book) pair —
    already-alerted pairs are filtered out in SQL. It used to be 2 queries
    per wishlist item plus one existence check per candidate book.
    """
    owned = aliased(Book)
    candidate = aliased(Book)
    latest = (
        select(owned.location.label("location"))
        .where(owned.owner_id == User.id, owned.deleted_at.is_(None))
        .order_by(owned.created_at.desc())
        .limit(1)
        .correlate(User)
        .lateral("latest")
    )
    # Same-ISBN candidates first (ix_books_isbn, a handful of rows), THEN the
    # distance check. OFFSET 0 fences the subquery so the planner cannot
    # start from the GiST index instead — in a dense city that scanned
    # thousands of nearby books per wishlist item (4.1 s vs 78 ms measured).
    match = (
        select(
            candidate.id.label("id"),
            candidate.title.label("title"),
            candidate.location.label("location"),
        )
        .where(
            candidate.isbn == WishlistItem.isbn,
            candidate.is_available.is_(True),
            candidate.deleted_at.is_(None),
            candidate.owner_id != User.id,
        )
        .offset(0)
        .correlate(WishlistItem, User)
        .lateral("match")
    )
    already_alerted = (
        select(GeofenceAlert.id)
        .where(
            GeofenceAlert.user_id == User.id,
            GeofenceAlert.wishlist_item_id == WishlistItem.id,
            GeofenceAlert.book_id == match.c.id,
        )
        .exists()
    )
    stmt = (
        select(
            WishlistItem.id.label("wishlist_item_id"),
            User.id.label("user_id"),
            User.geofence_radius_km.label("radius_km"),
            match.c.id.label("book_id"),
            match.c.title.label("book_title"),
        )
        .select_from(WishlistItem)
        .join(User, WishlistItem.user_id == User.id)
        .join(latest, true())
        .join(
            match,
            func.ST_DWithin(match.c.location, latest.c.location, User.geofence_radius_km * 1000),
        )
        .where(WishlistItem.isbn.is_not(None), WishlistItem.isbn != "", ~already_alerted)
        .order_by(WishlistItem.id, match.c.id)
    )
    rows = (await session.execute(stmt)).all()

    repo = GeofenceAlertRepository(session)
    notif_service = NotificationService(session)
    created = 0

    for row in rows:
        try:
            await repo.create_alert(row.user_id, row.wishlist_item_id, row.book_id)
            await notif_service.notify(
                row.user_id,
                "geofence_match",
                {
                    "wishlist_item_id": str(row.wishlist_item_id),
                    "book_id": str(row.book_id),
                    "book_title": row.book_title,
                },
                title="İstediğin kitap yakınında!",
                body=f"“{row.book_title}” {row.radius_km} km içinde listelendi.",
            )
            created += 1
        except Exception:
            logger.exception("Failed to process geofence match for book %s", row.book_id)

        if created and created % 50 == 0:
            await session.commit()

    if created > 0:
        await session.commit()

    return created
