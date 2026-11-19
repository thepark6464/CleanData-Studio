import hashlib
import time
from collections import defaultdict, deque
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Per-key / per-IP sliding window rate limiter returning HTTP 429 with Retry-After."""

    def __init__(self, app, requests_per_minute: int = 60):
        super().__init__(app)
        self.requests_per_minute = max(1, requests_per_minute)
        self.buckets: dict[str, deque[float]] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next):
        if request.url.path in ("/health", "/health/metrics", "/docs", "/openapi.json"):
            return await call_next(request)

        auth_header = request.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer ") and len(auth_header) > 15:
            token_digest = hashlib.sha256(auth_header[7:].encode("utf-8")).hexdigest()[:16]
            identity = f"tok:{token_digest}"
        else:
            client_ip = request.client.host if request.client else "unknown"
            identity = f"ip:{client_ip}"

        now = time.monotonic()
        window_start = now - 60.0
        bucket = self.buckets[identity]

        while bucket and bucket[0] < window_start:
            bucket.popleft()

        effective_limit = self.requests_per_minute
        if len(bucket) >= effective_limit:
            retry_after = max(1, int(60 - (now - bucket[0])))
            request_id = getattr(request.state, "request_id", "rate_limit")
            return JSONResponse(
                status_code=429,
                headers={"Retry-After": str(retry_after)},
                content={
                    "success": False,
                    "error": {
                        "code": "RATE_LIMIT_EXCEEDED",
                        "message": f"Rate limit exceeded ({effective_limit} requests/minute). Retry after {retry_after}s.",
                        "request_id": request_id,
                    },
                },
            )

        bucket.append(now)
        response = await call_next(request)
        remaining = max(0, effective_limit - len(bucket))
        response.headers["X-RateLimit-Limit"] = str(effective_limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response
