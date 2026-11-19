import csv
import datetime as dt
import io
from dataclasses import dataclass

import openpyxl
import pandas as pd
from charset_normalizer import from_bytes

from app.config import Settings
from app.utils.security import ApiServiceError, detect_binary_payload, validate_xlsx_zip_safety

SUPPORTED_DELIMITERS = (",", ";", "\t", "|")


@dataclass
class ParsedDataset:
    filename: str
    input_format: str
    byte_size: int
    encoding: str
    delimiter: str
    headers: list[str]
    original_headers: list[str]
    normalized_headers_count: int
    df: pd.DataFrame


def decode_csv_bytes(data: bytes, max_bytes: int) -> tuple[str, str]:
    if len(data) == 0:
        raise ApiServiceError(422, "EMPTY_FILE", "The uploaded file is empty (0 bytes).")
    if len(data) > max_bytes:
        raise ApiServiceError(
            413,
            "FILE_TOO_LARGE",
            f"File exceeds maximum allowed upload size ({max_bytes // (1024 * 1024)} MB).",
        )

    binary_reason = detect_binary_payload(data)
    if binary_reason:
        raise ApiServiceError(415, "UNSUPPORTED_BINARY_FILE", binary_reason)

    if data.startswith(b"\xef\xbb\xbf"):
        try:
            return data[3:].decode("utf-8", errors="strict"), "UTF-8-BOM"
        except UnicodeDecodeError:
            return data[3:].decode("cp1252", errors="replace"), "Windows-1252 (with BOM)"

    try:
        return data.decode("utf-8", errors="strict"), "UTF-8"
    except UnicodeDecodeError:
        detected = from_bytes(data).best()
        if detected and detected.encoding:
            enc_name = "Windows-1252 / Latin-1" if detected.encoding.lower() in {"cp1252", "latin_1", "iso8859_1"} else detected.encoding
            return str(detected), enc_name
        return data.decode("cp1252", errors="replace"), "Windows-1252 / Latin-1"


def _count_delimiter_outside_quotes(line: str, delimiter: str) -> int:
    count = 0
    in_quotes = False
    i = 0
    while i < len(line):
        ch = line[i]
        if ch == '"':
            if in_quotes and i + 1 < len(line) and line[i + 1] == '"':
                i += 1
            else:
                in_quotes = not in_quotes
        elif ch == delimiter and not in_quotes:
            count += 1
        i += 1
    return count


def detect_delimiter(text: str) -> str:
    sample_lines = [line.strip() for line in text.splitlines() if line.strip()][:20]
    if not sample_lines:
        return ","

    best_delim = ","
    best_score = -1.0
    for delim in SUPPORTED_DELIMITERS:
        counts = [_count_delimiter_outside_quotes(line, delim) for line in sample_lines]
        if not any(c > 0 for c in counts) or counts[0] == 0:
            continue
        consistent = sum(1 for c in counts if c == counts[0])
        score = (consistent / len(counts)) * 100.0 + min(sum(counts), 200)
        if score > best_score:
            best_score = score
            best_delim = delim
    return best_delim


def normalize_header_names(raw_headers: list[str]) -> tuple[list[str], list[str], int]:
    seen: dict[str, int] = {}
    headers: list[str] = []
    original_headers: list[str] = []
    normalized_count = 0

    for idx, raw in enumerate(raw_headers):
        cleaned_raw = raw.lstrip("\ufeff")
        original_headers.append(cleaned_raw)
        base = cleaned_raw.strip()
        if not base:
            base = f"column_{idx + 1}"
            normalized_count += 1

        lower_key = base.lower()
        prev_count = seen.get(lower_key, 0)
        if prev_count == 0:
            seen[lower_key] = 1
            headers.append(base)
        else:
            next_count = prev_count + 1
            seen[lower_key] = next_count
            candidate = f"{base}_{next_count}"
            while candidate.lower() in seen:
                candidate = f"{candidate}_dup"
            seen[candidate.lower()] = 1
            headers.append(candidate)
            normalized_count += 1

    return headers, original_headers, normalized_count


def _has_unclosed_quotes(text: str) -> bool:
    in_quotes = False
    i = 0
    while i < len(text):
        if text[i] == '"':
            if in_quotes and i + 1 < len(text) and text[i + 1] == '"':
                i += 1
            else:
                in_quotes = not in_quotes
        i += 1
    return in_quotes


