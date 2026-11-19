import datetime as dt
import json
import uuid
from typing import Any

from fastapi import APIRouter, File, Form, Header, Query, Request, UploadFile
from fastapi.responses import Response

from app.auth.jwt_auth import AuthenticatedUser, resolve_optional_user
from app.database import SupabaseServiceClient
from app.models import (
    CleanJobCreateResponse,
    JobListResponse,
    JobReportResponse,
    JobStatusResponse,
    OperationRequest,
    OutputFormat,
    SignedDownloadResponse,
)
from app.services.api_keys import ApiKeyService
from app.services.credits import CreditService, estimate_credits_for_rows
from app.services.pipeline import run_cleaning_pipeline
from app.services.storage import StoredJob
from app.services.validators.file_validator import parse_upload_bytes
from app.utils.security import (
    ApiServiceError,
    create_signed_download_token,
    log_event,
    verify_signed_download_token,
)

router = APIRouter(prefix="/v1", tags=["Cleaning Jobs"])

ALLOWED_OPERATION_IDS = {
    "remove_empty_rows",
    "remove_duplicates",
    "trim_whitespace",
    "normalize_text",
    "standardize_dates",
    "normalize_emails",
    "normalize_phone_numbers",
    "handle_missing_values",
    "rename_columns",
}


def _assert_job_access(job: StoredJob, user: AuthenticatedUser | None) -> None:
    if job.user_id and (not user or user.user_id != job.user_id):
        raise ApiServiceError(
            403,
            "FORBIDDEN",
            "You do not have permission to access this cleaning job.",
        )


def _parse_operations_input(raw_ops: str | None) -> list[OperationRequest]:
    if not raw_ops or not raw_ops.strip():
        return [
            OperationRequest(id="remove_empty_rows", enabled=True),
            OperationRequest(id="trim_whitespace", enabled=True, params={"collapseInternal": False}),
            OperationRequest(id="remove_duplicates", enabled=True, params={"keep": "first"}),
        ]

    stripped = raw_ops.strip()
    if stripped.startswith("["):
        try:
            loaded: list[dict[str, Any]] = json.loads(stripped)
            return [OperationRequest(**item) for item in loaded]
        except Exception as exc:
            raise ApiServiceError(
                422, "INVALID_OPERATIONS", f"Invalid JSON operations array: {exc}"
            ) from exc

    ops: list[OperationRequest] = []
    for token in stripped.split(","):
        op_id = token.strip()
        if not op_id:
            continue
        if op_id not in ALLOWED_OPERATION_IDS:
            raise ApiServiceError(
                422, "UNSUPPORTED_OPERATION", f"Unknown cleaning operation: '{op_id}'."
            )
        ops.append(OperationRequest(id=op_id, enabled=True))  # type: ignore[arg-type]
    return ops


def _build_signed_download_url(request: Request, job_id: str) -> tuple[str, int]:
    settings = request.app.state.settings
    token, _ = create_signed_download_token(
        job_id=job_id,
        secret=settings.download_signing_secret,
        ttl_seconds=settings.signed_url_ttl_seconds,
    )
    base_url = str(request.base_url).rstrip("/")
    return f"{base_url}/v1/downloads/{token}", settings.signed_url_ttl_seconds


def _to_job_status_response(request: Request, job: StoredJob) -> JobStatusResponse:
    download_url: str | None = None
    if job.status == "completed" and job.output_path and job.output_path.exists():
        download_url, _ = _build_signed_download_url(request, job.job_id)

    return JobStatusResponse(
        job_id=job.job_id,
        status=job.status,
        input_name=job.input_name,
        input_format=job.input_format,
        output_format=job.output_format,
        rows_processed=job.rows_processed,
        duplicates_removed=job.duplicates_removed,
        missing_values_found=job.missing_values_found,
        quality_score=job.quality_score,
        credits_reserved=job.credits_reserved,
        credits_charged=job.credits_charged,
        download_url=download_url,
        created_at=job.created_at.isoformat(),
        completed_at=job.completed_at.isoformat() if job.completed_at else None,
        error_code=job.error_code,
        error_message=job.error_message,
    )


