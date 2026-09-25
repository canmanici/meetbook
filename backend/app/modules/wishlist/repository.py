"""Database queries for the wishlist module."""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User
from app.modules.wishlist.models import (
    SharedWishlist,
    SharedWishlistItem,
    SharedWishlistMember,
    WishlistItem,
)


class WishlistRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def add_item(
        self,
        user_id: uuid.UUID,
        isbn: str | None,
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
        stmt = select(WishlistItem.isbn).where(
            WishlistItem.user_id == user_id, WishlistItem.isbn.is_not(None)
        )
        result = await self.session.execute(stmt)
        return [row[0] for row in result.all()]

    async def get_title_only_by_user(self, user_id: uuid.UUID) -> list[str]:
        """Titles of entries added without an ISBN (matched by title)."""
        stmt = select(WishlistItem.title).where(
            WishlistItem.user_id == user_id,
            WishlistItem.isbn.is_(None),
            WishlistItem.title.is_not(None),
        )
        result = await self.session.execute(stmt)
        return [row[0] for row in result.all()]


class SharedWishlistRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self, name: str, owner_id: uuid.UUID
    ) -> tuple[SharedWishlist, SharedWishlistMember]:
        wishlist = SharedWishlist(name=name, owner_id=owner_id)
        self.session.add(wishlist)
        await self.session.flush()
        member = SharedWishlistMember(wishlist_id=wishlist.id, user_id=owner_id)
        self.session.add(member)
        await self.session.flush()
        return wishlist, member

    async def get_by_id(self, wishlist_id: uuid.UUID) -> SharedWishlist | None:
        stmt = select(SharedWishlist).where(SharedWishlist.id == wishlist_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_for_user(self, user_id: uuid.UUID) -> list[SharedWishlist]:
        stmt = (
            select(SharedWishlist)
            .join(
                SharedWishlistMember,
                SharedWishlistMember.wishlist_id == SharedWishlist.id,
            )
            .where(SharedWishlistMember.user_id == user_id)
            .order_by(SharedWishlist.created_at.desc())
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_member(
        self, wishlist_id: uuid.UUID, user_id: uuid.UUID
    ) -> SharedWishlistMember | None:
        stmt = select(SharedWishlistMember).where(
            SharedWishlistMember.wishlist_id == wishlist_id,
            SharedWishlistMember.user_id == user_id,
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_members(self, wishlist_id: uuid.UUID) -> list[SharedWishlistMember]:
        stmt = (
            select(SharedWishlistMember)
            .where(SharedWishlistMember.wishlist_id == wishlist_id)
            .order_by(SharedWishlistMember.joined_at.asc())
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def add_member(
        self, wishlist_id: uuid.UUID, user_id: uuid.UUID
    ) -> SharedWishlistMember:
        member = SharedWishlistMember(wishlist_id=wishlist_id, user_id=user_id)
        self.session.add(member)
        await self.session.flush()
        return member

    async def remove_member(
        self, wishlist_id: uuid.UUID, user_id: uuid.UUID
    ) -> bool:
        member = await self.get_member(wishlist_id, user_id)
        if member is None:
            return False
        await self.session.delete(member)
        await self.session.flush()
        return True

    async def list_items(self, wishlist_id: uuid.UUID) -> list[SharedWishlistItem]:
        stmt = (
            select(SharedWishlistItem)
            .where(SharedWishlistItem.wishlist_id == wishlist_id)
            .order_by(SharedWishlistItem.created_at.desc())
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def add_item(
        self,
        wishlist_id: uuid.UUID,
        added_by: uuid.UUID,
        isbn: str | None,
        title: str,
        author: str | None,
    ) -> SharedWishlistItem:
        item = SharedWishlistItem(
            wishlist_id=wishlist_id,
            added_by=added_by,
            isbn=isbn,
            title=title,
            author=author,
        )
        self.session.add(item)
        await self.session.flush()
        return item

    async def get_user_by_email(self, email: str) -> User | None:
        normalized = email.strip().lower()
        stmt = select(User).where(func.lower(User.email) == normalized)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_user_names(
        self, user_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, str]:
        if not user_ids:
            return {}
        stmt = select(User.id, User.name).where(User.id.in_(user_ids))
        result = await self.session.execute(stmt)
        return {row[0]: row[1] for row in result.all()}
