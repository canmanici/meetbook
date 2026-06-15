"""Pydantic schemas for the exchanges module."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.modules.books.models import BookCategory, BookCondition
from app.modules.books.schemas import LocationOutput, PhotoView
from app.modules.exchanges.models import ExchangeStatus, MeetupValidationStatus
from app.modules.places.schemas import PlaceSummary

# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class ExchangeCreateRequest(BaseModel):
    book_id: uuid.UUID
    initial_message: str = Field(min_length=1, max_length=1000)


class BlockCreateRequest(BaseModel):
    user_id: uuid.UUID


class MeetupOffer(BaseModel):
    place_id: str | None = None
    place_name: str = Field(min_length=1, max_length=255)
    address: str | None = None
    category: str | None = None
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    scheduled_at: datetime


class MeetupProposeRequest(BaseModel):
    offers: list[MeetupOffer] = Field(min_length=1, max_length=5)
    acknowledge_warning: bool = False


class MeetupAcceptRequest(BaseModel):
    offer_index: int = Field(ge=0, le=4, default=0)
    acknowledge_warning: bool = False


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class CounterpartView(BaseModel):
    id: uuid.UUID
    name: str


class BookSummary(BaseModel):
    """Minimal book view embedded in exchange responses — never includes true location."""

    id: uuid.UUID
    title: str
    author: str | None
    category: BookCategory
    condition: BookCondition
    is_available: bool
    public_location: LocationOutput
    photos: list[PhotoView] = []


class ExchangeSummary(BaseModel):
    id: uuid.UUID
    book: BookSummary
    counterpart: CounterpartView
    status: ExchangeStatus
    created_at: datetime
    updated_at: datetime


class ExchangeListResponse(BaseModel):
    items: list[ExchangeSummary]
    next_cursor: str | None = None


class MeetupOfferView(MeetupOffer):
    validation_status: MeetupValidationStatus


class MeetupDetail(BaseModel):
    id: uuid.UUID
    place_id: str | None
    place_name: str
    address: str | None
    category: str | None
    lat: float
    lng: float
    validation_status: MeetupValidationStatus
    scheduled_at: datetime
    proposed_by: uuid.UUID
    proposer_acknowledged: bool
    other_acknowledged: bool
    requires_acknowledgment: bool
    can_confirm: bool
    offers: list[MeetupOfferView]
    created_at: datetime
    updated_at: datetime


class ExchangeDetail(BaseModel):
    id: uuid.UUID
    book: BookSummary
    counterpart: CounterpartView
    requested_by: uuid.UUID
    requested_to: uuid.UUID
    status: ExchangeStatus
    initial_message: str
    completion_marked_by: uuid.UUID | None
    meetup: MeetupDetail | None = None
    created_at: datetime
    updated_at: datetime
    expires_at: datetime


class MeetupSuggestionsResponse(BaseModel):
    items: list[PlaceSummary]


class BlockedUserView(BaseModel):
    user_id: uuid.UUID
    created_at: datetime


class BlockListResponse(BaseModel):
    items: list[BlockedUserView]
