import uuid
from app.config import get_settings
from app.services.storage import LocalPrivateStorage
from app.utils.security import log_event


def run_retention_cleanup(storage: LocalPrivateStorage) -> dict[str, int]:
    """Delete expired input (>24h) and output (>7d) artifacts per retention policy."""
    request_id = f"cleanup_{uuid.uuid4().hex[:8]}"
    summary = storage.cleanup_expired()
    log_event("retention_cleanup_completed", request_id, **summary)
    return summary


if __name__ == "__main__":
    settings = get_settings()
    store = LocalPrivateStorage(settings.storage_dir)
    result = run_retention_cleanup(store)
    print(result)
