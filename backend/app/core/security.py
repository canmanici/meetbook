"""JWT + password hashing + token utilities for auth."""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import argon2
import jwt
from argon2.exceptions import VerifyMismatchError

from app.core.config import get_settings

_password_hasher = argon2.PasswordHasher()


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        return _password_hasher.verify(hashed, password)
    except VerifyMismatchError:
        return False


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def generate_opaque_token(byte_length: int = 32) -> str:
    return secrets.token_urlsafe(byte_length)


def create_access_token(
    user_id: str,
    expires_in_seconds: int | None = None,
) -> str:
    settings = get_settings()
    if expires_in_seconds is None:
        expires_in_seconds = settings.jwt_access_ttl_seconds
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,
        "exp": now + timedelta(seconds=expires_in_seconds),
        "iat": now,
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> dict[str, str]:
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])


def create_refresh_token() -> tuple[str, str, uuid.UUID]:
    """Return (raw_token, token_hash, family_id)."""
    token = generate_opaque_token(32)
    token_hashed = hash_token(token)
    family_id = uuid.uuid4()
    return token, token_hashed, family_id
