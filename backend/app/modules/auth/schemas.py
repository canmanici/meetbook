"""Pydantic schemas for auth endpoints."""

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=100)
    kvkk_consent: bool


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str | None = None


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirmRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)


class UpdateMeRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    trusted_contact_name: str | None = Field(default=None, max_length=100)
    trusted_contact_phone: str | None = Field(default=None, max_length=20)
    geofence_radius_km: int | None = Field(default=None, ge=1, le=100)
    # B11: per-event push notification preferences (event_name -> bool)
    notification_settings: dict = Field(default_factory=dict)
    # B17: smart rules to auto-accept matching exchange requests
    auto_accept_rules: list = Field(default_factory=list)


class DeleteAccountRequest(BaseModel):
    password: str


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class UserPublic(BaseModel):
    id: uuid.UUID
    email: EmailStr
    name: str


class UserPublicProfile(BaseModel):
    """Public profile of a user, visible to other users — no PII email."""
    id: uuid.UUID
    name: str
    completed_exchanges: int = 0
    rating_average: float = 0
    rating_count: int = 0
    loans_borrowed_count: int = 0
    trust_score: int = 0
    trust_badge: str = "yellow"
    trust_label: str = ""


class AuthTokensResponse(BaseModel):
    user_id: uuid.UUID
    access_token: str
    refresh_token: str
    user: UserPublic


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    user: UserPublic


class MessageResponse(BaseModel):
    message: str


class MeResponse(BaseModel):
    id: uuid.UUID
    email: EmailStr
    name: str
    avatar_url: str | None = None
    trusted_contact_name: str | None
    trusted_contact_phone: str | None
    geofence_radius_km: int = 10
    notification_settings: dict = {}
    auto_accept_rules: list = []


# ---------------------------------------------------------------------------
# B12: Active sessions / devices
# ---------------------------------------------------------------------------


class SessionView(BaseModel):
    id: uuid.UUID
    device_info: dict | None
    created_at: datetime
    is_current: bool = False


class SessionListResponse(BaseModel):
    items: list[SessionView]


# ---------------------------------------------------------------------------
# B25: Vouching system
# ---------------------------------------------------------------------------


class VouchRequest(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class VouchView(BaseModel):
    voucher_id: uuid.UUID
    vouchee_id: uuid.UUID
    note: str | None = None
    created_at: datetime


class VouchListResponse(BaseModel):
    items: list[VouchView]
