import datetime as dt
import re
from dataclasses import dataclass
from typing import Literal

import phonenumbers
from email_validator import EmailNotValidError, validate_email

MISSING_TOKENS = {"", "na", "n/a", "null", "nan", "none"}

INTEGER_RE = re.compile(r"^[+-]?\d+$")
DECIMAL_RE = re.compile(r"^[+-]?(?:\d+\.\d+|\d+\.|\.\d+)$")
BOOLEAN_VALUES = {"true", "false", "yes", "no", "1", "0", "y", "n"}
PHONE_LOOSE_RE = re.compile(r"^\+?[\d\s().-]{7,20}$")

MONTH_NAMES = {
    "jan": 1, "january": 1,
    "feb": 2, "february": 2,
    "mar": 3, "march": 3,
    "apr": 4, "april": 4,
    "may": 5,
    "jun": 6, "june": 6,
    "jul": 7, "july": 7,
    "aug": 8, "august": 8,
    "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10,
    "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}

ColumnType = Literal[
    "text", "integer", "decimal", "date", "email", "phone", "boolean", "mixed", "empty"
]


def is_missing_value(value: str) -> bool:
    return value.strip().lower() in MISSING_TOKENS


def is_valid_email_syntax(value: str) -> bool:
    trimmed = value.strip()
    if not trimmed or len(trimmed) > 254 or ".." in trimmed:
        return False
    try:
        # check_deliverability=False strictly checks syntax and never claims mailbox exists
        validate_email(trimmed, check_deliverability=False)
        return True
    except EmailNotValidError:
        return False


def validate_and_format_phone(
    raw: str, region: str, output_format: str = "E.164"
) -> tuple[bool, str]:
    trimmed = raw.strip()
    if not trimmed:
        return False, raw
    try:
        parsed = phonenumbers.parse(trimmed, region.upper())
        if not phonenumbers.is_valid_number(parsed):
            return False, raw
        if output_format == "INTERNATIONAL":
            fmt = phonenumbers.PhoneNumberFormat.INTERNATIONAL
        elif output_format == "NATIONAL":
            fmt = phonenumbers.PhoneNumberFormat.NATIONAL
        else:
            fmt = phonenumbers.PhoneNumberFormat.E164
        return True, phonenumbers.format_number(parsed, fmt)
    except phonenumbers.NumberParseException:
        return False, raw


@dataclass
class ParsedDateResult:
    valid: bool
    ambiguous: bool
    formatted: str | None = None


def _is_valid_calendar_date(year: int, month: int, day: int) -> bool:
    if year < 1900 or year > 2100:
        return False
    try:
        dt.date(year, month, day)
        return True
    except ValueError:
        return False


def format_date_parts(year: int, month: int, day: int, output_format: str = "YYYY-MM-DD") -> str:
    if output_format == "DD/MM/YYYY":
        return f"{day:02d}/{month:02d}/{year:04d}"
    if output_format == "MM/DD/YYYY":
        return f"{month:02d}/{day:02d}/{year:04d}"
    return f"{year:04d}-{month:02d}-{day:02d}"


def parse_date_value(
    raw: str, day_first: bool, output_format: str = "YYYY-MM-DD"
) -> ParsedDateResult:
    trimmed = raw.strip()
    if not trimmed:
        return ParsedDateResult(valid=False, ambiguous=False)

    iso_match = re.match(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$", trimmed)
    if iso_match:
        y, m, d = int(iso_match.group(1)), int(iso_match.group(2)), int(iso_match.group(3))
        if _is_valid_calendar_date(y, m, d):
            return ParsedDateResult(
                valid=True, ambiguous=False, formatted=format_date_parts(y, m, d, output_format)
            )
        return ParsedDateResult(valid=False, ambiguous=False)

    slash_match = re.match(r"^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$", trimmed)
    if slash_match:
        first, second, year = int(slash_match.group(1)), int(slash_match.group(2)), int(slash_match.group(3))
        ambiguous = 1 <= first <= 12 and 1 <= second <= 12 and first != second
        if first > 12 and second <= 12:
            day, month = first, second
        elif second > 12 and first <= 12:
            month, day = first, second
        elif day_first:
            day, month = first, second
        else:
            month, day = first, second

        if _is_valid_calendar_date(year, month, day):
            return ParsedDateResult(
                valid=True, ambiguous=ambiguous, formatted=format_date_parts(year, month, day, output_format)
            )
        return ParsedDateResult(valid=False, ambiguous=False)

    dmy_text = re.match(r"^(\d{1,2})[\s-]+([A-Za-z]+)[\s,-]+(\d{4})$", trimmed)
    if dmy_text:
        day = int(dmy_text.group(1))
        month = MONTH_NAMES.get(dmy_text.group(2).lower())
        year = int(dmy_text.group(3))
        if month and _is_valid_calendar_date(year, month, day):
            return ParsedDateResult(
                valid=True, ambiguous=False, formatted=format_date_parts(year, month, day, output_format)
            )

    mdy_text = re.match(r"^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$", trimmed)
    if mdy_text:
        month = MONTH_NAMES.get(mdy_text.group(1).lower())
        day = int(mdy_text.group(2))
        year = int(mdy_text.group(3))
        if month and _is_valid_calendar_date(year, month, day):
            return ParsedDateResult(
                valid=True, ambiguous=False, formatted=format_date_parts(year, month, day, output_format)
            )

    return ParsedDateResult(valid=False, ambiguous=False)


def _looks_like_date_candidate(raw: str) -> bool:
    t = raw.strip()
    return bool(
        re.match(r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}", t)
        or re.match(r"^\d{1,2}[-/]\d{1,2}[-/]\d{4}$", t)
        or re.match(r"^\d{1,2}[\s-]+[A-Za-z]{3,9}[\s,-]+\d{4}$", t)
        or re.match(r"^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}$", t)
    )


def classify_cell_type(raw: str, header_hint: str = "") -> str:
    t = raw.strip()
    hint = header_hint.lower()

    if "@" in t or "email" in hint:
        if is_valid_email_syntax(t) or "@" in t:
            return "email"

    if parse_date_value(t, True).valid or ("date" in hint and _looks_like_date_candidate(t)):
        return "date"

    if INTEGER_RE.match(t):
        if any(k in hint for k in ("phone", "mobile", "tel")) and len(t) >= 7:
            return "phone"
        return "integer"

    if DECIMAL_RE.match(t):
        return "decimal"

    if t.lower() in BOOLEAN_VALUES and (
        any(k in hint for k in ("active", "is_", "flag", "bool"))
        or t.lower() in ("true", "false")
    ):
        return "boolean"

    if PHONE_LOOSE_RE.match(t):
        digits = re.sub(r"\D", "", t)
        if 7 <= len(digits) <= 15 and (
            any(ch in t for ch in ("+", "(", "-"))
            or any(k in hint for k in ("phone", "mobile", "tel"))
        ):
            return "phone"

    return "text"


def infer_column_stats(values: list[str], header_name: str) -> dict:
    non_empty = 0
    missing = 0
    invalid = 0
    ambiguous_dates = 0
    counts = {
        "text": 0, "integer": 0, "decimal": 0, "date": 0,
        "email": 0, "phone": 0, "boolean": 0,
    }
    hint = header_name.lower()

    for val in values:
        if is_missing_value(val):
            missing += 1
            continue
        non_empty += 1
        ctype = classify_cell_type(val, hint)
        counts[ctype] += 1
        if ctype == "date":
            parsed = parse_date_value(val, True)
            if not parsed.valid:
                invalid += 1
            elif parsed.ambiguous:
                ambiguous_dates += 1

    if non_empty == 0:
        return {
            "detected_type": "empty",
            "non_empty_count": 0,
            "missing_count": missing,
            "invalid_count": 0,
            "ambiguous_date_count": 0,
            "type_inconsistent_count": 0,
        }

    numeric_count = counts["integer"] + counts["decimal"]
    dominant_type = "text"
    dominant_count = counts["text"]

    for candidate in ("email", "date", "phone", "boolean", "integer", "decimal", "text"):
        if counts[candidate] > dominant_count:
            dominant_type = candidate
            dominant_count = counts[candidate]

    if counts["integer"] > 0 and counts["decimal"] > 0 and numeric_count >= dominant_count:
        dominant_type = "decimal"
        dominant_count = numeric_count

    ratio = dominant_count / non_empty
    detected_type = dominant_type
    type_inconsistent = non_empty - dominant_count

    if detected_type == "email" or ("email" in hint and counts["email"] > 0):
        detected_type = "email"
        invalid = sum(1 for v in values if not is_missing_value(v) and not is_valid_email_syntax(v))
        type_inconsistent = invalid
    elif detected_type == "date" or ("date" in hint and counts["date"] > 0):
        detected_type = "date"
        invalid = 0
        ambiguous_dates = 0
        for v in values:
            if is_missing_value(v):
                continue
            parsed = parse_date_value(v, True)
            if not parsed.valid:
                invalid += 1
            elif parsed.ambiguous:
                ambiguous_dates += 1
        type_inconsistent = invalid
    elif detected_type == "phone" or (
        any(k in hint for k in ("phone", "mobile", "tel")) and counts["phone"] > 0
    ):
        detected_type = "phone"
        invalid = 0
        for v in values:
            if is_missing_value(v):
                continue
            trimmed = v.strip()
            if trimmed.startswith("+"):
                try:
                    p = phonenumbers.parse(trimmed, None)
                    if not phonenumbers.is_valid_number(p):
                        invalid += 1
                except phonenumbers.NumberParseException:
                    invalid += 1
            else:
                digits = re.sub(r"\D", "", trimmed)
                if len(digits) < 7 or len(digits) > 15:
                    invalid += 1
        type_inconsistent = invalid
    elif ratio < 0.75:
        detected_type = "mixed"
        type_inconsistent = non_empty - dominant_count

    return {
        "detected_type": detected_type,
        "non_empty_count": non_empty,
        "missing_count": missing,
        "invalid_count": invalid,
        "ambiguous_date_count": ambiguous_dates,
        "type_inconsistent_count": type_inconsistent,
    }
