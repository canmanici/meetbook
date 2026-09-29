"""Books business logic. Authorization checks happen first, per TECHNICAL_ARCHITECTURE.md."""

import logging
import uuid
from typing import Any

logger = logging.getLogger(__name__)

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.geo import blur, in_turkey_bbox, make_point
from app.core.s3 import _is_s3_configured, _upload_local, _upload_s3
from app.core.s3 import delete_photo as s3_delete_photo
from app.core.s3 import upload_photo as s3_upload_photo
from app.modules.auth.models import User
from app.modules.books.isbn_lookup import lookup_isbn as isbn_lookup
from app.modules.books.models import Book, BookPhoto
from app.modules.books.repository import BookRepository, BookRow, encode_cursor
from app.modules.books.schemas import (
    BookBulkCreateRequest,
    BookBulkCreateResponse,
    BookCreateRequest,
    BookListResponse,
    BookOwnerView,
    BookPublicView,
    BookSearchParams,
    BookSearchResponse,
    BookSearchResult,
    BookUpdateRequest,
    ClusterPoint,
    CourseListResponse,
    CourseSummary,
    ClusterResponse,
    FailedBookCreate,
    ISBNLookupResponse,
    LocationInput,
    LocationOutput,
    PhotoView,
    ReorderDelta,
    StaleBookView,
)
from app.core.content_policy import commercial_content
from app.modules.credits.service import CreditService
from app.modules.exchanges.repository import ExchangeRepository

MAX_PHOTO_BYTES = 10 * 1024 * 1024
MAX_THUMB_BYTES = 1 * 1024 * 1024


async def _s3_upload_photo_raw(
    book_id: uuid.UUID, filename: str, file_bytes: bytes, content_type: str
) -> str:
    """Raw upload to S3/local — used for thumbnail backfill."""
    if _is_s3_configured():
        return await _upload_s3(book_id, filename, file_bytes, content_type)
    return await _upload_local(book_id, filename, file_bytes)


class BookError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        self.message = message
        self.status_code = status_code


def _check_listing_text(*texts: str | None) -> None:
    """Books move for credits, never money: no prices, IBANs or phone numbers."""
    if commercial_content(*texts):
        raise BookError("COMMERCIAL_CONTENT", 422)


def _to_photo_views(photos: list[Any]) -> list[PhotoView]:
    return [
        PhotoView(id=p.id, url=p.url, thumbnail_url=p.thumbnail_url, position=p.position)
        for p in photos
    ]


