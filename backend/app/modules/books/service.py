"""Books business logic. Authorization checks happen first, per TECHNICAL_ARCHITECTURE.md."""

import logging
import uuid

logger = logging.getLogger(__name__)

from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select

from app.core.geo import blur, in_turkey_bbox, make_point
from app.core.s3 import delete_photo as s3_delete_photo
from app.core.s3 import upload_photo as s3_upload_photo
from app.core.s3 import _upload_s3, _upload_local, _is_s3_configured

from app.modules.books.models import Book, BookPhoto
from app.modules.auth.models import User
from app.modules.books.isbn_lookup import lookup_isbn as isbn_lookup
from app.modules.books.repository import BookRepository, BookRow, encode_cursor
from app.modules.books.schemas import (
    BookCreateRequest,
    BookListResponse,
    BookOwnerView,
    BookPublicView,
    BookSearchParams,
    BookSearchResponse,
    BookSearchResult,
    BookUpdateRequest,
    ClusterPoint,
    ClusterResponse,
    ISBNLookupResponse,
    LocationInput,
    LocationOutput,
    PhotoView,
    ReorderDelta,
)
from app.modules.exchanges.repository import ExchangeRepository


async def _s3_upload_photo_raw(book_id: uuid.UUID, filename: str, file_bytes: bytes, content_type: str) -> str:
    """Raw upload to S3/local — used for thumbnail backfill."""
    if _is_s3_configured():
        return await _upload_s3(book_id, filename, file_bytes, content_type)
    return await _upload_local(book_id, filename, file_bytes)


class BookError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        self.message = message
        self.status_code = status_code


def _to_photo_views(photos: list) -> list[PhotoView]:
    return [PhotoView(id=p.id, url=p.url, thumbnail_url=p.thumbnail_url, position=p.position) for p in photos]


def _to_owner_view(
    row: BookRow,
    owner_name: str,
    photos: list | None = None,
    is_favorited: bool = False,
    is_owner: bool = True,
) -> BookOwnerView:
    book = row.book
    return BookOwnerView(
        id=book.id,
        owner_id=book.owner_id,
        owner_name=owner_name,
        title=book.title,
        author=book.author,
        isbn=book.isbn,
        description=book.description,
        category=book.category,
        language=book.language,
        condition=book.condition,
        is_available=book.is_available,
        location=LocationOutput(lat=row.location[0], lng=row.location[1]),
        public_location=LocationOutput(lat=row.public_location[0], lng=row.public_location[1]),
        photos=_to_photo_views(photos) if photos else [],
        view_count=book.view_count,
        favorite_count=book.favorite_count,
        is_favorited=is_favorited,
        created_at=book.created_at,
        updated_at=book.updated_at,
    )


def _to_public_view(
    row: BookRow,
    owner_name: str,
    photos: list | None = None,
    is_favorited: bool = False,
) -> BookPublicView:
    book = row.book
    return BookPublicView(
        id=book.id,
        owner_id=book.owner_id,
        owner_name=owner_name,
        title=book.title,
        author=book.author,
        isbn=book.isbn,
        description=book.description,
        category=book.category,
        language=book.language,
        condition=book.condition,
        is_available=book.is_available,
        public_location=LocationOutput(lat=row.public_location[0], lng=row.public_location[1]),
        photos=_to_photo_views(photos) if photos else [],
        view_count=book.view_count,
        favorite_count=book.favorite_count,
        is_favorited=is_favorited,
        created_at=book.created_at,
        updated_at=book.updated_at,
    )


