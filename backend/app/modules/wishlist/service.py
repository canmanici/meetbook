"""Wishlist business logic."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.books.repository import BookRepository
from app.modules.wishlist.repository import WishlistRepository
from app.modules.wishlist.schemas import (
    WishlistItemCreateRequest,
    WishlistItemView,
    WishlistListResponse,
    WishlistMatchResponse,
    WishlistMatchView,
)


class WishlistError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        self.message = message
        self.status_code = status_code


class WishlistService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.wishlist_repo = WishlistRepository(session)
        self.books_repo = BookRepository(session)

    async def add_item(
        self, user_id: uuid.UUID, body: WishlistItemCreateRequest
    ) -> WishlistItemView:
        item = await self.wishlist_repo.add_item(
            user_id=user_id,
            isbn=body.isbn,
            title=body.title,
            author=body.author,
            notes=body.notes,
        )
        await self.session.commit()

        return WishlistItemView(
            id=item.id,
            isbn=item.isbn,
            title=item.title,
            author=item.author,
            notes=item.notes,
            created_at=item.created_at,
        )

    async def list_items(self, user_id: uuid.UUID) -> WishlistListResponse:
        items = await self.wishlist_repo.list_by_user(user_id)
        return WishlistListResponse(
            items=[
                WishlistItemView(
                    id=item.id,
                    isbn=item.isbn,
                    title=item.title,
                    author=item.author,
                    notes=item.notes,
                    created_at=item.created_at,
                )
                for item in items
            ]
        )

    async def delete_item(self, user_id: uuid.UUID, item_id: uuid.UUID) -> None:
        item = await self.wishlist_repo.get_by_id(item_id)
        if item is None or item.user_id != user_id:
            raise WishlistError("Item not found", 404)

        await self.wishlist_repo.delete_item(item)
        await self.session.commit()

    async def find_matches(self, user_id: uuid.UUID) -> WishlistMatchResponse:
        isbns = await self.wishlist_repo.get_isbns_by_user(user_id)
        if not isbns:
            return WishlistMatchResponse(matches=[])

        matches = []
        for isbn in isbns:
            books = await self.books_repo.list_available_by_isbn(isbn)
            for row in books:
                photos = await self.books_repo.get_photos(row.book.id)
                matches.append(
                    WishlistMatchView(
                        id=row.book.id,
                        title=row.book.title,
                        author=row.book.author,
                        isbn=row.book.isbn or isbn,
                        condition=row.book.condition.value,
                        distance_km=0,
                        photos=[{"url": p.url, "position": p.position} for p in photos],
                        created_at=row.book.created_at,
                    )
                )

        return WishlistMatchResponse(matches=matches)