def _to_owner_view(
    row: BookRow,
    owner_name: str,
    photos: list[Any] | None = None,
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
        course_code=book.course_code,
        instructor=book.instructor,
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
    photos: list[Any] | None = None,
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
        course_code=book.course_code,
        instructor=book.instructor,
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

    async def _attach_cover(self, book_id: uuid.UUID, cover_url: str) -> BookPhoto | None:
        """Download cover image from URL and attach as BookPhoto (best-effort)."""
        from app.core.safe_fetch import fetch_public_image

        try:
            # SSRF-hardened: public IPs only (every redirect hop re-checked),
            # image content types only, size-capped.
            file_bytes, content_type = await fetch_public_image(cover_url)
            # Third-party bytes: same checks as user uploads.
            from app.core.image_safety import PHOTO_LIMITS, sanitize_image

            safe = sanitize_image(file_bytes, PHOTO_LIMITS)
            file_bytes, content_type = safe.data, safe.content_type

            ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[content_type]
            filename = f"cover.{ext}"
            url = await _s3_upload_photo_raw(book_id, filename, file_bytes, content_type)

            photo = BookPhoto(
                book_id=book_id,
                url=url,
                position=0,
            )
            self.session.add(photo)
            await self.session.flush()
            return photo
        except Exception:
            logger.warning(
                "Cover download/attach failed for book %s url=%s", book_id, cover_url, exc_info=True
            )
            return None

    async def create_book(self, owner_id: uuid.UUID, body: BookCreateRequest) -> BookOwnerView:
        lat, lng = body.location.lat, body.location.lng
        if not in_turkey_bbox(lat, lng):
            raise BookError("LOCATION_OUTSIDE_TURKEY", 400)
        _check_listing_text(body.title, body.author, body.description, body.instructor)

        public_lat, public_lng = blur(lat, lng)
        fields = body.model_dump(exclude={"location", "cover_url"})
        book = await self.repo.create(
            owner_id,
            fields,
            location=make_point(lat, lng),
            public_location=make_point(public_lat, public_lng),
        )

        # Download cover from URL and attach as BookPhoto (best-effort)
        photos: list[PhotoView] = []
        if body.cover_url:
            try:
                cover_photo = await self._attach_cover(book.id, body.cover_url)
                if cover_photo:
                    photos = [
                        PhotoView(
                            id=cover_photo.id,
                            url=cover_photo.url,
                            thumbnail_url=cover_photo.thumbnail_url,
                            position=0,
                        )
                    ]
            except Exception:
                logger.warning("Cover download/attach failed for book %s", book.id, exc_info=True)

        await self.session.commit()

        await _notify_wishlist_matches(
            session=self.session,
            book_isbn=book.isbn,
            book_title=book.title,
            book_id=book.id,
            owner_id=owner_id,
        )

        owner_name = await self._get_owner_name(owner_id)
        row = BookRow(book=book, location=(lat, lng), public_location=(public_lat, public_lng))
        return _to_owner_view(row, owner_name, photos=photos)

    async def bulk_create(
        self, owner_id: uuid.UUID, body: BookBulkCreateRequest
    ) -> BookBulkCreateResponse:
        """Create multiple books in batch. Failed items are returned with error messages,
        successful items are committed."""
        items: list[BookOwnerView] = []
        failed: list[FailedBookCreate] = []
        owner_name = await self._get_owner_name(owner_id)

        for idx, book_body in enumerate(body.books):
            try:
                lat, lng = book_body.location.lat, book_body.location.lng
                if not in_turkey_bbox(lat, lng):
                    failed.append(FailedBookCreate(index=idx, error="LOCATION_OUTSIDE_TURKEY"))
                    continue
                if commercial_content(
                    book_body.title, book_body.author, book_body.description, book_body.instructor
                ):
                    failed.append(FailedBookCreate(index=idx, error="COMMERCIAL_CONTENT"))
                    continue

                public_lat, public_lng = blur(lat, lng)
                fields = book_body.model_dump(exclude={"location", "cover_url"})
                book = await self.repo.create(
                    owner_id,
                    fields,
                    location=make_point(lat, lng),
                    public_location=make_point(public_lat, public_lng),
                )

                # Download cover from URL and attach as BookPhoto (best-effort)
                bulk_photos: list[PhotoView] = []
                if book_body.cover_url:
                    try:
                        cover_photo = await self._attach_cover(book.id, book_body.cover_url)
                        if cover_photo:
                            bulk_photos = [
                                PhotoView(
                                    id=cover_photo.id,
                                    url=cover_photo.url,
                                    thumbnail_url=cover_photo.thumbnail_url,
                                    position=0,
                                )
                            ]
                    except Exception:
                        logger.warning(
                            "Cover download/attach failed for book %s", book.id, exc_info=True
                        )

                row = BookRow(
                    book=book,
                    location=(lat, lng),
                    public_location=(public_lat, public_lng),
                )
                items.append(_to_owner_view(row, owner_name, photos=bulk_photos))

            except BookError as e:
                failed.append(FailedBookCreate(index=idx, error=e.message))
            except Exception as e:
                logger.exception("Bulk create failed at index %d: %s", idx, e)
                failed.append(FailedBookCreate(index=idx, error="INTERNAL_ERROR"))

        await self.session.commit()

        for item in items:
            if item.isbn:
                await _notify_wishlist_matches(
                    session=self.session,
                    book_isbn=item.isbn,
                    book_title=item.title,
                    book_id=item.id,
                    owner_id=owner_id,
                )

        return BookBulkCreateResponse(items=items, failed=failed)

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
            next_cursor = (
                encode_cursor(last.book.sort_order, last.book.created_at, last.book.id)
                if len(rows) == limit
                else None
            )
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
        origin: tuple[float, float] | None = None,
    ) -> BookSearchResponse:
        if min_lat >= max_lat or min_lng >= max_lng:
            raise BookError("min must be less than max", 422)

        # Area clamp — ~50km × 50km max (0.45 deg lat ≈ 50km)
        lat_span = max_lat - min_lat
        lng_span = max_lng - min_lng
        if lat_span > 0.45 or lng_span > 0.6:
            raise BookError("Alan çok geniş — yakınlaştırın.", 422)

        rows = await self.repo.search_bbox(
            min_lat,
            max_lat,
            min_lng,
            max_lng,
            category,
            language,
            condition,
            q,
            limit,
            current_user_id,
            cursor=cursor,
            origin=origin,
        )

        # Batch fetch first photos so markers and cards can show cover images.
        first_photos = await self.repo.get_first_photos_batch([r.book.id for r in rows])

        items = [
            BookSearchResult(
                id=r.book.id,
                owner_id=r.book.owner_id,
                owner_name=r.owner.name,
                title=r.book.title,
                author=r.book.author,
                isbn=r.book.isbn,
                description=r.book.description,
                course_code=r.book.course_code,
                instructor=r.book.instructor,
                category=r.book.category,
                language=r.book.language,
                condition=r.book.condition,
                is_available=r.book.is_available,
                public_location=LocationOutput(lat=r.public_location[0], lng=r.public_location[1]),
                distance_km=round(r.distance_m / 1000.0, 1),
                photos=_to_photo_views([first_photos[r.book.id]])
                if r.book.id in first_photos
                else [],
                created_at=r.book.created_at,
                updated_at=r.book.updated_at,
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
        origin: tuple[float, float] | None = None,
    ) -> ClusterResponse:
        lat_span = max_lat - min_lat
        lng_span = max_lng - min_lng
        if min_lat >= max_lat or min_lng >= max_lng:
            raise BookError("min must be less than max", 422)
        if lat_span > 0.45 or lng_span > 0.6:
            raise BookError("Alan çok geniş — yakınlaştırın.", 422)

        cluster_dicts, singleton_rows = await self.repo.search_clusters(
            min_lat,
            max_lat,
            min_lng,
            max_lng,
            category,
            language,
            condition,
            q,
            limit,
            current_user_id,
            origin=origin,
        )

        # One batch for every first photo (singletons + shelf members) instead
        # of a query per shelf.
        member_rows = [r for cd in cluster_dicts for r in cd["rows"]]
        first_photos = await self.repo.get_first_photos_batch(
            [r.book.id for r in singleton_rows] + [r.book.id for r in member_rows]
        )
        singleton_first_photos = first_photos

        clusters = []
        for cd in cluster_dicts:
            front_photo = first_photos.get(cd["front_book_id"])
            clusters.append(
                ClusterPoint(
                    centroid=LocationOutput(lat=cd["centroid"][0], lng=cd["centroid"][1]),
                    book_ids=cd["book_ids"],
                    count=cd["count"],
                    front_cover_url=front_photo.url if front_photo else None,
                    front_thumbnail_url=front_photo.thumbnail_url if front_photo else None,
                    front_title=cd["front_title"],
                    categories=cd["categories"],
                    books=[_search_result(r, first_photos.get(r.book.id)) for r in cd["rows"]],
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
                course_code=r.book.course_code,
                instructor=r.book.instructor,
                category=r.book.category,
                language=r.book.language,
                condition=r.book.condition,
                is_available=r.book.is_available,
                public_location=LocationOutput(lat=r.public_location[0], lng=r.public_location[1]),
                distance_km=round(r.distance_m / 1000.0, 1),
                photos=_to_photo_views([singleton_first_photos[r.book.id]])
                if r.book.id in singleton_first_photos
                else [],
                created_at=r.book.created_at,
                updated_at=r.book.updated_at,
                owner=r.owner,
            )
            for r in singleton_rows
        ]
        return ClusterResponse(clusters=clusters, singletons=singletons)

    async def list_courses(self, q: str | None, current_user_id: uuid.UUID) -> CourseListResponse:
        """Course codes that have available books, most copies first."""
        rows = await self.repo.list_courses(q, current_user_id)
        return CourseListResponse(
            items=[
                CourseSummary(course_code=code, book_count=count, instructors=instructors)
                for code, count, instructors in rows
            ]
        )

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
            course=params.course,
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
                    course_code=row.book.course_code,
                    instructor=row.book.instructor,
                    category=row.book.category,
                    language=row.book.language,
                    condition=row.book.condition,
                    is_available=row.book.is_available,
                    public_location=LocationOutput(
                        lat=row.public_location[0], lng=row.public_location[1]
                    ),
                    distance_km=round(row.distance_m / 1000, 1),
                    owner=row.owner,
                    photos=[
                        PhotoView(
                            id=p.id, url=p.url, thumbnail_url=p.thumbnail_url, position=p.position
                        )
                        for p in photos
                    ],
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
        _check_listing_text(body.title, body.author, body.description, body.instructor)

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

    async def delete_book(
        self, book_id: uuid.UUID, owner_id: uuid.UUID, force: bool = False
    ) -> None:
        row = await self.repo.get_active_by_id(book_id)
        if row is None or row.book.owner_id != owner_id:
            raise BookError("Book not found", 404)

        if force:
            # Cancel any active exchange requests (book-level cascade — owner deleting their book
            # implicitly cancels all pending/accepted exchanges on it).
            cancelled, loans = await self.exchanges_repo.cancel_all_active_for_book(book_id)
            # The owner withdrew the book, the borrower did nothing wrong.
            credits = CreditService(self.session)
            for loan in loans:
                await credits.release_deposit(loan)
            if cancelled:
                logger.info(
                    "Force-delete book %s: cancelled %d active exchange(s)", book_id, cancelled
                )
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
        self,
        book_id: uuid.UUID,
        owner_id: uuid.UUID,
        file_bytes: bytes,
        content_type: str,
        thumb_bytes: bytes | None = None,
    ) -> PhotoView:
        row = await self.repo.get_active_by_id(book_id)
        if row is None or row.book.owner_id != owner_id:
            raise BookError("Book not found", 404)

        # Validate file size (max 10MB)
        if len(file_bytes) > MAX_PHOTO_BYTES:
            raise BookError("FILE_TOO_LARGE", 400)

        # Validate thumbnail size (max 1MB - it's a small client-resized image)
        if thumb_bytes is not None and len(thumb_bytes) > MAX_THUMB_BYTES:
            raise BookError("THUMBNAIL_TOO_LARGE", 400)

        # Real type from the bytes (not the client label), image-bomb limits,
        # GPS/EXIF stripped — for the thumbnail too.
        from app.core.image_safety import PHOTO_LIMITS, UnsafeImageError, sanitize_image

        try:
            photo = sanitize_image(file_bytes, PHOTO_LIMITS)
            thumb = sanitize_image(thumb_bytes, PHOTO_LIMITS) if thumb_bytes is not None else None
        except UnsafeImageError as exc:
            raise BookError(exc.code, 400) from None
        file_bytes, content_type = photo.data, photo.content_type
        thumb_bytes = thumb.data if thumb is not None else None

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

        return PhotoView(
            id=photo.id, url=photo.url, thumbnail_url=photo.thumbnail_url, position=photo.position
        )

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
        return [
            PhotoView(id=p.id, url=p.url, thumbnail_url=p.thumbnail_url, position=p.position)
            for p in photos
        ]

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
        if len(thumb_bytes) > MAX_THUMB_BYTES:
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

        return PhotoView(
            id=target.id, url=target.url, thumbnail_url=thumb_url, position=target.position
        )

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

    async def get_favorite_status(self, book_id: uuid.UUID, user_id: uuid.UUID) -> dict[str, Any]:
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
        # Owner listing → every item is the owner view.
        return [i for i in result.items if isinstance(i, BookOwnerView)]

    async def list_stale_books(self, owner_id: uuid.UUID, days: int = 30) -> list[StaleBookView]:
        """B19 — Find the owner's available books dormant for `days` days.

        A book is stale when its `updated_at` is older than the cutoff. Because
        view/favorite increments also bump `updated_at` (see repository), this
        captures listings with no recent views, edits, or favorites — i.e.
        genuinely dormant.
        """
        from datetime import UTC, datetime, timedelta

        from geoalchemy2 import Geometry
        from sqlalchemy import cast, func

        cutoff = datetime.now(UTC) - timedelta(days=days)
        loc = cast(Book.location, Geometry)
        pub = cast(Book.public_location, Geometry)
        stmt = (
            select(
                Book,
                func.ST_Y(loc).label("lat"),
                func.ST_X(loc).label("lng"),
                func.ST_Y(pub).label("public_lat"),
                func.ST_X(pub).label("public_lng"),
            )
            .where(
                Book.owner_id == owner_id,
                Book.is_available.is_(True),
                Book.deleted_at.is_(None),
                Book.updated_at < cutoff,
            )
            .order_by(Book.updated_at.asc())
        )
        result = await self.session.execute(stmt)
        rows = result.all()

        owner_name = await self._get_owner_name(owner_id)
        now = datetime.now(UTC)
        items: list[StaleBookView] = []
        for row in rows:
            book = row[0]
            book_row = BookRow(
                book=book,
                location=(row.lat, row.lng),
                public_location=(row.public_lat, row.public_lng),
            )
            photos = await self.repo.get_photos(book.id)
            base = _to_owner_view(book_row, owner_name, photos)
            items.append(
                StaleBookView(
                    **base.model_dump(),
                    days_since_update=max(0, (now - book.updated_at).days),
                    last_activity=book.updated_at,
                )
            )
        return items

    async def relist_book(self, book_id: uuid.UUID, owner_id: uuid.UUID) -> BookOwnerView:
        """B19 — Refresh a dormant book's listing by bumping `updated_at` to now.

        This removes the book from the stale list and signals freshness to
        search ranking without disrupting the owner's custom sort order.
        """
        row = await self.repo.get_active_by_id(book_id)
        if row is None or row.book.owner_id != owner_id:
            raise BookError("Book not found", 404)

        from datetime import UTC, datetime

        from sqlalchemy import update as sa_update

        await self.session.execute(
            sa_update(Book).where(Book.id == book_id).values(updated_at=datetime.now(UTC))
        )
        await self.session.commit()

        # Re-fetch: async sessions don't lazy-load, so the in-memory object
        # won't reflect the bumped updated_at until we reload it from the DB.
        row = await self.repo.get_active_by_id(book_id)
        if row is None:
            raise BookError("Book not found", 404)
        owner_name = await self._get_owner_name(owner_id)
        photos = await self.repo.get_photos(book_id)
        return _to_owner_view(row, owner_name, photos)