def _cell_to_str(val: object) -> str:
    if val is None:
        return ""
    if isinstance(val, dt.datetime):
        return val.date().isoformat()
    if isinstance(val, dt.date):
        return val.isoformat()
    if isinstance(val, bool):
        return "true" if val else "false"
    return str(val)


def parse_upload_bytes(
    data: bytes, filename: str, settings: Settings, delimiter_override: str | None = None
) -> ParsedDataset:
    lower_name = (filename or "").lower()
    if lower_name.endswith(".xlsx"):
        if len(data) == 0:
            raise ApiServiceError(422, "EMPTY_FILE", "The uploaded XLSX workbook is empty.")
        if len(data) > settings.max_upload_bytes:
            raise ApiServiceError(
                413,
                "FILE_TOO_LARGE",
                f"Workbook exceeds maximum size ({settings.max_upload_mb_default} MB).",
            )
        validate_xlsx_zip_safety(
            data, settings.xlsx_max_uncompressed_bytes, settings.xlsx_max_entries
        )
        try:
            # read_only=True, data_only=True prevents formula evaluation and macro execution
            wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
            ws = wb.active
            if ws is None:
                raise ApiServiceError(422, "EMPTY_FILE", "Workbook has no active worksheet.")
            raw_rows = [[_cell_to_str(cell) for cell in row] for row in ws.iter_rows(values_only=True)]
            wb.close()
        except ApiServiceError:
            raise
        except Exception as exc:
            raise ApiServiceError(422, "MALFORMED_XLSX", f"Failed to parse XLSX: {exc}") from exc

        if not raw_rows:
            raise ApiServiceError(422, "NO_HEADERS", "Worksheet has no header row.")
        headers, orig_headers, norm_count = normalize_header_names(raw_rows[0])
        data_rows = raw_rows[1:]
        if len(data_rows) > settings.max_rows_default:
            raise ApiServiceError(
                413, "TOO_MANY_ROWS", f"Row count exceeds server limit ({settings.max_rows_default})."
            )
        col_count = len(headers)
        padded = [
            [row[i] if i < len(row) else "" for i in range(col_count)]
            for row in data_rows
        ]
        df = pd.DataFrame(padded, columns=headers, dtype=str)
        return ParsedDataset(
            filename=filename,
            input_format="xlsx",
            byte_size=len(data),
            encoding="XLSX OpenXML (data_only)",
            delimiter=",",
            headers=headers,
            original_headers=orig_headers,
            normalized_headers_count=norm_count,
            df=df,
        )

    # CSV path
    text, encoding = decode_csv_bytes(data, settings.max_upload_bytes)
    if not text.strip():
        raise ApiServiceError(422, "EMPTY_FILE", "CSV contains only whitespace and no headers.")
    if _has_unclosed_quotes(text):
        raise ApiServiceError(422, "MALFORMED_CSV", "Malformed CSV: unclosed double-quote detected.")

    delimiter = delimiter_override or detect_delimiter(text)
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter, quotechar='"')
    raw_rows = list(reader)
    if not raw_rows:
        raise ApiServiceError(422, "NO_HEADERS", "No header row found.")

    raw_headers = raw_rows[0]
    if len(raw_headers) == 0 or (len(raw_headers) == 1 and raw_headers[0].strip() == "" and len(raw_rows) == 1):
        raise ApiServiceError(422, "NO_HEADERS", "Header row is empty.")

    headers, orig_headers, norm_count = normalize_header_names(raw_headers)
    data_rows = raw_rows[1:]
    if len(data_rows) > settings.max_rows_default:
        raise ApiServiceError(
            413, "TOO_MANY_ROWS", f"Row count exceeds server limit ({settings.max_rows_default})."
        )

    col_count = len(headers)
    padded = [
        [row[i] if i < len(row) else "" for i in range(col_count)]
        for row in data_rows
    ]
    df = pd.DataFrame(padded, columns=headers, dtype=str)
    return ParsedDataset(
        filename=filename or "upload.csv",
        input_format="csv",
        byte_size=len(data),
        encoding=encoding,
        delimiter=delimiter,
        headers=headers,
        original_headers=orig_headers,
        normalized_headers_count=norm_count,
        df=df,
    )
