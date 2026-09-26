"""Wishlist business logic."""

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.books.repository import BookRepository
from app.modules.wishlist.models import SharedWishlist
from app.modules.wishlist.repository import SharedWishlistRepository, WishlistRepository
from app.modules.wishlist.schemas import (
    SharedWishlistCreate,
    SharedWishlistItemCreate,
    SharedWishlistItemView,
    SharedWishlistListResponse,
    SharedWishlistMemberAdd,
    SharedWishlistMemberView,
    SharedWishlistView,
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
        self.shared_repo = SharedWishlistRepository(session)

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
        titles = await self.wishlist_repo.get_title_only_by_user(user_id)
        if not isbns and not titles:
            return WishlistMatchResponse(matches=[])

        lookups: list[tuple[str, list[Any]]] = []
        for isbn in isbns:
            lookups.append((isbn, await self.books_repo.list_available_by_isbn(isbn)))
        for title in titles:
            lookups.append(("", await self.books_repo.list_available_by_title(title)))

        matches = []
        seen: set[uuid.UUID] = set()
        for isbn, books in lookups:
            for row in books:
                if row.book.id in seen or row.book.owner_id == user_id:
                    continue
                seen.add(row.book.id)
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

    async def _build_shared_view(self, wishlist: SharedWishlist) -> SharedWishlistView:
        members = await self.shared_repo.list_members(wishlist.id)
        items = await self.shared_repo.list_items(wishlist.id)
        user_ids = {m.user_id for m in members}
        user_ids.update(i.added_by for i in items)
        user_ids.add(wishlist.owner_id)
        names = await self.shared_repo.get_user_names(list(user_ids))
        return SharedWishlistView(
            id=wishlist.id,
            name=wishlist.name,
            owner_id=wishlist.owner_id,
            owner_name=names.get(wishlist.owner_id, ""),
            created_at=wishlist.created_at,
            members=[
                SharedWishlistMemberView(
                    user_id=m.user_id,
                    name=names.get(m.user_id, ""),
                    is_owner=m.user_id == wishlist.owner_id,
                    joined_at=m.joined_at,
                )
                for m in members
            ],
            items=[
                SharedWishlistItemView(
                    id=i.id,
                    wishlist_id=i.wishlist_id,
                    added_by=i.added_by,
                    added_by_name=names.get(i.added_by, ""),
                    isbn=i.isbn,
                    title=i.title,
                    author=i.author,
                    created_at=i.created_at,
                )
                for i in items
            ],
        )

    async def create_shared_wishlist(
        self, user_id: uuid.UUID, body: SharedWishlistCreate
    ) -> SharedWishlistView:
        wishlist, _ = await self.shared_repo.create(name=body.name, owner_id=user_id)
        view = await self._build_shared_view(wishlist)
        await self.session.commit()
        return view

    async def list_shared_wishlists(self, user_id: uuid.UUID) -> SharedWishlistListResponse:
        wishlists = await self.shared_repo.list_for_user(user_id)
        items = [await self._build_shared_view(w) for w in wishlists]
        return SharedWishlistListResponse(items=items)

    async def get_shared_wishlist(
        self, user_id: uuid.UUID, wishlist_id: uuid.UUID
    ) -> SharedWishlistView:
        wishlist = await self.shared_repo.get_by_id(wishlist_id)
        if wishlist is None:
            raise WishlistError("Ortak liste bulunamadı", 404)
        membership = await self.shared_repo.get_member(wishlist_id, user_id)
        if membership is None:
            raise WishlistError("Bu ortak listenin üyesi değilsiniz", 403)
        return await self._build_shared_view(wishlist)

    async def add_shared_wishlist_item(
        self,
        user_id: uuid.UUID,
        wishlist_id: uuid.UUID,
        body: SharedWishlistItemCreate,
    ) -> SharedWishlistItemView:
        wishlist = await self.shared_repo.get_by_id(wishlist_id)
        if wishlist is None:
            raise WishlistError("Ortak liste bulunamadı", 404)
        membership = await self.shared_repo.get_member(wishlist_id, user_id)
        if membership is None:
            raise WishlistError("Bu ortak listenin üyesi değilsiniz", 403)
        item = await self.shared_repo.add_item(
            wishlist_id=wishlist_id,
            added_by=user_id,
            isbn=body.isbn,
            title=body.title,
            author=body.author,
        )
        names = await self.shared_repo.get_user_names([item.added_by])
        view = SharedWishlistItemView(
            id=item.id,
            wishlist_id=item.wishlist_id,
            added_by=item.added_by,
            added_by_name=names.get(item.added_by, ""),
            isbn=item.isbn,
            title=item.title,
            author=item.author,
            created_at=item.created_at,
        )
        await self.session.commit()
        return view

    async def add_member(
        self,
        user_id: uuid.UUID,
        wishlist_id: uuid.UUID,
        body: SharedWishlistMemberAdd,
    ) -> None:
        wishlist = await self.shared_repo.get_by_id(wishlist_id)
        if wishlist is None:
            raise WishlistError("Ortak liste bulunamadı", 404)
        if wishlist.owner_id != user_id:
            raise WishlistError("Sadece liste sahibi üye ekleyebilir", 403)
        target = await self.shared_repo.get_user_by_email(body.email)
        if target is None:
            raise WishlistError("Bu e-posta ile kayıtlı kullanıcı bulunamadı", 404)
        if target.id == user_id:
            raise WishlistError("Zaten bu listenin üyesisiniz", 400)
        existing = await self.shared_repo.get_member(wishlist_id, target.id)
        if existing is not None:
            raise WishlistError("Kullanıcı zaten üye", 400)
        await self.shared_repo.add_member(wishlist_id, target.id)
        await self.session.commit()

    async def remove_member(
        self,
        user_id: uuid.UUID,
        wishlist_id: uuid.UUID,
        member_user_id: uuid.UUID,
    ) -> None:
        wishlist = await self.shared_repo.get_by_id(wishlist_id)
        if wishlist is None:
            raise WishlistError("Ortak liste bulunamadı", 404)
        requester = await self.shared_repo.get_member(wishlist_id, user_id)
        if requester is None:
            raise WishlistError("Bu ortak listenin üyesi değilsiniz", 403)
        target = await self.shared_repo.get_member(wishlist_id, member_user_id)
        if target is None:
            raise WishlistError("Üye bulunamadı", 404)
        is_owner = wishlist.owner_id == user_id
        is_self = member_user_id == user_id
        if member_user_id == wishlist.owner_id:
            raise WishlistError("Liste sahibi listeden çıkarılamaz", 400)
        if not is_self and not is_owner:
            raise WishlistError("Sadece kendinizi listeden çıkarabilirsiniz", 403)
        removed = await self.shared_repo.remove_member(wishlist_id, member_user_id)
        if not removed:
            raise WishlistError("Üye bulunamadı", 404)
        await self.session.commit()
