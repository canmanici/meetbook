"""15-minute worker: match wishlist items against nearby books and create alerts."""

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User
from app.modules.books.models import Book
from app.modules.geofence.repository import GeofenceAlertRepository
from app.modules.notifications.service import NotificationService
from app.modules.wishlist.models import WishlistItem


async def run_geofence_matcher(session: AsyncSession) -> int:
    """Match wishlist items against nearby books using ST_DWithin.

    Uses each user's most recently created book location as a position proxy.
    Returns the number of alerts created.
    """
    result = await session.execute(
        select(WishlistItem, User).join(User, WishlistItem.user_id == User.id)
    )
    rows = result.all()

    repo = GeofenceAlertRepository(session)
    notif_service = NotificationService(session)
    created = 0

    for wishlist_item, user in rows:
        if not wishlist_item.isbn:
            continue

        latest_book = await session.execute(
            select(Book)
            .where(Book.owner_id == user.id, Book.deleted_at.is_(None))
            .order_by(Book.created_at.desc())
            .limit(1)
        )
        latest_book = latest_book.scalar_one_or_none()
        if not latest_book:
            continue

        radius_meters = user.geofence_radius_km * 1000

        nearby = await session.execute(
            select(Book).where(
                Book.isbn == wishlist_item.isbn,
                Book.is_available.is_(True),
                Book.deleted_at.is_(None),
                Book.owner_id != user.id,
                func.ST_DWithin(Book.location, latest_book.location, radius_meters),
            )
        )

        for book in nearby.scalars().all():
            if await repo.exists(user.id, wishlist_item.id, book.id):
                continue

            await repo.create_alert(user.id, wishlist_item.id, book.id)
            await notif_service.create_notification(
                user_id=user.id,
                type_="geofence_match",
                payload={
                    "wishlist_item_id": str(wishlist_item.id),
                    "book_id": str(book.id),
                    "book_title": book.title,
                },
            )
            created += 1

    if created > 0:
        await session.commit()

    return created
