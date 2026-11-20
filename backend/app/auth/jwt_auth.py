from dataclasses import dataclass
import os
from threading import Lock
import jwt
from fastapi import Depends, Request
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientConnectionError, PyJWKClientError

from app.config import Settings
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


_JWK_CLIENTS: dict[str, PyJWKClient] = {}
_JWK_LOCK = Lock()


def get_jwk_client(jwks_url: str) -> PyJWKClient:
    with _JWK_LOCK:
        client = _JWK_CLIENTS.get(jwks_url)
        if client is None:
            client = PyJWKClient(
                jwks_url,
                cache_jwk_set=True,
                lifespan=300,
                timeout=8,
            )
            _JWK_CLIENTS[jwks_url] = client
        return client


def clear_jwk_client_cache() -> None:
    with _JWK_LOCK:
        _JWK_CLIENTS.clear()


def _decode_es256_or_rs256(token: str, alg: str, supabase_url: str) -> dict:
    if not supabase_url:
        raise ApiServiceError(
            500,
            "AUTH_NOT_CONFIGURED",
            "SUPABASE_URL is required to verify Supabase ES256 tokens.",
        )

    base_url = supabase_url.strip().rstrip("/")
    jwks_url = f"{base_url}/auth/v1/.well-known/jwks.json"
    issuer = f"{base_url}/auth/v1"
    jwk_client = get_jwk_client(jwks_url)

    try:
        signing_key = jwk_client.get_signing_key_from_jwt(token)
    except PyJWKClientConnectionError as exc:
        raise ApiServiceError(
            503,
            "AUTH_JWKS_UNAVAILABLE",
            "Unable to reach Supabase JWKS endpoint to verify authentication token.",
        ) from exc
    except PyJWKClientError as exc:
        raise ApiServiceError(
            401,
            "INVALID_TOKEN",
            "Token signing key could not be verified against Supabase JWKS.",
        ) from exc

    return jwt.decode(
        token,
        signing_key.key,
        algorithms=[alg],
        audience="authenticated",
        issuer=issuer,
        options={"require": ["exp", "sub"]},
    )


def _decode_hs256_legacy(token: str, jwt_secret: str, supabase_url: str) -> dict:
    if not jwt_secret:
        raise ApiServiceError(
            500,
            "AUTH_NOT_CONFIGURED",
            "SUPABASE_JWT_SECRET is required to verify legacy HS256 tokens.",
        )

    decode_kwargs: dict = {
        "algorithms": ["HS256"],
        "audience": "authenticated",
        "options": {"require": ["exp", "sub"]},
    }
    if supabase_url:
        decode_kwargs["issuer"] = f"{supabase_url.strip().rstrip('/')}/auth/v1"

    return jwt.decode(token, jwt_secret, **decode_kwargs)


def verify_supabase_jwt(
    token: str,
    settings_or_secret: Settings | str,
    supabase_url: str = "",
) -> AuthenticatedUser:
    if isinstance(settings_or_secret, Settings):
        resolved_secret = settings_or_secret.resolved_supabase_jwt_secret
        resolved_url = settings_or_secret.resolved_supabase_url
    else:
        resolved_secret = settings_or_secret.strip()
        resolved_url = (supabase_url or os.getenv("SUPABASE_URL", "")).strip().rstrip("/")

    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError as exc:
        raise ApiServiceError(401, "INVALID_TOKEN", "Malformed authentication token header.") from exc

    alg = str(header.get("alg", "")).upper()
    if alg not in ("ES256", "RS256", "HS256"):
        raise ApiServiceError(401, "INVALID_TOKEN", "Unsupported authentication token algorithm.")

    try:
        if alg in ("ES256", "RS256"):
            payload = _decode_es256_or_rs256(token, alg, resolved_url)
        else:
            payload = _decode_hs256_legacy(token, resolved_secret, resolved_url)

        sub = payload.get("sub")
        if not sub or not str(sub).strip():
            raise ApiServiceError(401, "INVALID_TOKEN", "JWT token is missing subject claim.")

        return AuthenticatedUser(
            user_id=str(sub),
            email=payload.get("email"),
            role=str(payload.get("role", "authenticated")),
            auth_method="jwt",
        )
    except ApiServiceError:
        raise
    except jwt.ExpiredSignatureError as exc:
        raise ApiServiceError(401, "TOKEN_EXPIRED", "Authentication token has expired.") from exc
    except jwt.InvalidIssuerError as exc:
        raise ApiServiceError(401, "INVALID_TOKEN", "Authentication token issuer mismatch.") from exc
    except jwt.InvalidAudienceError as exc:
        raise ApiServiceError(401, "INVALID_TOKEN", "Authentication token audience mismatch.") from exc
    except jwt.InvalidTokenError as exc:
        raise ApiServiceError(401, "INVALID_TOKEN", "Invalid authentication token.") from exc


async def resolve_optional_user(request: Request) -> AuthenticatedUser | None:
    auth_header = request.headers.get("authorization", "")
    if not auth_header:
        return None
    if not auth_header.lower().startswith("bearer "):
        raise ApiServiceError(401, "INVALID_AUTH_HEADER", "Authorization header must use Bearer scheme.")
    token = auth_header[7:].strip()
    if not token:
        raise ApiServiceError(401, "INVALID_AUTH_HEADER", "Bearer token is empty.")

    settings: Settings = request.app.state.settings

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

    return verify_supabase_jwt(token, settings)


def get_optional_jwt_user(request: Request) -> AuthenticatedUser | None:
    auth_header = request.headers.get("authorization", "")
    if not auth_header:
        return None
    if not auth_header.lower().startswith("bearer "):
        raise ApiServiceError(401, "INVALID_AUTH_HEADER", "Authorization header must use Bearer scheme.")
    token = auth_header[7:].strip()
    if not token:
        raise ApiServiceError(401, "INVALID_AUTH_HEADER", "Bearer token is empty.")
    if token.startswith("cd_live_"):
        return None
    settings: Settings = request.app.state.settings
    return verify_supabase_jwt(token, settings)


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


# FastAPI dependency aliases for routes using Depends(...)
async def get_current_user_optional(request: Request) -> AuthenticatedUser | None:
    return await resolve_optional_user(request)


async def get_current_jwt_user(request: Request) -> AuthenticatedUser:
    return require_jwt_user(request)


async def get_current_user(request: Request) -> AuthenticatedUser:
    return await require_jwt_or_api_key_user(request)


CurrentJwtUser = Depends(get_current_jwt_user)
CurrentUser = Depends(get_current_user)
