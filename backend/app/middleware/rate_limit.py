import hashlib
import time
from collections import defaultdict, deque
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

EXEMPT_PATHS = {
    "/health",
    "/health/metrics",
    "/api/health",
    "/api/health/metrics",
    "/api/docs",
    "/api/redoc",
    "/api/openapi.json",
    "/docs",
    "/redoc",
    "/openapi.json",
}


class SlidingWindowRateLimiter:
    """Thread-safe / single-process sliding-window rate limiter with live inspection."""

    def __init__(self, requests_per_minute: int = 60, window_seconds: int = 60):
        self.requests_per_minute = max(1, requests_per_minute)
        self.window_seconds = max(1, window_seconds)
        self.buckets: dict[str, deque[float]] = defaultdict(deque)

    @staticmethod
    def identity_for_request(request: Request) -> str:
        auth_header = request.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer ") and len(auth_header) > 15:
            token_digest = hashlib.sha256(auth_header[7:].encode("utf-8")).hexdigest()[:16]
            return f"tok:{token_digest}"
        client_ip = request.client.host if request.client else "unknown"
        return f"ip:{client_ip}"

    def _prune(self, bucket: deque[float], now: float) -> None:
        window_start = now - float(self.window_seconds)
        while bucket and bucket[0] < window_start:
            bucket.popleft()

    def inspect(self, request: Request, limit_override: int | None = None) -> dict[str, int]:
        identity = self.identity_for_request(request)
        now = time.monotonic()
        bucket = self.buckets[identity]
        self._prune(bucket, now)
        effective_limit = (
            limit_override if limit_override is not None and limit_override > 0 else self.requests_per_minute
        )
        used = len(bucket)
        remaining = max(0, effective_limit - used)
        reset_in = (
            max(1, int(self.window_seconds - (now - bucket[0])))
            if bucket
            else self.window_seconds
        )
        return {
            "limit_per_min": effective_limit,
            "used": used,
            "remaining": remaining,
            "window_seconds": self.window_seconds,
            "reset_in_seconds": reset_in,
        }

    def check_and_record(self, request: Request) -> tuple[bool, int, dict[str, int]]:
        identity = self.identity_for_request(request)
        now = time.monotonic()
        bucket = self.buckets[identity]
        self._prune(bucket, now)
        effective_limit = self.requests_per_minute

        if len(bucket) >= effective_limit:
            retry_after = max(1, int(self.window_seconds - (now - bucket[0])))
            snapshot = {
                "limit_per_min": effective_limit,
                "used": len(bucket),
                "remaining": 0,
                "window_seconds": self.window_seconds,
                "reset_in_seconds": retry_after,
            }
            return False, retry_after, snapshot

        bucket.append(now)
        remaining = max(0, effective_limit - len(bucket))
        reset_in = (
            max(1, int(self.window_seconds - (now - bucket[0])))
            if bucket
            else self.window_seconds
        )
        snapshot = {
            "limit_per_min": effective_limit,
            "used": len(bucket),
            "remaining": remaining,
            "window_seconds": self.window_seconds,
            "reset_in_seconds": reset_in,
        }
        return True, 0, snapshot


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Per-key / per-IP sliding window rate limiter returning HTTP 429 with Retry-After."""

    def __init__(
        self,
        app,
        requests_per_minute: int = 60,
        limiter: SlidingWindowRateLimiter | None = None,
    ):
        super().__init__(app)
        self.limiter = limiter or SlidingWindowRateLimiter(requests_per_minute=requests_per_minute)
        self.requests_per_minute = self.limiter.requests_per_minute
        self.buckets = self.limiter.buckets

    async def dispatch(self, request: Request, call_next):
        if request.url.path in EXEMPT_PATHS:
            return await call_next(request)

        allowed, retry_after, snapshot = self.limiter.check_and_record(request)
        request.state.rate_limit_snapshot = snapshot

        if not allowed:
            request_id = getattr(request.state, "request_id", "rate_limit")
            return JSONResponse(
                status_code=429,
                headers={"Retry-After": str(retry_after)},
                content={
                    "success": False,
                    "error": {
                        "code": "RATE_LIMIT_EXCEEDED",
                        "message": f"Rate limit exceeded ({snapshot['limit_per_min']} requests/minute). Retry after {retry_after}s.",
                        "request_id": request_id,
                    },
                },
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(snapshot["limit_per_min"])
        response.headers["X-RateLimit-Remaining"] = str(snapshot["remaining"])
        return response
