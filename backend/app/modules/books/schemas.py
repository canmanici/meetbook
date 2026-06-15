"""Pydantic schemas for the books module."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.modules.books.models import BookCategory, BookCondition

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
    description: str | None = Field(default=None, max_length=2000)
    category: BookCategory
    language: str = Field(default="tr", min_length=2, max_length=10)
    condition: BookCondition
    location: LocationInput


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
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    radius_km: float = Field(default=10.0, ge=0.1, le=100.0)
    category: BookCategory | None = None
    language: str | None = None
    condition: BookCondition | None = None
    q: str | None = Field(default=None, max_length=100)


class BookSearchResult(BaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    owner_name: str
    title: str
    author: str | None
    isbn: str | None
    description: str | None
    category: BookCategory
    language: str
    condition: BookCondition
    is_available: bool
    public_location: LocationOutput
    distance_km: float
    photos: list[PhotoView] = []
    created_at: datetime
    updated_at: datetime


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
