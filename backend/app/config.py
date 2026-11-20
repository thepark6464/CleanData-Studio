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

    payment_provider: str = "cashfree"
    cashfree_app_id: str = ""
    cashfree_secret_key: str = ""
    cashfree_webhook_secret: str = ""
    cashfree_env: str = "sandbox"
    cashfree_api_version: str = "2025-01-01"
    payment_webhook_secret: str = ""

    @property
    def resolved_cashfree_env(self) -> str:
        raw = (self.cashfree_env or os.getenv("CASHFREE_ENV", "sandbox")).strip().lower()
        return "production" if raw == "production" else "sandbox"

    @property
    def cashfree_base_url(self) -> str:
        if self.resolved_cashfree_env == "production":
            return "https://api.cashfree.com/pg"
        return "https://sandbox.cashfree.com/pg"

    @property
    def resolved_cashfree_app_id(self) -> str:
        return (self.cashfree_app_id or os.getenv("CASHFREE_APP_ID", "")).strip()

    @property
    def resolved_cashfree_secret_key(self) -> str:
        return (self.cashfree_secret_key or os.getenv("CASHFREE_SECRET_KEY", "")).strip()

    @property
    def resolved_cashfree_webhook_secret(self) -> str:
        raw = (
            self.cashfree_webhook_secret
            or os.getenv("CASHFREE_WEBHOOK_SECRET", "")
            or self.resolved_cashfree_secret_key
            or self.payment_webhook_secret
            or os.getenv("PAYMENT_WEBHOOK_SECRET", "")
        )
        return raw.strip()

    @property
    def resolved_cashfree_api_version(self) -> str:
        raw = self.cashfree_api_version or os.getenv("CASHFREE_API_VERSION", "2025-01-01")
        return raw.strip() or "2025-01-01"

    @property
    def resolved_frontend_origin(self) -> str:
        first = next((o.strip().rstrip("/") for o in self.allowed_origin.split(",") if o.strip()), "")
        return first or "https://cleandata-studio.vercel.app"

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
