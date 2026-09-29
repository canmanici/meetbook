"""Pydantic schemas for the books module."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.core.content_policy import normalize_course_code
from app.modules.books.models import BookCategory, BookCondition


def _course_code(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    return normalize_course_code(value)


def _instructor(value: str | None) -> str | None:
    if value is None:
        return None
    return " ".join(value.split()) or None


# ---------------------------------------------------------------------------
# Shared
# ---------------------------------------------------------------------------


class LocationInput(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class LocationOutput(BaseModel):
    lat: float
    lng: float


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class BookCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    author: str | None = Field(default=None, max_length=200)
    isbn: str | None = Field(default=None, max_length=20)
    cover_url: str | None = Field(default=None, max_length=500)
    description: str | None = Field(default=None, max_length=2000)
    category: BookCategory
    language: str = Field(default="tr", min_length=2, max_length=10)
    condition: BookCondition
    location: LocationInput
    course_code: str | None = Field(default=None, max_length=20)
    instructor: str | None = Field(default=None, max_length=100)

    @field_validator("course_code")
    @classmethod
    def _norm_course(cls, value: str | None) -> str | None:
        return _course_code(value)

    @field_validator("instructor")
    @classmethod
    def _norm_instructor(cls, value: str | None) -> str | None:
        return _instructor(value)


class BookUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    author: str | None = Field(default=None, max_length=200)
    isbn: str | None = Field(default=None, max_length=20)
    description: str | None = Field(default=None, max_length=2000)
    category: BookCategory | None = None
    language: str | None = Field(default=None, min_length=2, max_length=10)
    condition: BookCondition | None = None
    is_available: bool | None = None
    location: LocationInput | None = None
    course_code: str | None = Field(default=None, max_length=20)
    instructor: str | None = Field(default=None, max_length=100)

    @field_validator("course_code")
    @classmethod
    def _norm_course(cls, value: str | None) -> str | None:
        return _course_code(value)

    @field_validator("instructor")
    @classmethod
    def _norm_instructor(cls, value: str | None) -> str | None:
        return _instructor(value)


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class PhotoView(BaseModel):
    id: uuid.UUID
    url: str
    thumbnail_url: str | None = None
    position: int


class BookOwnerView(BaseModel):
    """Full view, returned only to the book's owner — includes the true location."""

    id: uuid.UUID
    owner_id: uuid.UUID
    owner_name: str
    title: str
    author: str | None
    isbn: str | None
    description: str | None
    course_code: str | None = None
    instructor: str | None = None
    category: BookCategory
    language: str
    condition: BookCondition
    is_available: bool
    location: LocationOutput
    public_location: LocationOutput
    photos: list[PhotoView] = []
    view_count: int = 0
    favorite_count: int = 0
    is_favorited: bool = False
    sort_order: int = 0
    created_at: datetime
    updated_at: datetime


class BookPublicView(BaseModel):
    """Returned to non-owners. `location` is structurally absent — never serialized."""

    id: uuid.UUID
    owner_id: uuid.UUID
    owner_name: str
    title: str
    author: str | None
    isbn: str | None
    description: str | None
    course_code: str | None = None
    instructor: str | None = None
    category: BookCategory
    language: str
    condition: BookCondition
    is_available: bool
    public_location: LocationOutput
    photos: list[PhotoView] = []
    view_count: int = 0
    favorite_count: int = 0
    is_favorited: bool = False
    created_at: datetime
    updated_at: datetime


class BookListResponse(BaseModel):
    items: list[BookOwnerView | BookPublicView]
    next_cursor: str | None = None


class PhotoReorderRequest(BaseModel):
    photo_ids: list[uuid.UUID]


class BookSearchParams(BaseModel):
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    radius_km: float = Field(default=10.0, ge=0.1, le=200.0)
    category: BookCategory | None = None
    language: str | None = None
    condition: BookCondition | None = None
    q: str | None = Field(default=None, max_length=100)
    owner_id: uuid.UUID | None = None
    course: str | None = None  # normalized course code


class OwnerSummary(BaseModel):
    id: uuid.UUID
    name: str
    book_count: int
    rating_avg: float | None = None
    rating_count: int = 0


class BookSearchResult(BaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    owner_name: str
    title: str
    author: str | None
    isbn: str | None
    description: str | None
    course_code: str | None = None
    instructor: str | None = None
    category: BookCategory
    language: str
    condition: BookCondition
    is_available: bool
    public_location: LocationOutput
    distance_km: float
    owner: OwnerSummary
    photos: list[PhotoView] = []
    created_at: datetime
    updated_at: datetime


class ClusterPoint(BaseModel):
    centroid: LocationOutput
    book_ids: list[uuid.UUID]
    count: int
    front_cover_url: str | None = None
    front_thumbnail_url: str | None = None
    front_title: str
    categories: list[str]
    # Member books, so a shelf can be opened/spiderfied without them having
    # to appear in the (limited, possibly differently-scoped) list query.
    books: list["BookSearchResult"] = []


class ClusterResponse(BaseModel):
    clusters: list[ClusterPoint]
    singletons: list[BookSearchResult]


class BookSearchResponse(BaseModel):
    items: list[BookSearchResult]
    next_cursor: str | None = None


class ISBNLookupResponse(BaseModel):
    isbn: str
    title: str | None = None
    author: str | None = None
    description: str | None = None
    cover_url: str | None = None
    page_count: int | None = None
    published_year: int | None = None


class ReorderDelta(BaseModel):
    book_id: uuid.UUID
    sort_order: int


class ReorderBody(BaseModel):
    reorders: list[ReorderDelta]


class FailedBookCreate(BaseModel):
    index: int
    error: str


class BookBulkCreateRequest(BaseModel):
    books: list[BookCreateRequest] = Field(min_length=1, max_length=50)


class BookBulkCreateResponse(BaseModel):
    items: list[BookOwnerView]
    failed: list[FailedBookCreate] = []


# ---------------------------------------------------------------------------
# B19 — Smart relisting
# ---------------------------------------------------------------------------


class StaleBookView(BookOwnerView):
    """An owner's book that has had no activity (views, edits, favorites) for
    an extended period. `view_count` is inherited from BookOwnerView; the
    extra fields let the UI surface how dormant the listing is.
    """

    days_since_update: int = 0
    last_activity: datetime


class StaleBooksResponse(BaseModel):
    items: list[StaleBookView]
    days_threshold: int = 30


class CourseSummary(BaseModel):
    course_code: str
    book_count: int  # available copies
    instructors: list[str] = []


class CourseListResponse(BaseModel):
    items: list[CourseSummary]
