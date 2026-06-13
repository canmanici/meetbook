"""Books business logic. Authorization checks happen first, per TECHNICAL_ARCHITECTURE.md."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.geo import blur, in_turkey_bbox, make_point
from app.core.s3 import delete_photo as s3_delete_photo
from app.core.s3 import upload_photo as s3_upload_photo
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
    ISBNLookupResponse,
    LocationInput,
    LocationOutput,
    PhotoView,
)
from app.modules.exchanges.repository import ExchangeRepository


class BookError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        self.message = message
        self.status_code = status_code


def _to_photo_views(photos: list) -> list[PhotoView]:
    return [PhotoView(id=p.id, url=p.url, position=p.position) for p in photos]


def _to_owner_view(row: BookRow, photos: list | None = None) -> BookOwnerView:
    book = row.book
    return BookOwnerView(
        id=book.id,
        owner_id=book.owner_id,
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
        created_at=book.created_at,
        updated_at=book.updated_at,
    )


def _to_public_view(row: BookRow, photos: list | None = None) -> BookPublicView:
    book = row.book
    return BookPublicView(
        id=book.id,
        owner_id=book.owner_id,
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
        created_at=book.created_at,
        updated_at=book.updated_at,
    )


class BookService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = BookRepository(session)
        self.exchanges_repo = ExchangeRepository(session)

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

        row = BookRow(book=book, location=(lat, lng), public_location=(public_lat, public_lng))
        return _to_owner_view(row)

    async def list_my_books(
        self, owner_id: uuid.UUID, cursor: str | None, limit: int
    ) -> BookListResponse:
        rows = await self.repo.list_by_owner(owner_id, cursor, limit)
        next_cursor = None
        if len(rows) == limit:
            last = rows[-1].book
            next_cursor = encode_cursor(last.created_at, last.id)
        items = []
        for row in rows:
            photos = await self.repo.get_photos(row.book.id)
            items.append(_to_owner_view(row, photos))
        return BookListResponse(items=items, next_cursor=next_cursor)

    async def list_available_books(
        self, cursor: str | None, limit: int
    ) -> BookListResponse:
        rows = await self.repo.list_available(cursor, limit)
        next_cursor = None
        if len(rows) == limit:
            last = rows[-1].book
            next_cursor = encode_cursor(last.created_at, last.id)
        items = []
        for row in rows:
            photos = await self.repo.get_photos(row.book.id)
            items.append(_to_public_view(row, photos))
        return BookListResponse(items=items, next_cursor=next_cursor)

    async def search_nearby(
        self, params: BookSearchParams, limit: int = 20
    ) -> BookSearchResponse:
        radius_m = params.radius_km * 1000

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
        )

        items = []
        for row in rows:
            photos = await self.repo.get_photos(row.book.id)
            items.append(
                BookSearchResult(
                    id=row.book.id,
                    owner_id=row.book.owner_id,
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
                    photos=[PhotoView(id=p.id, url=p.url, position=p.position) for p in photos],
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
        if row.book.owner_id == current_user_id:
            return _to_owner_view(row, photos)
        return _to_public_view(row, photos)

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

        row = BookRow(book=row.book, location=new_location, public_location=new_public_location)
        return _to_owner_view(row)

    async def delete_book(self, book_id: uuid.UUID, owner_id: uuid.UUID) -> None:
        row = await self.repo.get_active_by_id(book_id)
        if row is None or row.book.owner_id != owner_id:
            raise BookError("Book not found", 404)

        if await self.exchanges_repo.has_active_request_for_book(book_id):
            raise BookError("EXCHANGE_ACTIVE", 409)

        # Delete photos from S3
        photos = await self.repo.get_photos(book_id)
        for photo in photos:
            await s3_delete_photo(photo.url)
            await self.repo.delete_photo(photo)

        await self.repo.soft_delete(row.book)
        await self.session.commit()

    async def upload_photo(
        self, book_id: uuid.UUID, owner_id: uuid.UUID, file_bytes: bytes, content_type: str
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

        # Validate max 3 photos
        count = await self.repo.count_photos(book_id)
        if count >= 3:
            raise BookError("MAX_PHOTOS_REACHED", 400)

        # Upload to S3
        url = await s3_upload_photo(book_id, file_bytes, content_type)

        # Position = next available slot
        photos = await self.repo.get_photos(book_id)
        position = len(photos)

        # Save to DB
        photo = await self.repo.add_photo(book_id, url, position)
        await self.session.commit()

        return PhotoView(id=photo.id, url=photo.url, position=photo.position)

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
        return [PhotoView(id=p.id, url=p.url, position=p.position) for p in photos]

    async def lookup_isbn(self, isbn_code: str) -> ISBNLookupResponse:
        """Look up book info by ISBN from Open Library."""
        # Clean ISBN (remove hyphens, spaces)
        clean_isbn = isbn_code.replace("-", "").replace(" ", "")

        if len(clean_isbn) not in (10, 13):
            raise BookError("INVALID_ISBN", 400)

        result = await isbn_lookup(clean_isbn)
        return ISBNLookupResponse(**result)
