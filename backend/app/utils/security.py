import base64
import hashlib
import hmac
import io
import json
import logging
import re
import time
import zipfile
from typing import Any

logger = logging.getLogger("cleandata.api")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


class ApiServiceError(Exception):
    """Structured API exception mapped to unified JSON error envelopes."""

    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def log_event(event: str, request_id: str, **meta: Any) -> None:
    """Emit structured JSON metadata logs. Never log raw row data, file contents, or secrets."""
    safe_meta = {
        k: v
        for k, v in meta.items()
        if k not in {"raw_rows", "file_bytes", "api_key", "secret", "authorization", "payload"}
    }
    payload = {"event": event, "request_id": request_id, **safe_meta}
    logger.info(json.dumps(payload, default=str))


def is_formula_trigger(value: str) -> bool:
    if not value:
        return False
    first = value[0]
    if first in ("=", "+", "@", "\t", "\r"):
        return True
    if first == "-":
        return not bool(re.match(r"^-?\d+(?:\.\d+)?$", value))
    return False


def escape_formula_cell(value: str, is_numeric_column: bool) -> tuple[str, bool]:
    if not value:
        return value, False
    first = value[0]
    if first in ("=", "+", "@", "\t", "\r"):
        return f"'{value}", True
    if first == "-":
        if is_numeric_column and re.match(r"^-?\d+(?:\.\d+)?$", value):
            return value, False
        return f"'{value}", True
    return value, False


def detect_binary_payload(data: bytes) -> str | None:
    if len(data) >= 4:
        if data[:4] == b"PK\x03\x04":
            return "ZIP/XLSX archive detected inside a .csv upload. Upload with .xlsx extension for spreadsheets."
        if data[:4] == b"%PDF":
            return "PDF document detected. Only CSV and XLSX files are supported."
        if data[:4] == b"\x89PNG":
            return "PNG image detected. Only CSV and XLSX files are supported."
        if data[:4] == b"\x7fELF":
            return "Binary executable detected. Only CSV and XLSX files are supported."
    if len(data) >= 3 and data[:3] == b"\xff\xd8\xff":
        return "JPEG image detected. Only CSV and XLSX files are supported."
    if len(data) >= 2 and data[:2] == b"\x1f\x8b":
        return "GZIP archive detected. Please decompress before uploading."
    if b"\x00" in data[:4096]:
        return "Binary NUL bytes detected. File does not appear to be plain-text CSV."
    return None


def validate_xlsx_zip_safety(
    data: bytes, max_uncompressed_bytes: int, max_entries: int
) -> None:
    """Protect against zip bombs and malformed OpenXML archives."""
    if not data.startswith(b"PK\x03\x04"):
        raise ApiServiceError(
            415,
            "MALFORMED_XLSX",
            "File extension is .xlsx, but bytes do not match an OpenXML ZIP signature.",
        )
    try:
        with zipfile.ZipFile(io.BytesIO(data), "r") as zf:
            infos = zf.infolist()
            if len(infos) > max_entries:
                raise ApiServiceError(
                    422,
                    "XLSX_TOO_MANY_ENTRIES",
                    f"XLSX archive contains {len(infos)} entries, exceeding safety limit ({max_entries}).",
                )
            total_uncompressed = sum(info.file_size for info in infos)
            if total_uncompressed > max_uncompressed_bytes:
                raise ApiServiceError(
                    413,
                    "XLSX_ZIP_BOMB_GUARD",
                    "Uncompressed XLSX size exceeds safety limit.",
                )
    except zipfile.BadZipFile as exc:
        raise ApiServiceError(422, "MALFORMED_XLSX", f"Corrupted XLSX archive: {exc}") from exc


def create_signed_download_token(
    job_id: str, secret: str, ttl_seconds: int
) -> tuple[str, int]:
    expires_at = int(time.time()) + ttl_seconds
    payload = f"{job_id}:{expires_at}".encode("utf-8")
    sig = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).digest()
    token = base64.urlsafe_b64encode(payload + b"." + sig).decode("ascii")
    return token, expires_at


def verify_signed_download_token(token: str, secret: str) -> str:
    try:
        decoded = base64.urlsafe_b64decode(token.encode("ascii"))
        payload_bytes, sig = decoded.rsplit(b".", 1)
        expected_sig = hmac.new(
            secret.encode("utf-8"), payload_bytes, hashlib.sha256
        ).digest()
        if not hmac.compare_digest(sig, expected_sig):
            raise ApiServiceError(403, "INVALID_SIGNATURE", "Download token signature is invalid.")
        job_id, expires_raw = payload_bytes.decode("utf-8").split(":", 1)
        if int(time.time()) > int(expires_raw):
            raise ApiServiceError(403, "DOWNLOAD_EXPIRED", "Signed download URL has expired.")
        return job_id
    except ApiServiceError:
        raise
    except Exception as exc:
        raise ApiServiceError(403, "INVALID_DOWNLOAD_TOKEN", "Malformed download token.") from exc
