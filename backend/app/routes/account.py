import datetime as dt
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.auth.jwt_auth import require_jwt_user
from app.database import SupabaseServiceClient
from app.utils.security import log_event

router = APIRouter(prefix="/v1/account", tags=["Account"])


class DeletionRequestPayload(BaseModel):
    reason: str = Field(default="User requested account and data deletion", max_length=500)


@router.get("/me")
async def get_account_me(request: Request) -> dict:
    user = require_jwt_user(request)
    return {
        "success": True,
        "user": {
            "id": user.user_id,
            "email": user.email,
            "role": user.role,
            "auth_method": user.auth_method,
        },
    }


@router.post("/delete-request")
async def request_account_deletion(
    request: Request, payload: DeletionRequestPayload
) -> dict:
    user = require_jwt_user(request)
    settings = request.app.state.settings
    request_id = request.state.request_id

    db = SupabaseServiceClient(settings)
    await db.update_profile_deletion(user.user_id, payload.reason)

    requested_at = dt.datetime.now(dt.timezone.utc).isoformat()
    log_event("account_deletion_requested", request_id, user_id=user.user_id)

    return {
        "success": True,
        "user_id": user.user_id,
        "deletion_requested_at": requested_at,
        "message": "Account and personal data deletion request recorded.",
    }
