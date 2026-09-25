"""Pydantic schemas for the wishlist module."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class WishlistItemCreateRequest(BaseModel):
    isbn: str | None = Field(default=None, min_length=1, max_length=20)
    title: str | None = Field(default=None, min_length=1, max_length=200)
    author: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _isbn_or_title(self) -> "WishlistItemCreateRequest":
        if not self.isbn and not (self.title and self.title.strip()):
            raise ValueError("isbn or title is required")
        return self


class WishlistItemView(BaseModel):
    id: uuid.UUID
    isbn: str | None
    title: str | None
    author: str | None
    notes: str | None
    created_at: datetime


class WishlistItemDeleteRequest(BaseModel):
    item_id: uuid.UUID


class WishlistListResponse(BaseModel):
    items: list[WishlistItemView]


class WishlistMatchView(BaseModel):
    id: uuid.UUID
    title: str
    author: str | None
    isbn: str
    condition: str
    distance_km: float
    photos: list[dict] = []
    created_at: datetime


class WishlistMatchResponse(BaseModel):
    matches: list[WishlistMatchView]


class SharedWishlistCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class SharedWishlistItemCreate(BaseModel):
    isbn: str | None = Field(default=None, max_length=20)
    title: str = Field(min_length=1, max_length=200)
    author: str | None = Field(default=None, max_length=200)


class SharedWishlistItemView(BaseModel):
    id: uuid.UUID
    wishlist_id: uuid.UUID
    added_by: uuid.UUID
    added_by_name: str
    isbn: str | None
    title: str
    author: str | None
    created_at: datetime


class SharedWishlistMemberView(BaseModel):
    user_id: uuid.UUID
    name: str
    is_owner: bool
    joined_at: datetime


class SharedWishlistMemberAdd(BaseModel):
    email: str = Field(min_length=3, max_length=255)


class SharedWishlistView(BaseModel):
    id: uuid.UUID
    name: str
    owner_id: uuid.UUID
    owner_name: str
    created_at: datetime
    members: list[SharedWishlistMemberView]
    items: list[SharedWishlistItemView]


class SharedWishlistListResponse(BaseModel):
    items: list[SharedWishlistView]
