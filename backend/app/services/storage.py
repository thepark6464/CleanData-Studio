import datetime as dt
import os
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from app.models import CleaningReport, InputFormat, JobStatus, OutputFormat


@dataclass
class StoredUpload:
    file_id: str
    filename: str
    input_format: InputFormat
    path: Path
    byte_size: int
    encoding: str
    delimiter: str
    row_count: int
    column_count: int
    headers: list[str]
    created_at: dt.datetime
    expires_at: dt.datetime
    user_id: str | None = None


@dataclass
class StoredJob:
    job_id: str
    status: JobStatus
    input_name: str
    input_format: InputFormat
    output_format: OutputFormat
    input_path: Path | None
    output_path: Path | None
    user_id: str | None = None
    db_job_id: str | None = None
    credits_reserved: int = 0
    credits_charged: int = 0
    rows_processed: int = 0
    duplicates_removed: int = 0
    missing_values_found: int = 0
    quality_score: float | None = None
    report: CleaningReport | None = None
    error_code: str | None = None
    error_message: str | None = None
    idempotency_key: str | None = None
    created_at: dt.datetime = field(default_factory=lambda: dt.datetime.now(dt.timezone.utc))
    completed_at: dt.datetime | None = None
    input_expires_at: dt.datetime | None = None
    output_expires_at: dt.datetime | None = None


class LocalPrivateStorage:
    """Private UUID-keyed filesystem storage + in-memory job registry (replaced by Supabase in Phase 4)."""

    def __init__(self, base_dir: str):
        self.base_path = Path(base_dir)
        self.inputs_dir = self.base_path / "inputs"
        self.outputs_dir = self.base_path / "outputs"
        self.inputs_dir.mkdir(parents=True, exist_ok=True)
        self.outputs_dir.mkdir(parents=True, exist_ok=True)

        self.uploads: dict[str, StoredUpload] = {}
        self.jobs: dict[str, StoredJob] = {}
        self.idempotency_index: dict[str, str] = {}

    def save_input_bytes(self, data: bytes, retention_hours: int) -> tuple[str, Path, dt.datetime]:
        file_id = f"file_{uuid.uuid4().hex}"
        object_name = f"{uuid.uuid4().hex}.bin"
        dest = self.inputs_dir / object_name
        dest.write_bytes(data)
        expires_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=retention_hours)
        return file_id, dest, expires_at

    def save_output_bytes(
        self, data: bytes, output_format: OutputFormat, retention_days: int
    ) -> tuple[Path, dt.datetime]:
        object_name = f"{uuid.uuid4().hex}.{output_format}"
        dest = self.outputs_dir / object_name
        dest.write_bytes(data)
        expires_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=retention_days)
        return dest, expires_at

    def cleanup_expired(self) -> dict[str, int]:
        now = dt.datetime.now(dt.timezone.utc)
        deleted_inputs = 0
        deleted_outputs = 0

        for file_id, upload in list(self.uploads.items()):
            if upload.expires_at <= now:
                if upload.path.exists():
                    os.remove(upload.path)
                    deleted_inputs += 1
                del self.uploads[file_id]

        for job in self.jobs.values():
            if job.input_path and job.input_expires_at and job.input_expires_at <= now:
                if job.input_path.exists():
                    os.remove(job.input_path)
                    deleted_inputs += 1
                job.input_path = None
            if job.output_path and job.output_expires_at and job.output_expires_at <= now:
                if job.output_path.exists():
                    os.remove(job.output_path)
                    deleted_outputs += 1
                job.output_path = None
                job.status = "expired"

        return {"deleted_inputs": deleted_inputs, "deleted_outputs": deleted_outputs}