@router.post("/clean", response_model=CleanJobCreateResponse)
async def create_clean_job(
    request: Request,
    file: UploadFile | None = File(default=None),
    file_id: str | None = Form(default=None),
    operations: str | None = Form(default=None),
    output_format: OutputFormat = Form(default="csv"),
    formula_protection: bool = Form(default=True),
    delimiter_override: str | None = Form(default=None),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> CleanJobCreateResponse:
    settings = request.app.state.settings
    storage = request.app.state.storage
    request_id = request.state.request_id
    user = await resolve_optional_user(request)
    owner_scope = user.user_id if user else "anon"
    scoped_idem = f"{owner_scope}:{idempotency_key}" if idempotency_key else None

    if scoped_idem and scoped_idem in storage.idempotency_index:
        existing_job_id = storage.idempotency_index[scoped_idem]
        existing_job = storage.jobs[existing_job_id]
        log_event("clean_job_idempotent_hit", request_id, job_id=existing_job_id)
        return CleanJobCreateResponse(
            job_id=existing_job.job_id,
            status=existing_job.status,
            message="Existing cleaning job returned for Idempotency-Key.",
        )

    if file is None and not file_id:
        raise ApiServiceError(
            400,
            "MISSING_INPUT",
            "Provide either a multipart 'file' upload or a valid 'file_id' from POST /v1/files/upload.",
        )

    if file is not None:
        raw_bytes = await file.read()
        filename = file.filename or "dataset.csv"
        _, input_path, input_expires_at = storage.save_input_bytes(
            raw_bytes, retention_hours=settings.input_retention_hours
        )
    else:
        assert file_id is not None
        upload = storage.uploads.get(file_id)
        if not upload or not upload.path.exists():
            raise ApiServiceError(404, "FILE_NOT_FOUND", f"Uploaded file '{file_id}' was not found or expired.")
        if upload.user_id and (not user or upload.user_id != user.user_id):
            raise ApiServiceError(403, "FORBIDDEN", "You do not have permission to access this uploaded file.")
        raw_bytes = upload.path.read_bytes()
        filename = upload.filename
        input_path = upload.path
        input_expires_at = upload.expires_at

    parsed_ops = _parse_operations_input(operations)
    parsed_dataset = parse_upload_bytes(
        raw_bytes, filename, settings, delimiter_override=delimiter_override
    )

    job_id = f"job_{uuid.uuid4().hex[:12]}"
    job = StoredJob(
        job_id=job_id,
        status="processing",
        input_name=parsed_dataset.filename,
        input_format="xlsx" if parsed_dataset.input_format == "xlsx" else "csv",
        output_format=output_format,
        input_path=input_path,
        output_path=None,
        user_id=user.user_id if user else None,
        idempotency_key=idempotency_key,
        input_expires_at=input_expires_at,
    )

    credit_service = CreditService(settings, request.app.state.credits)
    db = SupabaseServiceClient(settings)
    reserved_amount = 0

    if user:
        if db.configured:
            try:
                job.db_job_id = await db.record_cleaning_job(
                    user_id=user.user_id,
                    status="processing",
                    input_name=job.input_name,
                    input_format=job.input_format,
                    output_format=job.output_format,
                    input_path=input_path.name if input_path else None,
                    output_path=None,
                    operations=[op.model_dump() for op in parsed_ops],
                    rows_processed=len(parsed_dataset.df),
                    idempotency_key=idempotency_key,
                    input_expires_at=input_expires_at.isoformat() if input_expires_at else None,
                )
            except Exception as db_exc:
                log_event(
                    "supabase_job_init_warning",
                    request_id,
                    job_id=job_id,
                    error=type(db_exc).__name__,
                )

        estimated_credits = estimate_credits_for_rows(len(parsed_dataset.df))
        file_mb = parsed_dataset.byte_size / (1024 * 1024)
        reserved_amount = await credit_service.reserve_for_job(
            user_id=user.user_id,
            job_id=job_id,
            db_job_uuid=job.db_job_id,
            amount=estimated_credits,
            file_mb=file_mb,
            idempotency_key=idempotency_key,
        )
        job.credits_reserved = reserved_amount

    storage.jobs[job_id] = job
    if scoped_idem:
        storage.idempotency_index[scoped_idem] = job_id

    try:
        cleaned_df, output_bytes, report = run_cleaning_pipeline(
            dataset=parsed_dataset,
            operations=parsed_ops,
            job_id=job_id,
            output_format=output_format,
            formula_protection=formula_protection,
        )
        out_path, out_expires_at = storage.save_output_bytes(
            output_bytes, output_format=output_format, retention_days=settings.output_retention_days
        )
        job.output_path = out_path
        job.output_expires_at = out_expires_at
        job.status = "completed"
        job.rows_processed = len(parsed_dataset.df)
        job.duplicates_removed = report.duplicatesRemoved
        job.missing_values_found = report.missingValuesFound
        job.quality_score = report.qualityAfter.score
        job.report = report
        job.completed_at = dt.datetime.now(dt.timezone.utc)
        del cleaned_df

        if user:
            if reserved_amount > 0:
                charged = await credit_service.commit_for_job(
                    job_id=job_id, db_job_uuid=job.db_job_id
                )
                job.credits_charged = charged
            if db.configured and job.db_job_id:
                try:
                    await db.update_cleaning_job_result(
                        db_job_id=job.db_job_id,
                        status="completed",
                        output_path=out_path.name,
                        rows_processed=job.rows_processed,
                        completed_at=job.completed_at.isoformat(),
                        output_expires_at=out_expires_at.isoformat(),
                        quality_score=job.quality_score,
                        report_json=report.model_dump(),
                    )
                except Exception as db_exc:
                    log_event(
                        "supabase_job_persist_warning",
                        request_id,
                        job_id=job_id,
                        error=type(db_exc).__name__,
                    )
    except ApiServiceError as api_exc:
        job.status = "failed"
        job.error_code = api_exc.code
        job.error_message = api_exc.message
        if user and reserved_amount > 0:
            await credit_service.refund_for_job(job_id=job_id, db_job_uuid=job.db_job_id)
            job.credits_reserved = 0
            job.credits_charged = 0
        if user and db.configured and job.db_job_id:
            try:
                await db.update_cleaning_job_result(
                    db_job_id=job.db_job_id,
                    status="failed",
                    error_code=api_exc.code,
                    error_message=api_exc.message,
                )
            except Exception:
                pass
        raise
    except Exception as exc:
        job.status = "failed"
        job.error_code = "PROCESSING_FAILED"
        job.error_message = "Cleaning job failed safely during processing."
        if user and reserved_amount > 0:
            await credit_service.refund_for_job(job_id=job_id, db_job_uuid=job.db_job_id)
            job.credits_reserved = 0
            job.credits_charged = 0
        if user and db.configured and job.db_job_id:
            try:
                await db.update_cleaning_job_result(
                    db_job_id=job.db_job_id,
                    status="failed",
                    error_code=job.error_code,
                    error_message=job.error_message,
                )
            except Exception:
                pass
        log_event("clean_job_failed", request_id, job_id=job_id, error=type(exc).__name__)
        raise ApiServiceError(500, "PROCESSING_FAILED", job.error_message) from exc

    if user and user.auth_method == "api_key":
        key_service = ApiKeyService(
            settings, request.app.state.api_keys, request.app.state.credits
        )
        await key_service.record_usage(
            user_id=user.user_id,
            api_key_id=user.api_key_id,
            endpoint="/v1/clean",
            credits_used=job.credits_charged,
            status_code=200,
        )

    log_event(
        "clean_job_completed",
        request_id,
        job_id=job_id,
        user_id=user.user_id if user else None,
        rows_before=report.rowsBefore,
        rows_after=report.rowsAfter,
        output_format=output_format,
    )

    return CleanJobCreateResponse(
        job_id=job_id,
        status=job.status,
        message="Your cleaning job has completed.",
    )


@router.get("/jobs", response_model=JobListResponse)
async def list_jobs(
    request: Request,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> JobListResponse:
    storage = request.app.state.storage
    user = await resolve_optional_user(request)
    if user:
        visible_jobs = [j for j in storage.jobs.values() if j.user_id == user.user_id]
    else:
        visible_jobs = [j for j in storage.jobs.values() if j.user_id is None]
    all_jobs = sorted(visible_jobs, key=lambda j: j.created_at, reverse=True)
    page = all_jobs[offset : offset + limit]
    return JobListResponse(
        items=[_to_job_status_response(request, j) for j in page],
        total=len(all_jobs),
        limit=limit,
        offset=offset,
    )


@router.get("/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job_status(request: Request, job_id: str) -> JobStatusResponse:
    storage = request.app.state.storage
    user = await resolve_optional_user(request)
    job = storage.jobs.get(job_id)
    if not job:
        raise ApiServiceError(404, "JOB_NOT_FOUND", f"Cleaning job '{job_id}' not found.")
    _assert_job_access(job, user)
    return _to_job_status_response(request, job)


@router.get("/jobs/{job_id}/report", response_model=JobReportResponse)
async def get_job_report(request: Request, job_id: str) -> JobReportResponse:
    storage = request.app.state.storage
    user = await resolve_optional_user(request)
    job = storage.jobs.get(job_id)
    if not job:
        raise ApiServiceError(404, "REPORT_NOT_FOUND", f"Report for job '{job_id}' is not available.")
    _assert_job_access(job, user)
    if not job.report:
        raise ApiServiceError(404, "REPORT_NOT_FOUND", f"Report for job '{job_id}' is not available.")
    return JobReportResponse(job_id=job_id, report=job.report)


@router.get("/jobs/{job_id}/download", response_model=SignedDownloadResponse)
async def get_signed_download(request: Request, job_id: str) -> SignedDownloadResponse:
    storage = request.app.state.storage
    user = await resolve_optional_user(request)
    job = storage.jobs.get(job_id)
    if not job:
        raise ApiServiceError(404, "OUTPUT_NOT_FOUND", f"Cleaned output for job '{job_id}' is unavailable or expired.")
    _assert_job_access(job, user)
    if not job.output_path or not job.output_path.exists():
        raise ApiServiceError(404, "OUTPUT_NOT_FOUND", f"Cleaned output for job '{job_id}' is unavailable or expired.")

    signed_url, ttl = _build_signed_download_url(request, job_id)
    return SignedDownloadResponse(
        job_id=job_id,
        download_url=signed_url,
        expires_in_seconds=ttl,
        output_format=job.output_format,
    )


@router.get("/downloads/{token}")
async def download_signed_artifact(request: Request, token: str) -> Response:
    settings = request.app.state.settings
    storage = request.app.state.storage
    job_id = verify_signed_download_token(token, settings.download_signing_secret)
    job = storage.jobs.get(job_id)
    if not job or not job.output_path or not job.output_path.exists():
        raise ApiServiceError(404, "OUTPUT_NOT_FOUND", "Output artifact no longer exists.")

    content = job.output_path.read_bytes()
    base_name = job.input_name.rsplit(".", 1)[0] or "dataset"
    out_filename = f"cleaned_{base_name}.{job.output_format}"
    media_type = (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        if job.output_format == "xlsx"
        else "text/csv; charset=utf-8"
    )
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{out_filename}"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )
