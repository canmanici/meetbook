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


def encode_cursor(sort_order: int, created_at: datetime, book_id: uuid.UUID) -> str:
    raw = f"{sort_order:010d}|{created_at.isoformat()}|{str(book_id)}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def decode_cursor(cursor: str) -> tuple[int, datetime, uuid.UUID]:
    raw = base64.urlsafe_b64decode(cursor.encode()).decode()
    parts = raw.split("|", maxsplit=2)
    sort_order = int(parts[0])
    created_at = datetime.fromisoformat(parts[1])
    book_id = uuid.UUID(parts[2])
    return sort_order, created_at, book_id


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
    ) -> tuple[list[BookRow], str | None]:
        stmt = self._select_with_coords().where(
            Book.owner_id == owner_id, Book.deleted_at.is_(None)
        )
        if cursor:
            cursor_sort_order, cursor_created_at, cursor_id = decode_cursor(cursor)
            stmt = stmt.where(
                or_(
                    Book.sort_order > cursor_sort_order,
                    and_(
                        Book.sort_order == cursor_sort_order,
                        Book.created_at < cursor_created_at,
                    ),
                    and_(
                        Book.sort_order == cursor_sort_order,
                        Book.created_at == cursor_created_at,
                        Book.id < cursor_id,
                    ),
                )
            )
        stmt = stmt.order_by(Book.sort_order.asc(), Book.created_at.desc(), Book.id.desc()).limit(limit)
        result = await self.session.execute(stmt)
        items = [self._to_row(row) for row in result.all()]
        if len(items) == limit:
            next_cursor = encode_cursor(items[-1].book.sort_order, items[-1].book.created_at, items[-1].book.id)
        else:
            next_cursor = None
        return items, next_cursor

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
            cursor_sort_order, cursor_created_at, cursor_id = decode_cursor(cursor)
            stmt = stmt.where(
                or_(
                    Book.sort_order > cursor_sort_order,
                    and_(
                        Book.sort_order == cursor_sort_order,
                        Book.created_at < cursor_created_at,
                    ),
                    and_(
                        Book.sort_order == cursor_sort_order,
                        Book.created_at == cursor_created_at,
                        Book.id < cursor_id,
                    ),
                )
            )
        stmt = stmt.order_by(Book.sort_order.asc(), Book.created_at.desc(), Book.id.desc()).limit(limit)
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
            cursor_sort_order, cursor_created_at, cursor_id = decode_cursor(cursor)
            stmt = stmt.where(
                or_(
                    Book.sort_order > cursor_sort_order,
                    and_(
                        Book.sort_order == cursor_sort_order,
                        Book.created_at < cursor_created_at,
                    ),
                    and_(
                        Book.sort_order == cursor_sort_order,
                        Book.created_at == cursor_created_at,
                        Book.id < cursor_id,
                    ),
                )
            )

        stmt = stmt.order_by(distance_col, Book.sort_order.asc(), Book.created_at.desc(), Book.id.desc()).limit(limit)
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
        current_user_id: uuid.UUID | None = None,
    ) -> list[BookSearchRow]:
        pub = cast(Book.public_location, Geometry)
        envelope = func.ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
        center_lat = (min_lat + max_lat) / 2
        center_lng = (min_lng + max_lng) / 2
        center_wkt = f"SRID=4326;POINT({center_lng} {center_lat})"

        distance_col = func.ST_Distance(
            Book.public_location, func.ST_GeogFromText(center_wkt)
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

        stmt = (
            select(
                Book,
                func.ST_Y(pub).label("public_lat"),
                func.ST_X(pub).label("public_lng"),
                distance_col,
                User.id.label("owner_id"),
                User.name.label("owner_name"),
                owner_book_count,
                owner_rating_avg,
                owner_rating_count,
            )
            .join(User, User.id == Book.owner_id)
            .where(
                Book.deleted_at.is_(None),
                Book.is_available.is_(True),
                func.ST_Within(cast(Book.public_location, Geometry), envelope),
            )
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
            cursor_sort_order, cursor_created_at, cursor_id = decode_cursor(cursor)
            stmt = stmt.where(
                or_(
                    Book.sort_order > cursor_sort_order,
                    and_(
                        Book.sort_order == cursor_sort_order,
                        Book.created_at < cursor_created_at,
                    ),
                    and_(
                        Book.sort_order == cursor_sort_order,
                        Book.created_at == cursor_created_at,
                        Book.id < cursor_id,
                    ),
                )
            )

        stmt = stmt.order_by(distance_col, Book.sort_order.asc(), Book.created_at.desc(), Book.id.desc()).limit(limit)
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
        current_user_id: uuid.UUID | None = None,
    ) -> tuple[list[dict], list[BookSearchRow]]:
        """Return (clusters, singletons)."""
        pub = cast(Book.public_location, Geometry)
        envelope = func.ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)

        base_filters = [
            Book.deleted_at.is_(None),
            Book.is_available.is_(True),
            func.ST_Within(pub, envelope),
        ]
        if category:
            base_filters.append(Book.category == category)
        if language:
            base_filters.append(Book.language == language)
        if condition:
            base_filters.append(Book.condition == condition)
        if q:
            pattern = f"%{q}%"
            base_filters.append(or_(Book.title.ilike(pattern), Book.author.ilike(pattern)))

        block_filter = None
        if current_user_id is not None:
            block_filter = ~exists(
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

        # Owner summary aggregates (same correlated-subquery pattern as search/search_bbox)
        owner_book_count = (
            select(func.count())
            .select_from(Book)
            .where(Book.owner_id == User.id, Book.deleted_at.is_(None))
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

        # Distance from the viewport center (consistent with search_bbox).
        center_lat = (min_lat + max_lat) / 2
        center_lng = (min_lng + max_lng) / 2
        center_wkt = f"SRID=4326;POINT({center_lng} {center_lat})"
        distance_col = func.ST_Distance(
            Book.public_location, func.ST_GeogFromText(center_wkt)
        ).label("distance_m")

        # Use ST_ClusterDBSCAN to assign cluster IDs (30m epsilon, min 1 point so
        # isolated books each get their own id and are emitted as singletons).
        # Project to 3857 (Web Mercator, meters) so eps=30 is 30 meters, not 30 degrees
        pub_merc = func.ST_Transform(pub, 3857)
        cluster_expr = func.ST_ClusterDBSCAN(pub_merc, 30, 1).over().label("cluster_id")
        stmt = (
            select(
                Book,
                cluster_expr,
                func.ST_Y(pub).label("lat"),
                func.ST_X(pub).label("lng"),
                distance_col,
                User.id.label("owner_id"),
                User.name.label("owner_name"),
                owner_book_count,
                owner_rating_avg,
                owner_rating_count,
            )
            .join(User, User.id == Book.owner_id)
            .where(*base_filters)
        )
        if block_filter is not None:
            stmt = stmt.where(block_filter)
        result = await self.session.execute(stmt)

        groups: dict[int, list] = {}
        for row in result.all():
            cid = row.cluster_id
            owner = OwnerSummary(
                id=row.owner_id,
                name=row.owner_name,
                book_count=row.owner_book_count or 0,
                rating_avg=float(row.owner_rating_avg) if row.owner_rating_avg else None,
                rating_count=row.owner_rating_count or 0,
            )
            groups.setdefault(cid, []).append(
                (row[0], (row.lat, row.lng), row.distance_m, owner)
            )

        clusters = []
        singletons = []
        for cid, items in groups.items():
            if len(items) == 1:
                book, loc = items[0]
                owner_row = await self.session.execute(
                    select(User.id, User.name).where(User.id == book.owner_id)
                )
                u = owner_row.one()
                singletons.append(
                    BookSearchRow(
                        book=book,
                        public_location=loc,
                        distance_m=0.0,
                        owner=OwnerSummary(
                            id=u.id,
                            name=u.name,
                            book_count=0,
                            rating_avg=None,
                            rating_count=0,
                        ),
                    )
                )
            else:
                lats = [loc[0] for _, loc in items]
                lngs = [loc[1] for _, loc in items]
                centroid = (sum(lats) / len(lats), sum(lngs) / len(lngs))
                book_ids = [b.id for b, _ in items]
                categories = list(
                    set(
                        b.category.value if hasattr(b.category, "value") else b.category
                        for b, _ in items
                    )
                )
                front_book = items[0][0]
                clusters.append(
                    {
                        "centroid": centroid,
                        "book_ids": book_ids,
                        "count": len(items),
                        "front_cover_url": None,
                        "front_thumbnail_url": None,
                        "front_title": front_book.title,
                        "categories": categories,
                        "front_book_id": front_book.id,
                    }
                )

        return clusters[:limit], singletons[:limit]

    async def update(self, book: Book, fields: dict[str, Any]) -> None:
        for key, value in fields.items():
            setattr(book, key, value)
        book.updated_at = datetime.now(UTC)

    async def soft_delete(self, book: Book) -> None:
        book.deleted_at = datetime.now(UTC)

    async def get_books_by_ids(self, book_ids: list[uuid.UUID]) -> list[Book]:
        stmt = select(Book).where(Book.id.in_(book_ids))
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

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
