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
from sqlalchemy import Select, and_, cast, delete, exists, func, or_, select, update, ColumnElement
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.content_policy import normalize_course_code
from app.modules.auth.models import User
from app.modules.books.models import Book, BookFavorite, BookPhoto
from app.modules.books.schemas import OwnerSummary
from app.modules.exchanges.models import Block
from app.modules.ratings.models import Rating


# Turkish-aware, accent-insensitive text matching. Postgres' ILIKE (en_US
# collation) does not fold ı/İ against I/i, so "ırmak" never matched "IRMAK";
# users also routinely type "seker" for "şeker". Fold both sides the same way.
_TR_FROM = "ıİşŞçÇöÖüÜğĞ"
_TR_TO = "iissccoouugg"
_TR_TABLE = str.maketrans(_TR_FROM, _TR_TO)


def _text_match(q: str) -> ColumnElement[bool]:
    """title/author contains q — LIKE wildcards escaped, Turkish folded."""
    folded = q.translate(_TR_TABLE)
    escaped = folded.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{escaped}%"
    return or_(
        func.translate(Book.title, _TR_FROM, _TR_TO).ilike(pattern, escape="\\"),
        func.translate(func.coalesce(Book.author, ""), _TR_FROM, _TR_TO).ilike(
            pattern, escape="\\"
        ),
    )


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


# Two-field (created_at, id) cursor used by chat messages and exchanges,
# which have no sort_order dimension.
def encode_ts_cursor(created_at: datetime, item_id: uuid.UUID) -> str:
    raw = f"{created_at.isoformat()}|{str(item_id)}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def decode_ts_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    raw = base64.urlsafe_b64decode(cursor.encode()).decode()
    parts = raw.split("|", maxsplit=1)
    return datetime.fromisoformat(parts[0]), uuid.UUID(parts[1])


