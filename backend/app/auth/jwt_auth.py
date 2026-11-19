from dataclasses import dataclass
import jwt
from fastapi import Request

from app.services.api_keys import ApiKeyService
from app.utils.security import ApiServiceError


@dataclass
class AuthenticatedUser:
    user_id: str
    email: str | None = None
    role: str = "authenticated"
    auth_method: str = "jwt"  # 'jwt' | 'api_key'
    api_key_id: str | None = None
    rate_limit_per_min: int | None = None


def verify_supabase_jwt(token: str, jwt_secret: str) -> AuthenticatedUser:
    if not jwt_secret:
        raise ApiServiceError(
            500,
            "AUTH_NOT_CONFIGURED",
            "SUPABASE_JWT_SECRET is not configured on the backend server.",
        )
    try:
        payload = jwt.decode(
            token,
            jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
        sub = payload.get("sub")
        if not sub:
            raise ApiServiceError(401, "INVALID_TOKEN", "JWT token is missing subject claim.")
        return AuthenticatedUser(
            user_id=str(sub),
            email=payload.get("email"),
            role=str(payload.get("role", "authenticated")),
            auth_method="jwt",
        )
    except jwt.ExpiredSignatureError as exc:
        raise ApiServiceError(401, "TOKEN_EXPIRED", "Authentication token has expired.") from exc
    except jwt.InvalidTokenError as exc:
        raise ApiServiceError(401, "INVALID_TOKEN", "Invalid authentication token.") from exc


async def resolve_optional_user(request: Request) -> AuthenticatedUser | None:
    auth_header = request.headers.get("authorization", "")
    if not auth_header:
        return None
    if not auth_header.lower().startswith("bearer "):
        raise ApiServiceError(401, "INVALID_AUTH_HEADER", "Authorization header must use Bearer scheme.")
    token = auth_header[7:].strip()
    settings = request.app.state.settings

    if token.startswith("cd_live_"):
        service = ApiKeyService(settings, request.app.state.api_keys, request.app.state.credits)
        verified = await service.verify_bearer_api_key(token)
        request.state.api_key_auth = verified
        return AuthenticatedUser(
            user_id=verified.user_id,
            role="api_key",
            auth_method="api_key",
            api_key_id=verified.api_key_id,
            rate_limit_per_min=verified.rate_limit_per_min,
        )

    return verify_supabase_jwt(token, settings.supabase_jwt_secret)


def get_optional_jwt_user(request: Request) -> AuthenticatedUser | None:
    auth_header = request.headers.get("authorization", "")
    if not auth_header:
        return None
    if not auth_header.lower().startswith("bearer "):
        raise ApiServiceError(401, "INVALID_AUTH_HEADER", "Authorization header must use Bearer scheme.")
    token = auth_header[7:].strip()
    if token.startswith("cd_live_"):
        return None
    settings = request.app.state.settings
    return verify_supabase_jwt(token, settings.supabase_jwt_secret)


def require_jwt_user(request: Request) -> AuthenticatedUser:
    user = get_optional_jwt_user(request)
    if not user:
        raise ApiServiceError(401, "UNAUTHORIZED", "Valid Bearer JWT authentication is required.")
    return user


async def require_jwt_or_api_key_user(request: Request) -> AuthenticatedUser:
    user = await resolve_optional_user(request)
    if not user:
        raise ApiServiceError(
            401,
            "UNAUTHORIZED",
            "Valid Bearer JWT or cd_live_ API key authentication is required.",
        )
    return user
