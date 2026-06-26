"""Pydantic schemas for saved searches."""
import uuid
from datetime import datetime
from pydantic import BaseModel, Field


class SavedSearchCreate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    params: dict = Field(default_factory=dict)


class SavedSearchUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    params: dict | None = None


class SavedSearchView(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    name: str | None
    params: dict
    created_at: datetime
    updated_at: datetime


class SavedSearchListResponse(BaseModel):
    items: list[SavedSearchView]
