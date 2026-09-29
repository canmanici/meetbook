"""Pydantic schemas for the exchanges module."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, model_validator

from app.modules.books.models import BookCategory, BookCondition
from app.modules.books.schemas import LocationOutput, PhotoView
from app.modules.exchanges.models import (
    ExchangeMode,
    ExchangeStatus,
    ExtensionStatus,
    MeetupValidationStatus,
    ReadingBuddyStatus,
)
from app.modules.places.schemas import PlaceSummary

# Allowed loan durations (days): the three quick buttons plus a 1-90 manual range.
QUICK_LOAN_DURATIONS = (7, 15, 30)
MIN_LOAN_DAYS = 1
MAX_LOAN_DAYS = 90

# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class ExchangeCreateRequest(BaseModel):
    book_id: uuid.UUID
    initial_message: str = Field(min_length=1, max_length=1000)
    mode: ExchangeMode = ExchangeMode.trade
    loan_duration_days: int | None = Field(default=None, ge=MIN_LOAN_DAYS, le=MAX_LOAN_DAYS)

    @model_validator(mode="after")
    def _check_loan_duration(self) -> "ExchangeCreateRequest":
        if self.mode is ExchangeMode.borrow:
            if self.loan_duration_days is None:
                raise ValueError("loan_duration_days is required for borrow mode")
        else:
            # Ignore any duration sent for trade mode.
            self.loan_duration_days = None
        return self


class LendRequest(BaseModel):
    photo_url: str = Field(min_length=1, max_length=2000)


class ReturnRequest(BaseModel):
    photo_url: str = Field(min_length=1, max_length=2000)


class ExtensionRequestBody(BaseModel):
    days: int = Field(ge=MIN_LOAN_DAYS, le=MAX_LOAN_DAYS)


class LocationUpdateRequest(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    precision: str = Field(default="exact", pattern="^(exact|approximate)$")


class LocationResponse(BaseModel):
    latitude: float
    longitude: float
    updated_at: datetime
    precision: str = "exact"


class LocationStatusResponse(BaseModel):
    """Sharing state for both participants — the client's single source of truth."""

    me_sharing: bool
    partner_sharing: bool
    partner_location: LocationResponse | None = None


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


class ReadingBuddyRequest(BaseModel):
    pass


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class TrustView(BaseModel):
    score: int
    badge: str  # "green" | "yellow" | "red"
    label: str
    on_time_rate: float | None = None
    loans_borrowed_count: int = 0
    edu_verified: bool = False  # has a verified .edu.tr address
    teacher: bool = False  # admin-approved teacher (badge only)


class CounterpartView(BaseModel):
    id: uuid.UUID
    name: str
    avatar_url: str | None = None
    trust: TrustView | None = None


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
    mode: ExchangeMode = ExchangeMode.trade
    due_at: datetime | None = None
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


class ReadingBuddyView(BaseModel):
    id: uuid.UUID
    exchange_id: uuid.UUID
    user_id: uuid.UUID
    buddy_id: uuid.UUID
    chat_id: uuid.UUID | None = None
    book_id: uuid.UUID
    status: ReadingBuddyStatus
    created_at: datetime


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
    # Borrow-mode fields
    mode: ExchangeMode = ExchangeMode.trade
    loan_duration_days: int | None = None
    due_at: datetime | None = None
    lent_at: datetime | None = None
    lent_photo_url: str | None = None
    returned_photo_url: str | None = None
    returned_marked_by: uuid.UUID | None = None
    extension_status: ExtensionStatus = ExtensionStatus.none
    extension_requested_days: int | None = None
    # B20: book retirement flow
    retired_by: uuid.UUID | None = None
    retired_at: datetime | None = None
    # B24: reading buddy matching
    reading_buddy: ReadingBuddyView | None = None
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
