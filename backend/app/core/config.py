from functools import lru_cache
from typing import Any

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _blank_to_default(value: Any) -> Any:
    """Treat an empty env var as "not set" for NON-STRING fields.

    Docker Compose interpolation (``FOO: "${FOO:-}"``) passes an EMPTY STRING
    for an unset variable, and pydantic rejects ``""`` for an ``int`` field —
    which crashed the app at import time with a confusing "Database NOT ready"
    error, because get_settings() blew up before the connection was even tried.

    Only numbers/bools are translated. A blank string field (``smtp_host=""``)
    is a legitimate value and must stay an empty string, not become None.
    """
    if isinstance(value, str) and not value.strip():
        return None
    return value


DEV_ENVS = ("local", "dev", "development", "test")


class Settings(BaseSettings):
    """App configuration from environment variables (.env in local dev).

    The app refuses to boot if required values are missing — failing at startup
    beats failing on the first request.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @model_validator(mode="after")
    def _strong_jwt_secret_outside_dev(self) -> "Settings":
        # A guessable secret lets anyone mint an admin token.
        if self.env not in DEV_ENVS and (
            len(self.jwt_secret) < 32
            or self.jwt_secret in ("dev-only-change-me", "secret", "changeme")
        ):
            raise ValueError("JWT_SECRET must be a random value of at least 32 characters")
        return self

    @field_validator(
        "database_pool_size",
        "database_max_overflow",
        "database_pool_timeout",
        "database_pool_recycle",
        "database_pool_pre_ping",
        "rate_limit_enabled",
        "login_throttle_enabled",
        "jwt_access_ttl_seconds",
        "refresh_token_ttl_days",
        "smtp_port",
        mode="before",
    )
    @classmethod
    def _blank_numeric_env_to_default(cls, value: Any) -> Any:
        return _blank_to_default(value)

    # Safe default: a deployment that forgets ENV runs as production (no API
    # docs, no auto-verified email). Local .env / compose / tests set it.
    env: str = "production"
    database_url: str
    # Per process. The app runs ONE uvicorn process (see start_app.py), so this
    # is the whole app's budget: 40 steady + 40 burst = 80. Postgres runs with
    # max_connections=200 (compose), which leaves room for a rolling deploy's
    # second container (2 x 80) plus migrations and the admin shell.
    database_pool_size: int = 40
    database_max_overflow: int = 40
    # How long a request queues for a pooled connection before QueuePool
    # timeout (-> HTTP 500). Under a burst, waiting beats failing.
    database_pool_timeout: int = 30
    # Seconds before a pooled connection is replaced. Long-lived connections
    # keep asyncpg's prepared-statement cache warm.
    database_pool_recycle: int = 3600
    # SELECT 1 before every checkout = one extra DB round trip per request.
    # Off: a connection killed by a DB restart fails one request and is then
    # discarded by the pool. Turn on if the DB sits behind a flaky network.
    database_pool_pre_ping: bool = False
    # Redis-backed request rate limiting (global + per-route middleware).
    # On by default — one Redis round trip per request buys protection from
    # scraping and floods. RATE_LIMIT_ENABLED=false turns it off (tests, or a
    # deliberate load test; RATE_LIMIT_SCALE raises the limits instead).
    rate_limit_enabled: bool = True
    # Login brute-force lockout (5 failures / 15 min per account+IP). Separate
    # from the perf-driven switch above and ON by default: it costs two Redis
    # calls per login, and without it admin passwords can be guessed forever.
    login_throttle_enabled: bool = True
    redis_url: str
    jwt_secret: str
    jwt_access_ttl_seconds: int = 15 * 60
    refresh_token_ttl_days: int = 30
    # Book credits: when on, taking a book needs credits (or allowed debt) and
    # borrowing needs a deposit. Off = credits are still recorded, never blocking.
    # Turn on (CREDITS_ENFORCED=true) only once the app build that shows
    # wallets and edu verification is out — older builds can't explain a 409.
    credits_enforced: bool = False
    # -- Outgoing mail (SMTP) ---------------------------------------------
    # Works with any SMTP provider (Gmail app password, Brevo, Zoho, Yandex,
    # Resend SMTP, ...). When smtp_host is empty, mail is NOT sent: codes are
    # logged instead and email verification is not enforced (see mail_enabled).
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "MeetBook <no-reply@meetbook.app>"
    smtp_starttls: bool = True  # port 587
    smtp_ssl: bool = False  # port 465 (implicit TLS)
    # Where KVKK data-subject requests are forwarded (data controller inbox).
    kvkk_controller_email: str = ""

    @property
    def mail_enabled(self) -> bool:
        return bool(self.smtp_host)

    @property
    def is_dev(self) -> bool:
        return self.env in DEV_ENVS

    @property
    def auto_verify_email(self) -> bool:
        """Without SMTP a code can never arrive. In dev, verify sign-ups
        automatically so nobody is locked out; in production NEVER — that
        would make "verified" meaningless. Configure SMTP instead."""
        return not self.mail_enabled and self.is_dev

    # Number of reverse proxies we control in front of the app (Traefik = 1).
    # The client IP is read this many entries from the RIGHT of
    # X-Forwarded-For — see app/core/client_ip.py.
    trusted_proxy_hops: int = 1

    # -- TURN / WebRTC calls --------------------------------------------
    # Shared HMAC secret with coturn (`static-auth-secret`). Empty -> the
    # /chat/turn-credentials endpoint returns STUN-only ICE servers.
    turn_secret: str = ""
    # Public hostname(s) or static IP(s) of TURN server(s) — comma-separated
    # for multi-region (client offers all; ICE picks the lowest-latency one).
    # Never a docker name.
    turn_host: str = ""
    turn_port: int = 3478
    # TLS listener port for `turns:` (TURN-over-TLS). 0 = disabled. Run coturn
    # with tls-listening-port=443 + a real cert: it's the only transport that
    # survives UDP-blocking corporate/hotel networks.
    turn_tls_port: int = 0
    turn_credential_ttl_seconds: int = 3600

    @property
    def turn_hosts_list(self) -> list[str]:
        return [h.strip() for h in self.turn_host.split(",") if h.strip()]

    google_places_key: str = ""
    # OAuth client IDs whose Google ID tokens we accept (comma-separated).
    # For Android sign-in the token audience is the WEB client ID passed as
    # `webClientId` in the app; add iOS/other client IDs here too if used.
    google_client_ids: str = ""

    @property
    def google_client_ids_list(self) -> list[str]:
        return [c.strip() for c in self.google_client_ids.split(",") if c.strip()]

    s3_endpoint: str = ""
    s3_external_endpoint: str = ""
    s3_bucket: str = ""
    s3_access_key: str = ""
    s3_secret_key: str = ""
    sms_provider_key: str = ""
    media_dir: str = "/app/media"
    # Offline DB-IP databases for IP → country/city/ISP (see app/core/ipdb.py).
    # Kept out of media_dir, which is served publicly at /media.
    ip_db_dir: str = "/app/ipdb"

    # Comma-separated list of allowed origins for browser clients (admin panel, Expo web dev server).
    # Empty by default: the admin panel is same-origin and the native app
    # sends no Origin, so production needs none. Dev lists its origins in .env.
    cors_origins: str = ""

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # values come from the environment
