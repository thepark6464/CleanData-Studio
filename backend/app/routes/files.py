import datetime as dt
from fastapi import APIRouter, File, Request, UploadFile

from app.auth.jwt_auth import resolve_optional_user
from app.models import FileUploadResponse
from app.services.storage import StoredUpload
from app.services.validators.file_validator import parse_upload_bytes
from app.utils.security import ApiServiceError, log_event

router = APIRouter(prefix="/v1", tags=["Files"])


@router.post("/files/upload", response_model=FileUploadResponse)
async def upload_file(request: Request, file: UploadFile = File(...)) -> FileUploadResponse:
    settings = request.app.state.settings
    storage = request.app.state.storage
    request_id = request.state.request_id
    user = await resolve_optional_user(request)

    raw_bytes = await file.read()
    filename = file.filename or "upload.csv"
    parsed = parse_upload_bytes(raw_bytes, filename, settings)

    file_id, path, expires_at = storage.save_input_bytes(
        raw_bytes, retention_hours=settings.input_retention_hours
    )

    upload = StoredUpload(
        file_id=file_id,
        filename=parsed.filename,
        input_format="xlsx" if parsed.input_format == "xlsx" else "csv",
        path=path,
        byte_size=parsed.byte_size,
        encoding=parsed.encoding,
        delimiter=parsed.delimiter,
        row_count=len(parsed.df),
        column_count=len(parsed.headers),
        headers=parsed.headers,
        created_at=dt.datetime.now(dt.timezone.utc),
        expires_at=expires_at,
        user_id=user.user_id if user else None,
    )
    storage.uploads[file_id] = upload

    log_event(
        "file_uploaded",
        request_id,
        file_id=file_id,
        input_format=upload.input_format,
        byte_size=upload.byte_size,
        row_count=upload.row_count,
    )

    return FileUploadResponse(
        file_id=file_id,
        filename=upload.filename,
        input_format=upload.input_format,
        byte_size=upload.byte_size,
        encoding=upload.encoding,
        delimiter=upload.delimiter,
        row_count=upload.row_count,
        column_count=upload.column_count,
        headers=upload.headers,
        expires_at=expires_at.isoformat(),
    )
