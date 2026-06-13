"""Database queries for the wishlist module."""

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.wishlist.models import WishlistItem


class WishlistRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def add_item(
        self,
        user_id: uuid.UUID,
        isbn: str,
        title: str | None,
        author: str | None,
        notes: str | None,
    ) -> WishlistItem:
        item = WishlistItem(
            user_id=user_id,
            isbn=isbn,
            title=title,
            author=author,
            notes=notes,
        )
        self.session.add(item)
        await self.session.flush()
        return item

    async def list_by_user(self, user_id: uuid.UUID) -> list[WishlistItem]:
        stmt = (
            select(WishlistItem)
            .where(WishlistItem.user_id == user_id)
            .order_by(WishlistItem.created_at.desc())
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_by_id(self, item_id: uuid.UUID) -> WishlistItem | None:
        stmt = select(WishlistItem).where(WishlistItem.id == item_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def delete_item(self, item: WishlistItem) -> None:
        await self.session.delete(item)

    async def get_isbns_by_user(self, user_id: uuid.UUID) -> list[str]:
        stmt = select(WishlistItem.isbn).where(WishlistItem.user_id == user_id)
        result = await self.session.execute(stmt)
        return [row[0] for row in result.all()]
