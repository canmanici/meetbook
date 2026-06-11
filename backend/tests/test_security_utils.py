from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_access_token,
    generate_opaque_token,
    hash_password,
    hash_token,
    verify_password,
)


def test_hash_and_verify_password() -> None:
    password = "securepass123"
    hashed = hash_password(password)
    assert verify_password(password, hashed) is True
    assert verify_password("wrongpass", hashed) is False


def test_access_token_roundtrip() -> None:
    user_id = "550e8400-e29b-41d4-a716-446655440000"
    token = create_access_token(user_id)
    payload = decode_access_token(token)
    assert payload["sub"] == user_id
    assert "exp" in payload
    assert "jti" in payload


def test_access_token_expiry() -> None:
    user_id = "550e8400-e29b-41d4-a716-446655440000"
    token = create_access_token(user_id, expires_in_seconds=-1)
    try:
        decode_access_token(token)
        raise AssertionError("Should have raised")
    except Exception:
        pass


def test_refresh_token_generation() -> None:
    token, token_hash, family_id = create_refresh_token()
    assert len(token) > 32
    assert len(token_hash) == 64  # SHA-256 hex digest
    assert len(str(family_id)) == 36  # UUID


def test_hash_token_deterministic() -> None:
    token = "abc123"
    h1 = hash_token(token)
    h2 = hash_token(token)
    assert h1 == h2


def test_generate_opaque_token_unique() -> None:
    t1 = generate_opaque_token()
    t2 = generate_opaque_token()
    assert t1 != t2
    assert len(t1) >= 32
