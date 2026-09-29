"""Security-relevant settings must be safe when nobody configured them."""

import pytest
from pydantic import ValidationError

from app.core.config import Settings

REQUIRED = {
    "database_url": "postgresql+asyncpg://u:p@localhost/db",
    "redis_url": "redis://localhost:6379/0",
}
STRONG = "x" * 40


def _settings(monkeypatch: pytest.MonkeyPatch, **values: str) -> Settings:
    # Isolate from the test process environment and any .env file.
    for key in ("ENV", "RATE_LIMIT_ENABLED", "LOGIN_THROTTLE_ENABLED", "SMTP_HOST", "CORS_ORIGINS"):
        monkeypatch.delenv(key, raising=False)
    return Settings(_env_file=None, **{**REQUIRED, **values})


def test_unconfigured_deployment_defaults_to_the_safe_side(monkeypatch) -> None:
    s = _settings(monkeypatch, jwt_secret=STRONG)
    assert s.env == "production"
    assert s.is_dev is False
    assert s.rate_limit_enabled is True
    assert s.login_throttle_enabled is True
    assert s.cors_origins_list == []
    assert s.credits_enforced is False


def test_production_never_auto_verifies_email_without_smtp(monkeypatch) -> None:
    assert _settings(monkeypatch, jwt_secret=STRONG).auto_verify_email is False
    assert _settings(monkeypatch, jwt_secret=STRONG, env="local").auto_verify_email is True
    assert (
        _settings(monkeypatch, jwt_secret=STRONG, env="local", smtp_host="mail").auto_verify_email
        is False
    )


@pytest.mark.parametrize("secret", ["secret", "dev-only-change-me", "short-but-not-32"])
def test_weak_jwt_secret_is_refused_outside_dev(monkeypatch, secret: str) -> None:
    with pytest.raises(ValidationError):
        _settings(monkeypatch, jwt_secret=secret)
    # Local development may keep a throwaway secret.
    assert _settings(monkeypatch, jwt_secret=secret, env="local").jwt_secret == secret
