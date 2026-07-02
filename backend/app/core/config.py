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

    google_places_key: str = ""
    s3_endpoint: str = ""
    s3_external_endpoint: str = ""
    s3_bucket: str = ""
    s3_access_key: str = ""
    s3_secret_key: str = ""
    sms_provider_key: str = ""
    media_dir: str = "/app/media"

    # Comma-separated list of allowed origins for browser clients (admin panel, Expo web dev server).
    cors_origins: str = "http://localhost:8081,http://localhost:8000,http://localhost:3000,http://localhost:5173,http://localhost:8080,http://127.0.0.1:5500,http://localhost:5500"

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from the environment