async def _notify_wishlist_matches(
    session: AsyncSession,
    book_isbn: str | None,
    book_title: str,
    book_id: uuid.UUID,
    owner_id: uuid.UUID,
) -> None:
    """Notify users whose wishlist matches this newly listed book."""
    if not book_isbn:
        return

    try:
        import logging

        from sqlalchemy import select

        from app.modules.notifications.service import NotificationService
        from app.modules.wishlist.models import WishlistItem

        logger = logging.getLogger(__name__)

        result = await session.execute(
            select(WishlistItem.user_id).where(
                WishlistItem.isbn == book_isbn,
                WishlistItem.user_id != owner_id,
            )
        )
        matched_user_ids = [row[0] for row in result.all()]

        if not matched_user_ids:
            return

        notif_svc = NotificationService(session)

        for user_id in matched_user_ids:
            # No distance check here (that's the geofence worker's job), so
            # don't claim the book is nearby.
            await notif_svc.notify(
                user_id,
                "wishlist_match",
                {"book_id": str(book_id), "book_title": book_title, "isbn": book_isbn},
                title="İstediğin Kitap Bulundu!",
                body=f"“{book_title}” MeetBook'ta listelendi.",
            )
        await session.commit()

        logger.info(
            "Wishlist match: book=%s isbn=%s notified %d users",
            book_id,
            book_isbn,
            len(matched_user_ids),
        )

    except Exception as exc:
        import logging

        logger = logging.getLogger(__name__)
        logger.exception("Wishlist match notification failed: %s", exc)


def _search_result(r: Any, first_photo: Any | None) -> BookSearchResult:
    """BookSearchRow → BookSearchResult with (at most) its first photo."""
    return BookSearchResult(
        id=r.book.id,
        owner_id=r.book.owner_id,
        owner_name=r.owner.name,
        title=r.book.title,
        author=r.book.author,
        isbn=r.book.isbn,
        description=r.book.description,
        course_code=r.book.course_code,
        instructor=r.book.instructor,
        category=r.book.category,
        language=r.book.language,
        condition=r.book.condition,
        is_available=r.book.is_available,
        public_location=LocationOutput(lat=r.public_location[0], lng=r.public_location[1]),
        distance_km=round(r.distance_m / 1000.0, 1),
        photos=_to_photo_views([first_photo]) if first_photo else [],
        created_at=r.book.created_at,
        updated_at=r.book.updated_at,
        owner=r.owner,
    )
