"""Pydantic schemas for the notifications module."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class NotificationView(BaseModel):
    id: uuid.UUID
    type: str
    payload: dict[str, Any]
    read_at: datetime | None
    created_at: datetime


class NotificationListResponse(BaseModel):
    items: list[NotificationView]


class NotificationMarkReadRequest(BaseModel):
    notification_ids: list[uuid.UUID] = Field(min_length=1)
