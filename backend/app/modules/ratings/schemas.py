"""Pydantic schemas for the ratings module."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class RatingCreateRequest(BaseModel):
    exchange_id: uuid.UUID
    score: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=1000)


class RatingView(BaseModel):
    id: uuid.UUID
    exchange_request_id: uuid.UUID
    rated_by: uuid.UUID
    rated_user: uuid.UUID
    score: int
    comment: str | None
    created_at: datetime


class RatingListResponse(BaseModel):
    items: list[RatingView]
    rating_average: float
    rating_count: int
