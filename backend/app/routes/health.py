import time
from fastapi import APIRouter, Request

router = APIRouter(tags=["Health"])
_START_TIME = time.monotonic()


@router.get("/health")
async def health_check(request: Request) -> dict:
    settings = request.app.state.settings
    return {
        "status": "ok",
        "service": "cleandata-api",
        "version": "1.0.0",
        "auth": {
            "jwks_configured": bool(settings.resolved_supabase_url),
            "legacy_hs256_configured": bool(settings.resolved_supabase_jwt_secret),
        },
    }


@router.get("/health/metrics")
async def service_metrics(request: Request) -> dict:
    storage = request.app.state.storage
    jobs = list(storage.jobs.values())
    completed = sum(1 for j in jobs if j.status == "completed")
    failed = sum(1 for j in jobs if j.status == "failed")
    return {
        "service": "cleandata-api",
        "uptime_seconds": round(time.monotonic() - _START_TIME, 2),
        "jobs_total": len(jobs),
        "jobs_completed": completed,
        "jobs_failed": failed,
        "active_uploads": len(storage.uploads),
    }
