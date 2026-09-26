from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App configuration from environment variables (.env in local dev).

    The app refuses to boot if required values are missing — failing at startup
    beats failing on the first request.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "local"
    database_url: str
    database_pool_size: int = 20
    database_max_overflow: int = 30
    redis_url: str
    jwt_secret: str
    jwt_access_ttl_seconds: int = 15 * 60
    refresh_token_ttl_days: int = 30
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
    cors_origins: str = "http://localhost:8081,http://localhost:8000,http://localhost:3000,http://localhost:5173,http://localhost:8080,http://127.0.0.1:5500,http://localhost:5500"

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # values come from the environment
