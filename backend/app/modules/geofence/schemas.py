"""Geofence Pydantic schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel


class GeofenceAlertView(BaseModel):
    id: uuid.UUID
    wishlist_item_id: uuid.UUID
    book_id: uuid.UUID
    created_at: datetime
    read_at: datetime | None = None


class GeofenceAlertListResponse(BaseModel):
    items: list[GeofenceAlertView]
