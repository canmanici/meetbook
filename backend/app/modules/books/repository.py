"""Database queries for the books module.

`ST_X`/`ST_Y` need a `geometry` cast — PostGIS doesn't define them on `geography`
directly. This is the only place that cast happens.
"""

import base64
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from geoalchemy2 import Geometry
from geoalchemy2.elements import WKTElement
from sqlalchemy import Select, and_, cast, delete, exists, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User
from app.modules.books.models import Book, BookFavorite, BookPhoto
from app.modules.books.schemas import OwnerSummary
from app.modules.exchanges.models import Block
from app.modules.ratings.models import Rating


@dataclass
class BookSearchRow:
    book: Book
    public_location: tuple[float, float]
    distance_m: float
    owner: OwnerSummary


@dataclass
class BookRow:
    book: Book
    location: tuple[float, float]
    public_location: tuple[float, float]


def encode_cursor(created_at: datetime, book_id: uuid.UUID) -> str:
    raw = f"{created_at.isoformat()}|{book_id}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    raw = base64.urlsafe_b64decode(cursor.encode()).decode()
    created_at_str, id_str = raw.split("|", 1)
    return datetime.fromisoformat(created_at_str), uuid.UUID(id_str)


class BookRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    def _select_with_coords(self) -> Select[Any]:
        loc = cast(Book.location, Geometry)
        pub = cast(Book.public_location, Geometry)
        return select(
            Book,
            func.ST_Y(loc).label("lat"),
            func.ST_X(loc).label("lng"),
            func.ST_Y(pub).label("public_lat"),
            func.ST_X(pub).label("public_lng"),
        )

    def _to_row(self, row: Any) -> BookRow:
        return BookRow(
            book=row[0],
            location=(row.lat, row.lng),
            public_location=(row.public_lat, row.public_lng),
        )

    async def create(
        self,
        owner_id: uuid.UUID,
        fields: dict[str, Any],
        location: WKTElement,
        public_location: WKTElement,
    ) -> Book:
        book = Book(
            owner_id=owner_id,
            location=location,
            public_location=public_location,
            **fields,
        )
        self.session.add(book)
        await self.session.flush()
        return book

    async def get_active_by_id(self, book_id: uuid.UUID) -> BookRow | None:
        stmt = self._select_with_coords().where(
            Book.id == book_id, Book.deleted_at.is_(None)
        )
        result = await self.session.execute(stmt)
        row = result.one_or_none()
        return self._to_row(row) if row is not None else None

    async def get_by_id(self, book_id: uuid.UUID) -> BookRow | None:
        """Fetch a book regardless of soft-delete status (e.g. for exchange history)."""
        stmt = self._select_with_coords().where(Book.id == book_id)
        result = await self.session.execute(stmt)
        row = result.one_or_none()
        return self._to_row(row) if row is not None else None

    async def list_by_owner(
        self, owner_id: uuid.UUID, cursor: str | None, limit: int
    ) -> list[BookRow]:
        stmt = self._select_with_coords().where(
            Book.owner_id == owner_id, Book.deleted_at.is_(None)
        )
        if cursor:
            cursor_created_at, cursor_id = decode_cursor(cursor)
            stmt = stmt.where(
                or_(
                    Book.created_at < cursor_created_at,
                    and_(
                        Book.created_at == cursor_created_at,
                        Book.id < cursor_id,
                    ),
                )
            )
        stmt = stmt.order_by(Book.created_at.desc(), Book.id.desc()).limit(limit)
        result = await self.session.execute(stmt)
        return [self._to_row(row) for row in result.all()]

    async def list_available(
        self,
        cursor: str | None,
        limit: int,
        current_user_id: uuid.UUID | None = None,
    ) -> list[BookRow]:
        stmt = self._select_with_coords().where(
            Book.deleted_at.is_(None), Book.is_available.is_(True)
        )
        if current_user_id is not None:
            stmt = stmt.where(
                ~exists(
                    select(Block.blocker_id).where(
                        or_(
                            and_(
                                Block.blocker_id == current_user_id,
                                Block.blocked_id == Book.owner_id,
                            ),
                            and_(
                                Block.blocker_id == Book.owner_id,
                                Block.blocked_id == current_user_id,
                            ),
                        )
                    )
                )
            )
        if cursor:
            cursor_created_at, cursor_id = decode_cursor(cursor)
            stmt = stmt.where(
                or_(
                    Book.created_at < cursor_created_at,
                    and_(
                        Book.created_at == cursor_created_at,
                        Book.id < cursor_id,
                    ),
                )
            )
        stmt = stmt.order_by(Book.created_at.desc(), Book.id.desc()).limit(limit)
        result = await self.session.execute(stmt)
        return [self._to_row(row) for row in result.all()]

    async def search_nearby(
        self,
        user_lat: float,
        user_lng: float,
        radius_m: float,
        category: str | None,
        language: str | None,
        condition: str | None,
        q: str | None,
        cursor: str | None,
        limit: int,
        current_user_id: uuid.UUID | None = None,
    ) -> list[BookSearchRow]:
        pub = cast(Book.public_location, Geometry)
        user_wkt = f"SRID=4326;POINT({user_lng} {user_lat})"

        distance_col = func.ST_Distance(
            Book.public_location, func.ST_GeogFromText(user_wkt)
        ).label("distance_m")

        owner_book_count = (
            select(func.count())
            .select_from(Book)
            .where(
                Book.owner_id == User.id,
                Book.deleted_at.is_(None),
            )
            .correlate(User)
            .label("owner_book_count")
        )
        owner_rating_avg = (
            select(func.avg(Rating.score))
            .where(Rating.rated_user == User.id)
            .correlate(User)
            .label("owner_rating_avg")
        )
        owner_rating_count = (
            select(func.count())
            .select_from(Rating)
            .where(Rating.rated_user == User.id)
            .correlate(User)
            .label("owner_rating_count")
        )

        stmt = select(
            Book,
            func.ST_Y(pub).label("public_lat"),
            func.ST_X(pub).label("public_lng"),
            distance_col,
            User.id.label("owner_id"),
            User.name.label("owner_name"),
            owner_book_count,
            owner_rating_avg,
            owner_rating_count,
        ).join(User, User.id == Book.owner_id).where(
            Book.deleted_at.is_(None),
            Book.is_available.is_(True),
            func.ST_DWithin(
                Book.public_location,
                func.ST_GeogFromText(user_wkt),
                radius_m,
            ),
        )

        if category:
            stmt = stmt.where(Book.category == category)
        if language:
            stmt = stmt.where(Book.language == language)
        if condition:
            stmt = stmt.where(Book.condition == condition)
        if q:
            pattern = f"%{q}%"
            stmt = stmt.where(
                or_(Book.title.ilike(pattern), Book.author.ilike(pattern))
            )

        if current_user_id is not None:
            stmt = stmt.where(
                ~exists(
                    select(Block.blocker_id).where(
                        or_(
                            and_(
                                Block.blocker_id == current_user_id,
                                Block.blocked_id == Book.owner_id,
                            ),
                            and_(
                                Block.blocker_id == Book.owner_id,
                                Block.blocked_id == current_user_id,
                            ),
                        )
                    )
                )
            )

        if cursor:
            cursor_created_at, cursor_id = decode_cursor(cursor)
            stmt = stmt.where(
                or_(
                    Book.created_at < cursor_created_at,
                    and_(
                        Book.created_at == cursor_created_at,
                        Book.id < cursor_id,
                    ),
                )
            )

        stmt = stmt.order_by(distance_col, Book.created_at.desc(), Book.id.desc()).limit(limit)
        result = await self.session.execute(stmt)

        rows = []
        for row in result.all():
            rows.append(
                BookSearchRow(
                    book=row[0],
                    public_location=(row.public_lat, row.public_lng),
                    distance_m=row.distance_m,
                    owner=OwnerSummary(
                        id=row.owner_id,
                        name=row.owner_name,
                        book_count=row.owner_book_count or 0,
                        rating_avg=float(row.owner_rating_avg) if row.owner_rating_avg else None,
                        rating_count=row.owner_rating_count or 0,
                    ),
                )
            )
        return rows

    async def update(self, book: Book, fields: dict[str, Any]) -> None:
        for key, value in fields.items():
            setattr(book, key, value)
        book.updated_at = datetime.now(UTC)

    async def soft_delete(self, book: Book) -> None:
        book.deleted_at = datetime.now(UTC)

    # -----------------------------------------------------------------------
    # View count
    # -----------------------------------------------------------------------

    async def increment_view_count(self, book_id: uuid.UUID) -> None:
        stmt = (
            update(Book)
            .where(Book.id == book_id)
            .values(view_count=Book.view_count + 1, updated_at=datetime.now(UTC))
        )
        await self.session.execute(stmt)

    # -----------------------------------------------------------------------
    # Favorites
    # -----------------------------------------------------------------------

    async def add_favorite(self, user_id: uuid.UUID, book_id: uuid.UUID) -> bool:
        """Add a favorite. Returns False if already exists."""
        existing = await self.session.execute(
            select(BookFavorite).where(
                BookFavorite.user_id == user_id, BookFavorite.book_id == book_id
            )
        )
        if existing.scalar_one_or_none() is not None:
            return False
        fav = BookFavorite(user_id=user_id, book_id=book_id)
        self.session.add(fav)
        # Increment counter on book
        stmt = (
            update(Book)
            .where(Book.id == book_id)
            .values(favorite_count=Book.favorite_count + 1, updated_at=datetime.now(UTC))
        )
        await self.session.execute(stmt)
        await self.session.flush()
        return True

    async def remove_favorite(self, user_id: uuid.UUID, book_id: uuid.UUID) -> bool:
        """Remove a favorite. Returns False if it didn't exist."""
        existing = await self.session.execute(
            select(BookFavorite).where(
                BookFavorite.user_id == user_id, BookFavorite.book_id == book_id
            )
        )
        fav = existing.scalar_one_or_none()
        if fav is None:
            return False
        await self.session.delete(fav)
        # Decrement counter on book (floor at 0)
        stmt = (
            update(Book)
            .where(Book.id == book_id, Book.favorite_count > 0)
            .values(favorite_count=Book.favorite_count - 1, updated_at=datetime.now(UTC))
        )
        await self.session.execute(stmt)
        await self.session.flush()
        return True

    async def is_favorited(self, user_id: uuid.UUID, book_id: uuid.UUID) -> bool:
        stmt = select(BookFavorite).where(
            BookFavorite.user_id == user_id, BookFavorite.book_id == book_id
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None

    # -----------------------------------------------------------------------
    # Photos
    # -----------------------------------------------------------------------

    async def get_photos(self, book_id: uuid.UUID) -> list[BookPhoto]:
        stmt = (
            select(BookPhoto)
            .where(BookPhoto.book_id == book_id)
            .order_by(BookPhoto.position)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def add_photo(self, book_id: uuid.UUID, url: str, position: int, thumbnail_url: str | None = None) -> BookPhoto:
        photo = BookPhoto(book_id=book_id, url=url, thumbnail_url=thumbnail_url, position=position)
        self.session.add(photo)
        await self.session.flush()
        return photo

    async def delete_photo(self, photo: BookPhoto) -> None:
        await self.session.delete(photo)

    async def count_photos(self, book_id: uuid.UUID) -> int:
        stmt = select(func.count()).select_from(BookPhoto).where(BookPhoto.book_id == book_id)
        result = await self.session.execute(stmt)
        return result.scalar() or 0

    async def reorder_photos(self, book_id: uuid.UUID, photo_ids: list[uuid.UUID]) -> None:
        for idx, photo_id in enumerate(photo_ids):
            stmt = select(BookPhoto).where(
                BookPhoto.id == photo_id, BookPhoto.book_id == book_id
            )
            result = await self.session.execute(stmt)
            photo = result.scalar_one_or_none()
            if photo:
                photo.position = idx

    async def list_available_by_isbn(self, isbn: str) -> list[BookRow]:
        stmt = self._select_with_coords().where(
            Book.deleted_at.is_(None),
            Book.is_available.is_(True),
            Book.isbn == isbn,
        ).limit(10)
        result = await self.session.execute(stmt)
        return [self._to_row(row) for row in result.all()]
