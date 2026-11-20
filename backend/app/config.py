import os
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: str = "development"
    allowed_origin: str = "http://localhost:3000"

    api_key_pepper: str = "dev-only-pepper-change-in-prod"
    download_signing_secret: str = "dev-only-signing-secret-change-in-prod"
    signed_url_ttl_seconds: int = 300

    storage_dir: str = "/tmp/cleandata_storage"
    storage_bucket: str = "cleandata-private"
    max_upload_mb_default: int = 25
    max_rows_default: int = 250_000
    xlsx_max_uncompressed_mb: int = 50
    xlsx_max_entries: int = 200
    rate_limit_per_min: int = 60

    input_retention_hours: int = 24
    output_retention_days: int = 7

    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""
    database_url: str = ""

    payment_provider: str = "razorpay"
    payment_key_id: str = ""
    payment_key_secret: str = ""
    payment_webhook_secret: str = ""

    @property
    def resolved_supabase_url(self) -> str:
        raw = self.supabase_url or os.getenv("SUPABASE_URL", "")
        return raw.strip().rstrip("/")

    @property
    def resolved_supabase_jwt_secret(self) -> str:
        raw = self.supabase_jwt_secret or os.getenv("SUPABASE_JWT_SECRET", "")
        return raw.strip()

    @property
    def resolved_supabase_service_role_key(self) -> str:
        raw = self.supabase_service_role_key or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
        return raw.strip()

    @property
    def jwks_url(self) -> str:
        base = self.resolved_supabase_url
        return f"{base}/auth/v1/.well-known/jwks.json" if base else ""

    @property
    def jwt_issuer(self) -> str:
        base = self.resolved_supabase_url
        return f"{base}/auth/v1" if base else ""

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb_default * 1024 * 1024

    @property
    def xlsx_max_uncompressed_bytes(self) -> int:
        return self.xlsx_max_uncompressed_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
