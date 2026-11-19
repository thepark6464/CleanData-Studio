import uuid
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import Settings, get_settings
from app.middleware.rate_limit import RateLimitMiddleware
from app.routes import account, api_keys, billing, files, health, jobs
from app.services.api_keys import InMemoryApiKeyStore
from app.services.credits import InMemoryCreditStore
from app.services.storage import LocalPrivateStorage
from app.utils.security import ApiServiceError


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, environment: str = "development"):
        super().__init__(app)
        self.environment = environment

    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or f"req_{uuid.uuid4().hex[:10]}"
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
        )
        if self.environment == "production":
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains; preload"
            )
        return response


def create_app(settings: Settings | None = None) -> FastAPI:
    cfg = settings or get_settings()

    app = FastAPI(
        title="CleanData API",
        version="1.0.0",
        description="Messy data in. Clean data out. Shared deterministic CSV & XLSX cleaning API.",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url="/api/redoc",
    )
    app.state.settings = cfg
    app.state.storage = LocalPrivateStorage(cfg.storage_dir)
    app.state.credits = InMemoryCreditStore()
    app.state.api_keys = InMemoryApiKeyStore()

    allowed_origins = [o.strip() for o in cfg.allowed_origin.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Request-ID"],
    )
    app.add_middleware(RateLimitMiddleware, requests_per_minute=cfg.rate_limit_per_min)
    app.add_middleware(SecurityHeadersMiddleware, environment=cfg.environment)

    @app.exception_handler(ApiServiceError)
    async def handle_api_service_error(request: Request, exc: ApiServiceError):
        request_id = getattr(request.state, "request_id", "unknown")
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "success": False,
                "error": {
                    "code": exc.code,
                    "message": exc.message,
                    "request_id": request_id,
                },
            },
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError):
        request_id = getattr(request.state, "request_id", "unknown")
        return JSONResponse(
            status_code=422,
            content={
                "success": False,
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": str(exc.errors()[0].get("msg", "Invalid request parameters."))
                    if exc.errors()
                    else "Invalid request parameters.",
                    "request_id": request_id,
                },
            },
        )

    # All public API endpoints share the /api prefix for the single-domain deployment.
    app.include_router(health.router, prefix="/api")
    app.include_router(account.router, prefix="/api")
    app.include_router(billing.router, prefix="/api")
    app.include_router(api_keys.router, prefix="/api")
    app.include_router(files.router, prefix="/api")
    app.include_router(jobs.router, prefix="/api")
    return app


app = create_app()