class BookRepository:
    MAX_CLUSTER_ROWS = 1000

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
        stmt = self._select_with_coords().where(Book.id == book_id, Book.deleted_at.is_(None))
        result = await self.session.execute(stmt)
        row = result.one_or_none()
        return self._to_row(row) if row is not None else None

    async def get_by_id(self, book_id: uuid.UUID) -> BookRow | None:
        """Fetch a book regardless of soft-delete status (e.g. for exchange history)."""
        stmt = self._select_with_coords().where(Book.id == book_id)
        result = await self.session.execute(stmt)
        row = result.one_or_none()
        return self._to_row(row) if row is not None else None

    async def get_by_ids(self, book_ids: list[uuid.UUID]) -> dict[uuid.UUID, BookRow]:
        """Batch form of ``get_by_id`` (soft-deleted included) — one query."""
        if not book_ids:
            return {}
        stmt = self._select_with_coords().where(Book.id.in_(set(book_ids)))
        result = await self.session.execute(stmt)
        rows = (self._to_row(row) for row in result.all())
        return {r.book.id: r for r in rows}

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
        stmt = stmt.order_by(Book.sort_order.asc(), Book.created_at.desc(), Book.id.desc()).limit(
            limit
        )
        result = await self.session.execute(stmt)
        items = [self._to_row(row) for row in result.all()]
        if len(items) == limit:
            next_cursor = encode_cursor(
                items[-1].book.sort_order, items[-1].book.created_at, items[-1].book.id
            )
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
        stmt = stmt.order_by(Book.sort_order.asc(), Book.created_at.desc(), Book.id.desc()).limit(
            limit
        )
        result = await self.session.execute(stmt)
        return [self._to_row(row) for row in result.all()]

    async def search_nearby(
        self,
        user_lat: float | None,
        user_lng: float | None,
        radius_m: float,
        category: str | None,
        language: str | None,
        condition: str | None,
        q: str | None,
        cursor: str | None,
        limit: int,
        current_user_id: uuid.UUID | None = None,
        owner_id: uuid.UUID | None = None,
    ) -> list[BookSearchRow]:
        pub = cast(Book.public_location, Geometry)

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

        select_cols: list[Any] = [
            Book,
            func.ST_Y(pub).label("public_lat"),
            func.ST_X(pub).label("public_lng"),
            User.id.label("owner_id"),
            User.name.label("owner_name"),
            owner_book_count,
            owner_rating_avg,
            owner_rating_count,
        ]

        conditions: list[ColumnElement[bool]] = [
            Book.deleted_at.is_(None),
            Book.is_available.is_(True),
        ]

        if user_lat is not None and user_lng is not None:
            user_wkt = f"SRID=4326;POINT({user_lng} {user_lat})"
            distance_col = func.ST_Distance(
                Book.public_location, func.ST_GeogFromText(user_wkt)
            ).label("distance_m")
            select_cols.append(distance_col)
            conditions.append(
                func.ST_DWithin(
                    Book.public_location,
                    func.ST_GeogFromText(user_wkt),
                    radius_m,
                )
            )
        else:
            distance_col = None

        if owner_id is not None:
            conditions.append(Book.owner_id == owner_id)

        if category:
            conditions.append(Book.category == category)
        if language:
            conditions.append(Book.language == language)
        if condition:
            conditions.append(Book.condition == condition)
        if q:
            conditions.append(_text_match(q))

        if current_user_id is not None:
            conditions.append(
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
            conditions.append(
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

        stmt = select(*select_cols).join(User, User.id == Book.owner_id).where(*conditions)

        if distance_col is not None:
            stmt = stmt.order_by(
                distance_col, Book.sort_order.asc(), Book.created_at.desc(), Book.id.desc()
            )
        else:
            stmt = stmt.order_by(Book.sort_order.asc(), Book.created_at.desc(), Book.id.desc())

        stmt = stmt.limit(limit)
        result = await self.session.execute(stmt)

        rows = []
        for row in result.all():
            rows.append(
                BookSearchRow(
                    book=row[0],
                    public_location=(row.public_lat, row.public_lng),
                    distance_m=row.distance_m if distance_col is not None else 0.0,
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
        cursor: str | None = None,
        origin: tuple[float, float] | None = None,
    ) -> list[BookSearchRow]:
        pub = cast(Book.public_location, Geometry)
        envelope = func.ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
        # Distances are "from the user" when the client sends its position —
        # the viewport center is only a fallback (it's not where anyone is).
        center_lat, center_lng = origin or ((min_lat + max_lat) / 2, (min_lng + max_lng) / 2)
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
            stmt = stmt.where(_text_match(q))

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

        stmt = stmt.order_by(
            distance_col, Book.sort_order.asc(), Book.created_at.desc(), Book.id.desc()
        ).limit(limit)
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
        origin: tuple[float, float] | None = None,
    ) -> tuple[list[dict[str, Any]], list[BookSearchRow]]:
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
            base_filters.append(_text_match(q))

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

        # Distance from the user when known, else the viewport center
        # (consistent with search_bbox).
        center_lat, center_lng = origin or ((min_lat + max_lat) / 2, (min_lng + max_lng) / 2)
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
        # Bound the DBSCAN input: the window function runs over every matching
        # row before any LIMIT, so a dense viewport clustered everything.
        capped_ids = select(Book.id).where(*base_filters)
        if block_filter is not None:
            capped_ids = capped_ids.where(block_filter)
        capped_ids = capped_ids.order_by(
            func.ST_Distance(Book.public_location, func.ST_GeogFromText(center_wkt))
        ).limit(self.MAX_CLUSTER_ROWS)
        stmt = stmt.where(Book.id.in_(capped_ids.scalar_subquery()))
        if block_filter is not None:
            stmt = stmt.where(block_filter)
        result = await self.session.execute(stmt)

        groups: dict[int, list[Any]] = {}
        for row in result.all():
            cid = row.cluster_id
            owner = OwnerSummary(
                id=row.owner_id,
                name=row.owner_name,
                book_count=row.owner_book_count or 0,
                rating_avg=float(row.owner_rating_avg) if row.owner_rating_avg else None,
                rating_count=row.owner_rating_count or 0,
            )
            groups.setdefault(cid, []).append((row[0], (row.lat, row.lng), row.distance_m, owner))

        clusters = []
        singletons = []
        for cid, items in groups.items():
            if len(items) == 1:
                book, loc, distance_m, owner = items[0]
                singletons.append(
                    BookSearchRow(
                        book=book,
                        public_location=loc,
                        distance_m=distance_m,
                        owner=owner,
                    )
                )
            else:
                lats = [loc[0] for _, loc, _, _ in items]
                lngs = [loc[1] for _, loc, _, _ in items]
                centroid = (sum(lats) / len(lats), sum(lngs) / len(lngs))
                book_ids = [b.id for b, _, _, _ in items]
                categories = list(
                    set(
                        b.category.value if hasattr(b.category, "value") else b.category
                        for b, _, _, _ in items
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
                        # Full member rows so the client can open/spiderfy
                        # a shelf without the books being in its list query.
                        "rows": [
                            BookSearchRow(book=b, public_location=loc, distance_m=d, owner=o)
                            for b, loc, d, o in items
                        ],
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
            .values(view_count=func.coalesce(Book.view_count, 0) + 1, updated_at=func.now())
        )
        await self.session.execute(stmt)

    # -----------------------------------------------------------------------
    # Favorites
    # -----------------------------------------------------------------------

    async def add_favorite(self, user_id: uuid.UUID, book_id: uuid.UUID) -> bool:
        """Add a favorite. Returns False if already exists.

        One atomic INSERT ... ON CONFLICT: a check-then-insert let two
        concurrent taps both pass the check, and the second insert hit
        uq_user_book_favorite -> HTTP 500.
        """
        inserted = await self.session.execute(
            pg_insert(BookFavorite)
            .values(id=uuid.uuid7(), user_id=user_id, book_id=book_id)
            .on_conflict_do_nothing(index_elements=["user_id", "book_id"])
            .returning(BookFavorite.id)
        )
        if inserted.scalar_one_or_none() is None:
            return False
        await self.session.execute(
            update(Book)
            .where(Book.id == book_id)
            .values(favorite_count=func.coalesce(Book.favorite_count, 0) + 1, updated_at=func.now())
        )
        return True

    async def remove_favorite(self, user_id: uuid.UUID, book_id: uuid.UUID) -> bool:
        """Remove a favorite. Returns False if it didn't exist.

        DELETE ... RETURNING: only the request that actually removed the row
        decrements the counter (concurrent removes used to raise StaleDataError
        or double-decrement).
        """
        deleted = await self.session.execute(
            delete(BookFavorite)
            .where(BookFavorite.user_id == user_id, BookFavorite.book_id == book_id)
            .returning(BookFavorite.id)
        )
        if deleted.scalar_one_or_none() is None:
            return False
        await self.session.execute(
            update(Book)
            .where(Book.id == book_id, Book.favorite_count > 0)
            .values(favorite_count=func.coalesce(Book.favorite_count, 0) - 1, updated_at=func.now())
        )
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
        stmt = select(BookPhoto).where(BookPhoto.book_id == book_id).order_by(BookPhoto.position)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_photos_batch(self, book_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[BookPhoto]]:
        """All photos for many books, ordered by position — one query."""
        out: dict[uuid.UUID, list[BookPhoto]] = {}
        if not book_ids:
            return out
        stmt = (
            select(BookPhoto)
            .where(BookPhoto.book_id.in_(set(book_ids)))
            .order_by(BookPhoto.book_id, BookPhoto.position)
        )
        for p in (await self.session.execute(stmt)).scalars().all():
            out.setdefault(p.book_id, []).append(p)
        return out

    async def get_first_photos_batch(self, book_ids: list[uuid.UUID]) -> dict[uuid.UUID, BookPhoto]:
        """Return the first photo (position 0) for each book in a single query."""
        if not book_ids:
            return {}
        stmt = select(BookPhoto).where(BookPhoto.book_id.in_(book_ids), BookPhoto.position == 0)
        result = await self.session.execute(stmt)
        return {p.book_id: p for p in result.scalars().all()}

    async def add_photo(
        self, book_id: uuid.UUID, url: str, position: int, thumbnail_url: str | None = None
    ) -> BookPhoto:
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
            stmt = select(BookPhoto).where(BookPhoto.id == photo_id, BookPhoto.book_id == book_id)
            result = await self.session.execute(stmt)
            photo = result.scalar_one_or_none()
            if photo:
                photo.position = idx

    async def list_available_by_title(self, title: str) -> list[BookRow]:
        """Case-insensitive exact title match (wishlist entries without ISBN)."""
        stmt = (
            self._select_with_coords()
            .where(
                Book.deleted_at.is_(None),
                Book.is_available.is_(True),
                func.lower(func.trim(Book.title)) == title.strip().lower(),
            )
            .limit(10)
        )
        result = await self.session.execute(stmt)
        return [self._to_row(row) for row in result.all()]

    async def list_available_by_isbn(self, isbn: str) -> list[BookRow]:
        stmt = (
            self._select_with_coords()
            .where(
                Book.deleted_at.is_(None),
                Book.is_available.is_(True),
                Book.isbn == isbn,
            )
            .limit(10)
        )
        result = await self.session.execute(stmt)
        return [self._to_row(row) for row in result.all()]
