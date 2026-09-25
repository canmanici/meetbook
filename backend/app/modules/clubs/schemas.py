"""Pydantic schemas for book clubs."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

MAX_CLUB_MEMBERS = 5  # including the owner


class ClubCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    member_ids: list[uuid.UUID] = Field(default_factory=list, max_length=MAX_CLUB_MEMBERS - 1)
    book_id: uuid.UUID | None = None  # the owner's own contribution (optional now)

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        return v


class ClubInviteRequest(BaseModel):
    user_id: uuid.UUID


class ClubBookRequest(BaseModel):
    book_id: uuid.UUID | None


class ClubMessageCreate(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class ClubBookView(BaseModel):
    id: uuid.UUID
    title: str
    author: str | None
    thumbnail_url: str | None


class ClubMemberView(BaseModel):
    user_id: uuid.UUID
    name: str
    username: str | None
    avatar_url: str | None
    status: str
    is_owner: bool
    book: ClubBookView | None
    receives_from_user_id: uuid.UUID | None


class ClubMessageView(BaseModel):
    id: uuid.UUID
    club_id: uuid.UUID
    sender_id: uuid.UUID | None
    sender_name: str | None
    sender_avatar_url: str | None
    text: str
    created_at: datetime


class ClubDetail(BaseModel):
    id: uuid.UUID
    name: str
    owner_id: uuid.UUID
    my_status: str
    is_owner: bool
    shuffled_at: datetime | None
    created_at: datetime
    members: list[ClubMemberView]
    can_shuffle: bool
    shuffle_blockers: list[str]


class ClubSummary(BaseModel):
    id: uuid.UUID
    name: str
    owner_id: uuid.UUID
    owner_name: str
    my_status: str
    active_count: int
    invited_count: int
    shuffled_at: datetime | None
    created_at: datetime
    last_message: ClubMessageView | None


class ClubListResponse(BaseModel):
    items: list[ClubSummary]


class ClubMessageListResponse(BaseModel):
    items: list[ClubMessageView]
    has_more: bool
