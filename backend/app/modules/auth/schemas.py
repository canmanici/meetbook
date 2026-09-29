"""Pydantic schemas for auth endpoints."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, EmailStr, Field

# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


USERNAME_PATTERN = r"^[a-z0-9_]{3,30}$"

# Handles that would collide with app routes, system messages, or be
# impersonation-prone (e.g. "@admin", "@meetbook") — blocked at registration
# and profile-edit time, checked before the DB uniqueness check.
RESERVED_USERNAMES = frozenset(
    {
        "admin",
        "administrator",
        "root",
        "system",
        "support",
        "help",
        "meetbook",
        "official",
        "moderator",
        "mod",
        "staff",
        "team",
        "api",
        "auth",
        "login",
        "logout",
        "register",
        "settings",
        "search",
        "chat",
        "chats",
        "user",
        "users",
        "book",
        "books",
        "exchange",
        "exchanges",
        "wishlist",
        "notifications",
        "notification",
        "me",
        "null",
        "undefined",
        "anonymous",
        "deleted",
        "unknown",
        "test",
    }
)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=100)
    username: str | None = Field(
        default=None, min_length=3, max_length=30, pattern=USERNAME_PATTERN
    )
    kvkk_consent: bool


class LoginRequest(BaseModel):
    # Despite the field name (kept for backward compatibility with existing
    # clients), this accepts either an email address or a @username.
    email: str = Field(min_length=1, max_length=255, description="E-posta veya kullanıcı adı")
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str | None = None


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirmRequest(BaseModel):
    """Either email + 6-digit code (current flow) or a legacy opaque token."""

    email: EmailStr | None = None
    code: str | None = Field(default=None, pattern=r"^\s*\d{6}\s*$")
    token: str | None = None
    new_password: str = Field(min_length=8, max_length=128)


class VerifyEmailRequest(BaseModel):
    code: str = Field(pattern=r"^\s*\d{6}\s*$")


class EduEmailRequest(BaseModel):
    edu_email: str = Field(min_length=6, max_length=255)


class UpdateMeRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    username: str | None = Field(
        default=None, min_length=3, max_length=30, pattern=USERNAME_PATTERN
    )
    trusted_contact_name: str | None = Field(default=None, max_length=100)
    trusted_contact_phone: str | None = Field(default=None, max_length=20)
    geofence_radius_km: int | None = Field(default=None, ge=1, le=100)
    # B11: per-event push notification preferences (event_name -> bool)
    notification_settings: dict[str, Any] = Field(default_factory=dict[str, Any])
    # B17: smart rules to auto-accept matching exchange requests
    auto_accept_rules: list[Any] = Field(default_factory=list[Any])


class DeleteAccountRequest(BaseModel):
    password: str


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class UserPublic(BaseModel):
    id: uuid.UUID
    email: EmailStr
    name: str
    username: str
    avatar_url: str | None = None


class UserSearchResult(BaseModel):
    id: uuid.UUID
    name: str
    username: str
    avatar_url: str | None = None


class UserSearchResponse(BaseModel):
    items: list[UserSearchResult]


class UsernameAvailabilityResponse(BaseModel):
    available: bool


class UserPublicProfile(BaseModel):
    """Public profile of a user, visible to other users — no PII email."""

    id: uuid.UUID
    name: str
    username: str
    avatar_url: str | None = None
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


class GoogleLoginRequest(BaseModel):
    id_token: str = Field(min_length=20, max_length=4096)
    # Required only when this Google account creates a NEW MeetBook account.
    kvkk_consent: bool = False


class GoogleLoginResponse(TokenResponse):
    is_new_user: bool = False


class MeResponse(BaseModel):
    id: uuid.UUID
    email: EmailStr
    name: str
    username: str
    avatar_url: str | None = None
    email_verified: bool = True
    has_password: bool = True
    trusted_contact_name: str | None
    trusted_contact_phone: str | None
    geofence_radius_km: int = 10
    notification_settings: dict[str, Any] = {}
    auto_accept_rules: list[Any] = []
    edu_verified: bool = False
    edu_email: str | None = None
    pending_edu_email: str | None = None
    credit_balance: int = 0
    is_teacher: bool = False
    teacher_institution: str | None = None


# ---------------------------------------------------------------------------
# B12: Active sessions / devices
# ---------------------------------------------------------------------------


class SessionView(BaseModel):
    id: uuid.UUID
    device_info: dict[str, Any] | None
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