class BookService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = BookRepository(session)
        self.exchanges_repo = ExchangeRepository(session)

    async def _get_owner_name(self, owner_id: uuid.UUID) -> str:
        result = await self.session.execute(select(User.name).where(User.id == owner_id))
        name = result.scalar_one_or_none()
        return name or "Bilinmeyen Kullanıcı"

    async def _get_owner_names(self, owner_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
        """Batch fetch owner names. Returns dict of {owner_id: name}."""
        if not owner_ids:
            return {}
        result = await self.session.execute(
            select(User.id, User.name).where(User.id.in_(set(owner_ids)))
        )
        names = {row.id: row.name for row in result}
        return names

    async def create_book(self, owner_id: uuid.UUID, body: BookCreateRequest) -> BookOwnerView:
        lat, lng = body.location.lat, body.location.lng
        if not in_turkey_bbox(lat, lng):
            raise BookError("LOCATION_OUTSIDE_TURKEY", 400)

        public_lat, public_lng = blur(lat, lng)
        fields = body.model_dump(exclude={"location"})
        book = await self.repo.create(
            owner_id,
            fields,
            location=make_point(lat, lng),
            public_location=make_point(public_lat, public_lng),
        )
        await self.session.commit()

        owner_name = await self._get_owner_name(owner_id)
        row = BookRow(book=book, location=(lat, lng), public_location=(public_lat, public_lng))
        return _to_owner_view(row, owner_name)

    async def list_my_books(
        self, owner_id: uuid.UUID, cursor: str | None, limit: int
    ) -> BookListResponse:
        rows, next_cursor = await self.repo.list_by_owner(owner_id, cursor, limit)
        items = []
        owner_name = await self._get_owner_name(owner_id)
        for row in rows:
            photos = await self.repo.get_photos(row.book.id)
            items.append(_to_owner_view(row, owner_name, photos))
        return BookListResponse(items=items, next_cursor=next_cursor)

    async def list_available_books(
        self, cursor: str | None, limit: int, current_user_id: uuid.UUID | None = None
    ) -> BookListResponse:
        rows = await self.repo.list_available(cursor, limit, current_user_id)
        next_cursor = None
        if rows:
            last = rows[-1]
            next_cursor = encode_cursor(last.book.sort_order, last.book.created_at, last.book.id) if len(rows) == limit else None
        items = []
        owner_ids = [row.book.owner_id for row in rows]
        owner_names = await self._get_owner_names(owner_ids)
        for row in rows:
            photos = await self.repo.get_photos(row.book.id)
            owner_name = owner_names.get(row.book.owner_id, "Bilinmeyen Kullanıcı")
            items.append(_to_public_view(row, owner_name, photos))
        return BookListResponse(items=items, next_cursor=next_cursor)

    async def search_bbox(
        self,
        min_lat: float,
        max_lat: float,
        min_lng: float,
        max_lng: float,
        category: str | None,
        language: str | None,
        condition: str | None,
        q: str | None,
        limit: int,
        current_user_id: uuid.UUID,
        cursor: str | None = None,
    ) -> BookSearchResponse:
        if min_lat >= max_lat or min_lng >= max_lng:
            raise BookError("min must be less than max", 422)

        # Area clamp — ~50km × 50km max (0.45 deg lat ≈ 50km)
        lat_span = max_lat - min_lat
        lng_span = max_lng - min_lng
        if lat_span > 0.45 or lng_span > 0.6:
            raise BookError("Alan çok geniş — yakınlaştırın.", 422)

        rows = await self.repo.search_bbox(
            min_lat, max_lat, min_lng, max_lng,
            category, language, condition, q, limit, current_user_id,
            cursor=cursor,
        )

        # Batch fetch first photos so markers and cards can show cover images.
        first_photos = await self.repo.get_first_photos_batch(
            [r.book.id for r in rows]
        )

        items = [
            BookSearchResult(
                id=r.book.id, owner_id=r.book.owner_id, owner_name=r.owner.name,
                title=r.book.title, author=r.book.author, isbn=r.book.isbn,
                description=r.book.description, category=r.book.category,
                language=r.book.language, condition=r.book.condition,
                is_available=r.book.is_available,
                public_location=LocationOutput(lat=r.public_location[0], lng=r.public_location[1]),
                distance_km=round(r.distance_m / 1000.0, 1),
                photos=_to_photo_views([first_photos[r.book.id]]) if r.book.id in first_photos else [],
                created_at=r.book.created_at, updated_at=r.book.updated_at,
                owner=r.owner,
            )
            for r in rows
        ]
        return BookSearchResponse(items=items)

    async def search_clusters(
        self,
        min_lat: float,
        max_lat: float,
        min_lng: float,
        max_lng: float,
        category: str | None,
        language: str | None,
        condition: str | None,
        q: str | None,
        limit: int,
        current_user_id: uuid.UUID,
    ) -> ClusterResponse:
        lat_span = max_lat - min_lat
        lng_span = max_lng - min_lng
        if min_lat >= max_lat or min_lng >= max_lng:
            raise BookError("min must be less than max", 422)
        if lat_span > 0.45 or lng_span > 0.6:
            raise BookError("Alan çok geniş — yakınlaştırın.", 422)

        cluster_dicts, singleton_rows = await self.repo.search_clusters(
            min_lat, max_lat, min_lng, max_lng,
            category, language, condition, q, limit, current_user_id,
        )

        # Batch fetch first photos for singletons so their markers/cards show covers.
        singleton_first_photos = await self.repo.get_first_photos_batch(
            [r.book.id for r in singleton_rows]
        )

        clusters = []
        for cd in cluster_dicts:
            photos = await self.repo.get_photos(cd["front_book_id"])
            front_photo = photos[0] if photos else None
            clusters.append(
                ClusterPoint(
                    centroid=LocationOutput(lat=cd["centroid"][0], lng=cd["centroid"][1]),
                    book_ids=cd["book_ids"],
                    count=cd["count"],
                    front_cover_url=front_photo.url if front_photo else None,
                    front_thumbnail_url=front_photo.thumbnail_url if front_photo else None,
                    front_title=cd["front_title"],
                    categories=cd["categories"],
                )
            )

        singletons = [
            BookSearchResult(
                id=r.book.id,
                owner_id=r.book.owner_id,
                owner_name=r.owner.name,
                title=r.book.title,
                author=r.book.author,
                isbn=r.book.isbn,
                description=r.book.description,
                category=r.book.category,
                language=r.book.language,
                condition=r.book.condition,
                is_available=r.book.is_available,
                public_location=LocationOutput(
                    lat=r.public_location[0], lng=r.public_location[1]
                ),
                distance_km=r.distance_m / 1000.0,
                photos=_to_photo_views([singleton_first_photos[r.book.id]]) if r.book.id in singleton_first_photos else [],
                created_at=r.book.created_at,
                updated_at=r.book.updated_at,
                owner=r.owner,
            )
            for r in singleton_rows
        ]
        return ClusterResponse(clusters=clusters, singletons=singletons)

    async def search_nearby(
        self, params: BookSearchParams, limit: int = 20, current_user_id: uuid.UUID | None = None
    ) -> BookSearchResponse:
        radius_m = params.radius_km * 1000 if params.radius_km else 0

        rows = await self.repo.search_nearby(
            user_lat=params.lat,
            user_lng=params.lng,
            radius_m=radius_m,
            category=params.category.value if params.category else None,
            language=params.language,
            condition=params.condition.value if params.condition else None,
            q=params.q,
            cursor=None,
            limit=limit,
            current_user_id=current_user_id,
            owner_id=params.owner_id,
        )

        items = []
        owner_ids = [row.book.owner_id for row in rows]
        owner_names = await self._get_owner_names(owner_ids)
        for row in rows:
            photos = await self.repo.get_photos(row.book.id)
            owner_name = owner_names.get(row.book.owner_id, "Bilinmeyen Kullanıcı")
            items.append(
                BookSearchResult(
                    id=row.book.id,
                    owner_id=row.book.owner_id,
                    owner_name=owner_name,
                    title=row.book.title,
                    author=row.book.author,
                    isbn=row.book.isbn,
                    description=row.book.description,
                    category=row.book.category,
                    language=row.book.language,
                    condition=row.book.condition,
                    is_available=row.book.is_available,
                    public_location=LocationOutput(
                        lat=row.public_location[0], lng=row.public_location[1]
                    ),
                    distance_km=round(row.distance_m / 1000, 1),
                    owner=row.owner,
                    photos=[PhotoView(id=p.id, url=p.url, thumbnail_url=p.thumbnail_url, position=p.position) for p in photos],
                    created_at=row.book.created_at,
                    updated_at=row.book.updated_at,
                )
            )

        return BookSearchResponse(items=items)

    async def get_book(
        self, book_id: uuid.UUID, current_user_id: uuid.UUID
    ) -> BookOwnerView | BookPublicView:
        row = await self.repo.get_active_by_id(book_id)
        if row is None:
            raise BookError("Book not found", 404)

        photos = await self.repo.get_photos(book_id)
        owner_name = await self._get_owner_name(row.book.owner_id)
        is_favorited = await self.repo.is_favorited(current_user_id, book_id)

        if row.book.owner_id == current_user_id:
            return _to_owner_view(row, owner_name, photos, is_favorited=is_favorited)
        return _to_public_view(row, owner_name, photos, is_favorited=is_favorited)

    async def update_book(
        self, book_id: uuid.UUID, owner_id: uuid.UUID, body: BookUpdateRequest
    ) -> BookOwnerView:
        row = await self.repo.get_active_by_id(book_id)
        if row is None or row.book.owner_id != owner_id:
            raise BookError("Book not found", 404)

        update_data = body.model_dump(exclude_unset=True, exclude={"location"})

        new_location = row.location
        new_public_location = row.public_location
        if body.location is not None:
            location: LocationInput = body.location
            if not in_turkey_bbox(location.lat, location.lng):
                raise BookError("LOCATION_OUTSIDE_TURKEY", 400)
            new_location = (location.lat, location.lng)
            new_public_location = blur(location.lat, location.lng)
            update_data["location"] = make_point(*new_location)
            update_data["public_location"] = make_point(*new_public_location)

        await self.repo.update(row.book, update_data)
        await self.session.commit()

        owner_name = await self._get_owner_name(owner_id)
        row = BookRow(book=row.book, location=new_location, public_location=new_public_location)
        return _to_owner_view(row, owner_name)

    async def delete_book(self, book_id: uuid.UUID, owner_id: uuid.UUID, force: bool = False) -> None:
        row = await self.repo.get_active_by_id(book_id)
        if row is None or row.book.owner_id != owner_id:
            raise BookError("Book not found", 404)

        if force:
            # Cancel any active exchange requests (book-level cascade — owner deleting their book
            # implicitly cancels all pending/accepted exchanges on it).
            cancelled = await self.exchanges_repo.cancel_all_active_for_book(book_id)
            if cancelled:
                logger.info("Force-delete book %s: cancelled %d active exchange(s)", book_id, cancelled)
        elif await self.exchanges_repo.has_active_request_for_book(book_id):
            raise BookError("EXCHANGE_ACTIVE", 409)

        # Delete photos from S3
        photos = await self.repo.get_photos(book_id)
        for photo in photos:
            await s3_delete_photo(photo.url)
            if photo.thumbnail_url:
                await s3_delete_photo(photo.thumbnail_url)
            await self.repo.delete_photo(photo)

        await self.repo.soft_delete(row.book)
        await self.session.commit()

    async def upload_photo(
        self, book_id: uuid.UUID, owner_id: uuid.UUID, file_bytes: bytes, content_type: str,
        thumb_bytes: bytes | None = None,
    ) -> PhotoView:
        row = await self.repo.get_active_by_id(book_id)
        if row is None or row.book.owner_id != owner_id:
            raise BookError("Book not found", 404)

        # Validate content type
        allowed_types = {"image/jpeg", "image/png", "image/webp"}
        if content_type not in allowed_types:
            raise BookError("INVALID_IMAGE_FORMAT", 400)

        # Validate file size (max 10MB)
        if len(file_bytes) > 10 * 1024 * 1024:
            raise BookError("FILE_TOO_LARGE", 400)

        # Validate thumbnail size (max 1MB - it's a small client-resized image)
        if thumb_bytes is not None and len(thumb_bytes) > 1 * 1024 * 1024:
            raise BookError("THUMBNAIL_TOO_LARGE", 400)

        # Validate max 3 photos
        count = await self.repo.count_photos(book_id)
        if count >= 3:
            raise BookError("MAX_PHOTOS_REACHED", 400)

        # Upload original + thumbnail (client-side resized)
        urls = await s3_upload_photo(book_id, file_bytes, content_type, thumb_bytes)

        # Position = next available slot
        photos = await self.repo.get_photos(book_id)
        position = len(photos)

        # Save to DB
        photo = await self.repo.add_photo(book_id, urls["url"], position, urls["thumbnail_url"])
        await self.session.commit()

        return PhotoView(id=photo.id, url=photo.url, thumbnail_url=photo.thumbnail_url, position=photo.position)

    async def delete_book_photo(
        self, book_id: uuid.UUID, photo_id: uuid.UUID, owner_id: uuid.UUID
    ) -> None:
        row = await self.repo.get_active_by_id(book_id)
        if row is None or row.book.owner_id != owner_id:
            raise BookError("Book not found", 404)

        photos = await self.repo.get_photos(book_id)
        target = next((p for p in photos if p.id == photo_id), None)
        if target is None:
            raise BookError("Photo not found", 404)

        # Delete from S3
        await s3_delete_photo(target.url)
        if target.thumbnail_url:
            await s3_delete_photo(target.thumbnail_url)
        await self.repo.delete_photo(target)

        # Reorder remaining photos
        remaining = [p for p in photos if p.id != photo_id]
        for idx, p in enumerate(remaining):
            p.position = idx

        await self.session.commit()

    async def reorder_photos(
        self, book_id: uuid.UUID, photo_ids: list[uuid.UUID], owner_id: uuid.UUID
    ) -> list[PhotoView]:
        row = await self.repo.get_active_by_id(book_id)
        if row is None or row.book.owner_id != owner_id:
            raise BookError("Book not found", 404)

        # Validate all photos belong to this book
        existing = await self.repo.get_photos(book_id)
        existing_ids = {p.id for p in existing}
        if set(photo_ids) != existing_ids:
            raise BookError("INVALID_PHOTO_IDS", 400)

        await self.repo.reorder_photos(book_id, photo_ids)
        await self.session.commit()

        # Return updated photos
        photos = await self.repo.get_photos(book_id)
        return [PhotoView(id=p.id, url=p.url, thumbnail_url=p.thumbnail_url, position=p.position) for p in photos]

    async def upload_photo_thumbnail(
        self, book_id: uuid.UUID, photo_id: uuid.UUID, owner_id: uuid.UUID, thumb_bytes: bytes
    ) -> PhotoView:
        """Upload a client-side resized thumbnail for an existing photo."""
        row = await self.repo.get_active_by_id(book_id)
        if row is None or row.book.owner_id != owner_id:
            raise BookError("Book not found", 404)

        photos = await self.repo.get_photos(book_id)
        target = next((p for p in photos if p.id == photo_id), None)
        if target is None:
            raise BookError("Photo not found", 404)

        # Validate thumbnail size (max 1MB - it's a small client-resized image)
        if len(thumb_bytes) > 1 * 1024 * 1024:
            raise BookError("THUMBNAIL_TOO_LARGE", 400)

        # Upload thumbnail to S3
        ext = "jpg"
        thumb_filename = f"{photo_id}_thumb.{ext}"
        thumb_url = await _s3_upload_photo_raw(book_id, thumb_filename, thumb_bytes, "image/jpeg")

        # Update DB
        from sqlalchemy import update as sa_update
        await self.session.execute(
            sa_update(BookPhoto).where(BookPhoto.id == photo_id).values(thumbnail_url=thumb_url)
        )
        await self.session.commit()

        return PhotoView(id=target.id, url=target.url, thumbnail_url=thumb_url, position=target.position)

    async def increment_view(self, book_id: uuid.UUID, current_user_id: uuid.UUID) -> None:
        """Increment view count. Owners viewing their own book don't count."""
        row = await self.repo.get_active_by_id(book_id)
        if row is None:
            raise BookError("Book not found", 404)
        # Don't count owner's own views
        if row.book.owner_id != current_user_id:
            await self.repo.increment_view_count(book_id)
            await self.session.commit()

    async def add_favorite(self, book_id: uuid.UUID, user_id: uuid.UUID) -> None:
        row = await self.repo.get_active_by_id(book_id)
        if row is None:
            raise BookError("Book not found", 404)
        # Can't favorite your own book
        if row.book.owner_id == user_id:
            raise BookError("Cannot favorite your own book", 400)
        added = await self.repo.add_favorite(user_id, book_id)
        if not added:
            raise BookError("Already favorited", 409)
        await self.session.commit()

    async def remove_favorite(self, book_id: uuid.UUID, user_id: uuid.UUID) -> None:
        row = await self.repo.get_active_by_id(book_id)
        if row is None:
            raise BookError("Book not found", 404)
        removed = await self.repo.remove_favorite(user_id, book_id)
        if not removed:
            raise BookError("Not favorited", 404)
        await self.session.commit()

    async def get_favorite_status(self, book_id: uuid.UUID, user_id: uuid.UUID) -> dict:
        row = await self.repo.get_active_by_id(book_id)
        if row is None:
            raise BookError("Book not found", 404)
        is_favorited = await self.repo.is_favorited(user_id, book_id)
        return {"is_favorited": is_favorited, "favorite_count": row.book.favorite_count}

    async def lookup_isbn(self, isbn_code: str) -> ISBNLookupResponse:
        """Look up book info by ISBN from Open Library."""
        # Clean ISBN (remove hyphens, spaces)
        clean_isbn = isbn_code.replace("-", "").replace(" ", "")

        if len(clean_isbn) not in (10, 13):
            raise BookError("INVALID_ISBN", 400)

        result = await isbn_lookup(clean_isbn)
        return ISBNLookupResponse(**result)

    async def reorder_books(
        self, owner_id: uuid.UUID, reorders: list[ReorderDelta]
    ) -> list[BookOwnerView]:
        """Batch-update sort_order for a user's books.

        Args:
            owner_id: The current user's ID.
            reorders: List of (book_id, new_sort_order) pairs.

        Returns:
            Full list of the user's books.
        """
        book_ids = [r.book_id for r in reorders]

        if len(set(book_ids)) != len(book_ids):
            raise BookError("Duplicate book_ids in reorder request", 400)

        for delta in reorders:
            row = await self.repo.get_active_by_id(delta.book_id)
            if row is None or row.book.owner_id != owner_id:
                raise BookError(f"Book {delta.book_id} not found", 404)

        from sqlalchemy import update as sa_update

        for delta in reorders:
            await self.session.execute(
                sa_update(Book).where(Book.id == delta.book_id).values(sort_order=delta.sort_order)
            )
        await self.session.commit()

        result = await self.list_my_books(owner_id, None, 1000)
        return result.items
