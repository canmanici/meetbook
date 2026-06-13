"""Pydantic schemas for the wishlist module."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class WishlistItemCreateRequest(BaseModel):
    isbn: str = Field(min_length=1, max_length=20)
    title: str | None = Field(default=None, max_length=200)
    author: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=500)


class WishlistItemView(BaseModel):
    id: uuid.UUID
    isbn: str
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
