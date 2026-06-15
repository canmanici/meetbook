"""Pydantic schemas for auth endpoints."""

import uuid

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
    trusted_contact_name: str | None = Field(default=None, max_length=100)
    trusted_contact_phone: str | None = Field(default=None, max_length=20)


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
    trusted_contact_name: str | None
    trusted_contact_phone: str | None
