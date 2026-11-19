from dataclasses import dataclass
from functools import lru_cache

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


@lru_cache(maxsize=4)
def _jwks_client(jwks_url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(jwks_url, cache_jwk_set=True, lifespan=300)


def verify_supabase_jwt(
    token: str, jwt_secret: str, supabase_url: str
) -> AuthenticatedUser:
    try:
        header = jwt.get_unverified_header(token)
        algorithm = header.get("alg")

        if algorithm == "ES256":
            if not supabase_url:
                raise ApiServiceError(
                    500,
                    "AUTH_NOT_CONFIGURED",
                    "SUPABASE_URL is required to verify Supabase ES256 tokens.",
                )
            jwks_url = (
                f"{supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
            )
            signing_key = _jwks_client(jwks_url).get_signing_key_from_jwt(token)
            verification_key = signing_key.key
        elif algorithm == "HS256":
            if not jwt_secret:
                raise ApiServiceError(
                    500,
                    "AUTH_NOT_CONFIGURED",
                    "SUPABASE_JWT_SECRET is required for legacy HS256 tokens.",
                )
            verification_key = jwt_secret
        else:
            raise ApiServiceError(
                401,
                "INVALID_TOKEN",
                "Unsupported authentication token signing algorithm.",
            )

        issuer = f"{supabase_url.rstrip('/')}/auth/v1" if supabase_url else None
        payload = jwt.decode(
            token,
            verification_key,
            algorithms=[algorithm],
            audience="authenticated",
            issuer=issuer,
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
    except jwt.PyJWTError as exc:
        raise ApiServiceError(401, "INVALID_TOKEN", "Invalid authentication token.") from exc
    except ApiServiceError:
        raise
    except Exception as exc:
        # JWKS retrieval failures are server-side configuration/network issues,
        # not evidence that the user's token is invalid.
        raise ApiServiceError(
            503,
            "AUTH_VERIFICATION_UNAVAILABLE",
            "Could not retrieve Supabase signing keys. Please retry shortly.",
        ) from exc


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

    return verify_supabase_jwt(
        token, settings.supabase_jwt_secret, settings.supabase_url
    )


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
    return verify_supabase_jwt(
        token, settings.supabase_jwt_secret, settings.supabase_url
    )


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
