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


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class AuthTokensResponse(BaseModel):
    user_id: uuid.UUID
    access_token: str
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str


class MessageResponse(BaseModel):
    message: str
