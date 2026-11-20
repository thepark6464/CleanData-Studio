import httpx
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.auth.jwt_auth import require_jwt_or_api_key_user, require_jwt_user
from app.database import SupabaseServiceClient
from app.services.api_keys import ApiKeyService
from app.utils.security import ApiServiceError, log_event

router = APIRouter(prefix="/v1", tags=["API Keys & Usage"])
usage_router = APIRouter(tags=["API Keys & Usage"])


class CreateApiKeyPayload(BaseModel):
    name: str = Field(default="Production Pipeline", min_length=1, max_length=80)


@router.get("/api-keys")
async def list_api_keys(request: Request) -> dict:
    user = require_jwt_user(request)
    service = ApiKeyService(
        request.app.state.settings,
        request.app.state.api_keys,
        request.app.state.credits,
    )
    items = await service.list_keys_for_user(user.user_id)
    return {"success": True, "items": items}


@router.post("/api-keys")
async def create_api_key(request: Request, payload: CreateApiKeyPayload) -> dict:
    user = require_jwt_user(request)
    request_id = request.state.request_id
    service = ApiKeyService(
        request.app.state.settings,
        request.app.state.api_keys,
        request.app.state.credits,
    )
    plaintext_key, meta = await service.create_key_for_user(user.user_id, payload.name)
    log_event(
        "api_key_created",
        request_id,
        user_id=user.user_id,
        api_key_id=meta.get("id"),
        prefix=meta.get("prefix"),
    )
    return {
        "success": True,
        "plaintext_key": plaintext_key,
        "key": meta,
        "message": "Copy your API key now. It will never be displayed again.",
    }


@router.delete("/api-keys/{key_id}")
async def revoke_api_key(request: Request, key_id: str) -> dict:
    user = require_jwt_user(request)
    request_id = request.state.request_id
    service = ApiKeyService(
        request.app.state.settings,
        request.app.state.api_keys,
        request.app.state.credits,
    )
    revoked = await service.revoke_key_for_user(user.user_id, key_id)
    log_event("api_key_revoked", request_id, user_id=user.user_id, api_key_id=key_id)
    return {"success": True, "key": revoked}


def _resolve_rate_limit_snapshot(request: Request) -> dict[str, int] | None:
    limiter = getattr(request.app.state, "rate_limiter", None)
    if limiter is not None:
        return limiter.inspect(request)
    return getattr(request.state, "rate_limit_snapshot", None)


@router.get("/usage")
async def get_usage(request: Request) -> dict:
    user = await require_jwt_or_api_key_user(request)
    service = ApiKeyService(
        request.app.state.settings,
        request.app.state.api_keys,
        request.app.state.credits,
    )
    return await service.get_usage_summary(
        user.user_id,
        rate_limit_snapshot=_resolve_rate_limit_snapshot(request),
    )


@usage_router.get("/usage")
async def get_api_usage_root(request: Request) -> dict:
    user = await require_jwt_or_api_key_user(request)
    service = ApiKeyService(
        request.app.state.settings,
        request.app.state.api_keys,
        request.app.state.credits,
    )
    return await service.get_usage_summary(
        user.user_id,
        rate_limit_snapshot=_resolve_rate_limit_snapshot(request),
    )


@router.get("/credits")
async def get_credits(request: Request) -> dict:
    user = await require_jwt_or_api_key_user(request)
    request_id = request.state.request_id
    settings = request.app.state.settings
    db = SupabaseServiceClient(settings)
    if db.configured:
        try:
            summary = await db.get_billing_summary(user.user_id)
        except (httpx.HTTPError, ValueError) as exc:
            log_event(
                "credits_summary_db_error",
                request_id,
                user_id=user.user_id,
                error_type=type(exc).__name__,
            )
            raise ApiServiceError(
                503,
                "BILLING_DATABASE_UNAVAILABLE",
                "Unable to load credit wallet from database. Please retry.",
            ) from exc
    else:
        summary = request.app.state.credits.get_summary(user.user_id)
    return {
        "success": True,
        "plan_name": summary.subscription.plan_name,
        "wallet": summary.wallet.model_dump(),
    }
