import datetime as dt
import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass
from typing import Any

from app.config import Settings
from app.database import SupabaseServiceClient
from app.services.credits import PLAN_CATALOG
from app.utils.security import ApiServiceError


def generate_api_key() -> tuple[str, str]:
    token = secrets.token_urlsafe(24)
    raw_key = f"cd_live_{token}"
    prefix = raw_key[:14]
    return raw_key, prefix


def hash_api_key(raw_key: str, pepper: str) -> str:
    return hmac.new(
        pepper.encode("utf-8"),
        raw_key.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


@dataclass
class VerifiedApiKey:
    api_key_id: str
    user_id: str
    prefix: str
    plan_name: str
    rate_limit_per_min: int


class InMemoryApiKeyStore:
    """In-memory API key & usage store mirroring Supabase api_keys and api_usage tables."""

    def __init__(self) -> None:
        self.keys: dict[str, dict[str, Any]] = {}
        self.hash_index: dict[str, str] = {}
        self.usage: list[dict[str, Any]] = []

    def create_key(self, *, user_id: str, name: str, key_hash: str, prefix: str) -> dict[str, Any]:
        key_id = str(uuid.uuid4())
        row = {
            "id": key_id,
            "user_id": user_id,
            "name": name.strip()[:80] or "Default Key",
            "key_hash": key_hash,
            "prefix": prefix,
            "last_used_at": None,
            "revoked_at": None,
            "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        }
        self.keys[key_id] = row
        self.hash_index[key_hash] = key_id
        return {k: v for k, v in row.items() if k != "key_hash"}

    def list_keys(self, user_id: str) -> list[dict[str, Any]]:
        rows = [
            {k: v for k, v in row.items() if k != "key_hash"}
            for row in self.keys.values()
            if row["user_id"] == user_id
        ]
        return sorted(rows, key=lambda r: r["created_at"], reverse=True)

    def revoke_key(self, user_id: str, key_id: str) -> dict[str, Any]:
        row = self.keys.get(key_id)
        if not row or row["user_id"] != user_id:
            raise ApiServiceError(404, "API_KEY_NOT_FOUND", "API key not found.")
        if row["revoked_at"] is None:
            row["revoked_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
        return {k: v for k, v in row.items() if k != "key_hash"}

    def lookup_by_hash(self, key_hash: str) -> dict[str, Any] | None:
        key_id = self.hash_index.get(key_hash)
        if not key_id:
            return None
        row = self.keys.get(key_id)
        if not row or row["revoked_at"] is not None:
            return None
        return row

    def touch_last_used(self, key_id: str) -> None:
        if key_id in self.keys:
            self.keys[key_id]["last_used_at"] = dt.datetime.now(dt.timezone.utc).isoformat()

    def record_usage(
        self,
        *,
        user_id: str,
        api_key_id: str | None,
        endpoint: str,
        credits_used: int,
        status_code: int,
    ) -> None:
        self.usage.append(
            {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "api_key_id": api_key_id,
                "endpoint": endpoint,
                "credits_used": credits_used,
                "status_code": status_code,
                "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            }
        )

    def list_usage(self, user_id: str, limit: int = 50) -> list[dict[str, Any]]:
        items = [u for u in reversed(self.usage) if u["user_id"] == user_id]
        return items[:limit]


class ApiKeyService:
    def __init__(
        self,
        settings: Settings,
        memory_keys: InMemoryApiKeyStore,
        memory_credits: Any,
    ) -> None:
        self.settings = settings
        self.memory_keys = memory_keys
        self.memory_credits = memory_credits
        self.db = SupabaseServiceClient(settings)

    async def _get_user_plan_limits(self, user_id: str) -> tuple[str, bool, int]:
        if self.db.configured:
            summary = await self.db.get_billing_summary(user_id)
            sub = summary.subscription
            return sub.plan_name, sub.api_access, sub.api_rate_limit_per_min
        w = self.memory_credits.ensure_wallet(user_id)
        plan = PLAN_CATALOG.get(w.plan_name, PLAN_CATALOG["Free"])
        return plan.name, plan.api_access, plan.api_rate_limit_per_min

    async def create_key_for_user(self, user_id: str, name: str) -> tuple[str, dict[str, Any]]:
        plan_name, api_access, _ = await self._get_user_plan_limits(user_id)
        if not api_access:
            raise ApiServiceError(
                403,
                "PLAN_UPGRADE_REQUIRED",
                f"API keys require the Pro or Business plan (current plan: {plan_name}).",
            )

        raw_key, prefix = generate_api_key()
        key_hash = hash_api_key(raw_key, self.settings.api_key_pepper)

        if self.db.configured:
            meta = await self.db.create_api_key(
                user_id=user_id,
                name=name.strip()[:80] or "Default Key",
                key_hash=key_hash,
                prefix=prefix,
            )
            return raw_key, meta

        meta = self.memory_keys.create_key(
            user_id=user_id, name=name, key_hash=key_hash, prefix=prefix
        )
        return raw_key, meta

    async def list_keys_for_user(self, user_id: str) -> list[dict[str, Any]]:
        if self.db.configured:
            return await self.db.list_api_keys(user_id)
        return self.memory_keys.list_keys(user_id)

    async def revoke_key_for_user(self, user_id: str, key_id: str) -> dict[str, Any]:
        if self.db.configured:
            ok = await self.db.revoke_api_key(user_id, key_id)
            if not ok:
                raise ApiServiceError(404, "API_KEY_NOT_FOUND", "API key not found.")
            keys = await self.db.list_api_keys(user_id)
            for k in keys:
                if k["id"] == key_id:
                    return k
            return {"id": key_id, "revoked_at": dt.datetime.now(dt.timezone.utc).isoformat()}
        return self.memory_keys.revoke_key(user_id, key_id)

    async def verify_bearer_api_key(self, raw_key: str) -> VerifiedApiKey:
        if not raw_key.startswith("cd_live_") or len(raw_key) < 20:
            raise ApiServiceError(401, "INVALID_API_KEY", "Malformed CleanData API key.")
        key_hash = hash_api_key(raw_key, self.settings.api_key_pepper)

        if self.db.configured:
            row = await self.db.lookup_api_key_by_hash(key_hash)
            if not row or row.get("revoked_at"):
                raise ApiServiceError(401, "INVALID_API_KEY", "API key is invalid or revoked.")
            user_id = str(row["user_id"])
            plan_name, api_access, rate_limit = await self._get_user_plan_limits(user_id)
            if not api_access:
                raise ApiServiceError(
                    403,
                    "PLAN_UPGRADE_REQUIRED",
                    f"API access is not enabled on your {plan_name} plan.",
                )
            await self.db.touch_api_key_last_used(str(row["id"]))
            return VerifiedApiKey(
                api_key_id=str(row["id"]),
                user_id=user_id,
                prefix=str(row["prefix"]),
                plan_name=plan_name,
                rate_limit_per_min=rate_limit or self.settings.rate_limit_per_min,
            )

        row = self.memory_keys.lookup_by_hash(key_hash)
        if not row:
            raise ApiServiceError(401, "INVALID_API_KEY", "API key is invalid or revoked.")
        user_id = str(row["user_id"])
        plan_name, api_access, rate_limit = await self._get_user_plan_limits(user_id)
        if not api_access:
            raise ApiServiceError(
                403,
                "PLAN_UPGRADE_REQUIRED",
                f"API access is not enabled on your {plan_name} plan.",
            )
        self.memory_keys.touch_last_used(str(row["id"]))
        return VerifiedApiKey(
            api_key_id=str(row["id"]),
            user_id=user_id,
            prefix=str(row["prefix"]),
            plan_name=plan_name,
            rate_limit_per_min=rate_limit or self.settings.rate_limit_per_min,
        )

    async def record_usage(
        self,
        *,
        user_id: str,
        api_key_id: str | None,
        endpoint: str,
        credits_used: int,
        status_code: int,
    ) -> None:
        if self.db.configured:
            await self.db.record_api_usage(
                user_id=user_id,
                api_key_id=api_key_id,
                endpoint=endpoint,
                credits_used=credits_used,
                status_code=status_code,
            )
        else:
            self.memory_keys.record_usage(
                user_id=user_id,
                api_key_id=api_key_id,
                endpoint=endpoint,
                credits_used=credits_used,
                status_code=status_code,
            )

    async def get_usage_summary(self, user_id: str) -> dict[str, Any]:
        plan_name, api_access, rate_limit = await self._get_user_plan_limits(user_id)
        if self.db.configured:
            items = await self.db.list_api_usage(user_id)
        else:
            items = self.memory_keys.list_usage(user_id)
        return {
            "success": True,
            "plan_name": plan_name,
            "api_access": api_access,
            "rate_limit_per_min": rate_limit,
            "total_requests_logged": len(items),
            "items": items,
        }
