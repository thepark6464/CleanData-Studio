import datetime as dt
import re
from dataclasses import dataclass
from typing import Any, Literal

import phonenumbers
from email_validator import EmailNotValidError, validate_email

MISSING_TOKENS = {
    "",
    "na",
    "n/a",
    "null",
    "nan",
    "none",
    "unknown",
    "??",
    "-",
    "invalid-email",
    "not-a-date",
    "misc",
}

DEFAULT_PLACEHOLDER_TOKENS = [
    "n/a",
    "na",
    "null",
    "none",
    "nan",
    "unknown",
    "??",
    "-",
    "invalid-email",
    "not-a-date",
    "misc",
]

COUPON_EMPTY_TOKENS = {
    "",
    "none",
    "na",
    "n/a",
    "null",
    "nan",
    "nil",
    "no coupon",
    "no_coupon",
    "-",
}

ASCENDING_SEQUENTIAL = {
    "0123456",
    "1234567",
    "01234567",
    "12345678",
    "012345678",
    "123456789",
    "0123456789",
    "1234567890",
}

INTEGER_RE = re.compile(r"^[+-]?\d+$")
DECIMAL_RE = re.compile(r"^[+-]?(?:\d+\.\d+|\d+\.|\.\d+)$")
NUMERIC_VALUE_RE = re.compile(r"^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$")
BOOLEAN_VALUES = {"true", "false", "yes", "no", "1", "0", "y", "n"}
PHONE_LOOSE_RE = re.compile(r"^\+?[\d\s().-]{7,20}$")
E164_SAFE_RE = re.compile(r"^\+[1-9]\d{6,14}$")
MULTI_WS_RE = re.compile(r" {2,}|\t")

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

_PHONE_CACHE: dict[tuple[str, str, str], tuple[bool, str]] = {}


def is_missing_value(value: str) -> bool:
    return value.strip().lower() in MISSING_TOKENS


def is_placeholder_value(value: str, tokens: set[str] | list[str]) -> bool:
    norm = value.strip().lower()
    if not norm:
        return False
    return norm in tokens


def is_coupon_header(header: str) -> bool:
    return bool(re.search(r"coupon|promo|voucher", header, re.I))


def is_quantity_header(header: str) -> bool:
    h = header.strip().lower()
    return bool(
        re.match(r"^(qty|quantity|units|item_qty|order_qty)$", h)
        or re.search(r"\b(qty|quantity)\b", h)
    )


def is_price_header(header: str) -> bool:
    h = header.strip().lower()
    return bool(
        re.match(r"^(price|unit_price|item_price|mrp|unit_cost|selling_price)$", h)
        or re.search(r"\b(unit_price|item_price|price|mrp)\b", h)
    )


def default_numeric_rule_for_header(header: str) -> dict[str, Any] | None:
    if is_quantity_header(header):
        return {
            "mode": "positive_integer",
            "min": 1,
            "max": 1000,
            "sentinels": ["-99", "-999"],
        }
    if is_price_header(header):
        return {
            "mode": "positive_decimal",
            "min": 0.000001,
            "decimals": 2,
            "sentinels": ["-99", "-999"],
        }
    return None


def validate_numeric_value(raw: str, rule: dict[str, Any]) -> tuple[bool, str]:
    trimmed = raw.strip()
    if not trimmed:
        return False, raw

    sentinels = rule.get("sentinels") or ["-99", "-999"]
    if trimmed in sentinels:
        return False, raw

    if not NUMERIC_VALUE_RE.match(trimmed):
        return False, raw

    try:
        num = float(trimmed)
    except ValueError:
        return False, raw

    mode = str(rule.get("mode", "positive_decimal"))
    if mode in ("positive_integer", "integer"):
        if not num.is_integer():
            return False, raw
        if mode == "positive_integer" and num <= 0:
            return False, raw
    elif mode == "positive_decimal" and num <= 0:
        return False, raw
    elif mode == "non_negative_decimal" and num < 0:
        return False, raw

    min_val = rule.get("min")
    max_val = rule.get("max")
    if min_val is not None and num < float(min_val):
        return False, raw
    if max_val is not None and num > float(max_val):
        return False, raw

    if mode in ("positive_integer", "integer"):
        return True, str(int(num))

    decimals = rule.get("decimals")
    if decimals is None and mode == "positive_decimal":
        decimals = 2
    if decimals is not None:
        return True, f"{num:.{int(decimals)}f}"
    return True, trimmed


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


def is_junk_phone_digits(national_digits: str, region: str) -> bool:
    if not national_digits:
        return True
    if len(set(national_digits)) == 1:
        return True
    if national_digits in ASCENDING_SEQUENTIAL:
        return True
    if region.upper() == "IN" and len(national_digits) != 10:
        return True
    return False


def validate_and_format_phone(
    raw: str, region: str, output_format: str = "E.164"
) -> tuple[bool, str]:
    trimmed = raw.strip()
    if not trimmed:
        return False, raw
    cache_key = (region.upper(), output_format, trimmed)
    cached = _PHONE_CACHE.get(cache_key)
    if cached is not None:
        return cached

    try:
        parsed = phonenumbers.parse(trimmed, region.upper())
        if not phonenumbers.is_valid_number(parsed):
            res = (False, raw)
            if len(_PHONE_CACHE) < 25000:
                _PHONE_CACHE[cache_key] = res
            return res

        nat_digits = re.sub(r"\D", "", str(parsed.national_number or ""))
        detected_region = phonenumbers.region_code_for_number(parsed) or region.upper()
        if is_junk_phone_digits(nat_digits, detected_region):
            res = (False, raw)
            if len(_PHONE_CACHE) < 25000:
                _PHONE_CACHE[cache_key] = res
            return res

        if output_format == "INTERNATIONAL":
            fmt = phonenumbers.PhoneNumberFormat.INTERNATIONAL
        elif output_format == "NATIONAL":
            fmt = phonenumbers.PhoneNumberFormat.NATIONAL
        else:
            fmt = phonenumbers.PhoneNumberFormat.E164
        res = (True, phonenumbers.format_number(parsed, fmt))
        if len(_PHONE_CACHE) < 25000:
            _PHONE_CACHE[cache_key] = res
        return res
    except phonenumbers.NumberParseException:
        res = (False, raw)
        if len(_PHONE_CACHE) < 25000:
            _PHONE_CACHE[cache_key] = res
        return res


@dataclass
class ParsedDateResult:
    valid: bool
    ambiguous: bool
    formatted: str | None = None


def get_max_allowed_date_year() -> int:
    return max(2026, dt.datetime.now(dt.timezone.utc).year) + 1


def _is_valid_calendar_date(year: int, month: int, day: int) -> bool:
    if year < 1990 or year > get_max_allowed_date_year():
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
    if not t:
        return False
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

    if _looks_like_date_candidate(t) and (parse_date_value(t, True).valid or "date" in hint):
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
    whitespace_issues = 0
    counts = {
        "text": 0, "integer": 0, "decimal": 0, "date": 0,
        "email": 0, "phone": 0, "boolean": 0,
    }
    hint = header_name.lower()
    is_coupon_col = is_coupon_header(header_name)
    numeric_rule = default_numeric_rule_for_header(header_name)

    for val in values:
        if val != val.strip() or MULTI_WS_RE.search(val):
            whitespace_issues += 1
        trimmed = val.strip()
        if is_coupon_col and trimmed == "":
            continue
        if is_coupon_col and trimmed.lower() in COUPON_EMPTY_TOKENS:
            non_empty += 1
            counts["text"] += 1
            continue
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
            "detected_type": "text" if is_coupon_col else "empty",
            "non_empty_count": 0,
            "missing_count": missing,
            "invalid_count": 0,
            "ambiguous_date_count": 0,
            "type_inconsistent_count": 0,
            "whitespace_issue_count": whitespace_issues,
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
                if not E164_SAFE_RE.match(trimmed) or is_junk_phone_digits(trimmed[-10:], "IN"):
                    try:
                        p = phonenumbers.parse(trimmed, None)
                        nat = re.sub(r"\D", "", str(p.national_number or ""))
                        reg = phonenumbers.region_code_for_number(p) or "IN"
                        if not phonenumbers.is_valid_number(p) or is_junk_phone_digits(nat, reg):
                            invalid += 1
                    except phonenumbers.NumberParseException:
                        invalid += 1
            else:
                digits = re.sub(r"\D", "", trimmed)
                if len(digits) < 7 or len(digits) > 15 or is_junk_phone_digits(digits[-10:], "IN"):
                    invalid += 1
        type_inconsistent = invalid
    elif numeric_rule is not None:
        detected_type = "integer" if numeric_rule["mode"] == "positive_integer" else "decimal"
        invalid = sum(
            1
            for v in values
            if not is_missing_value(v) and not validate_numeric_value(v, numeric_rule)[0]
        )
        type_inconsistent = invalid
    elif is_coupon_col:
        detected_type = "text"
        invalid = sum(
            1
            for v in values
            if v.strip() != "" and v.strip().lower() in COUPON_EMPTY_TOKENS
        )
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
        "whitespace_issue_count": whitespace_issues,
    }


def is_cell_failing_validation(
    val: str,
    header_name: str,
    detected_type: str,
    numeric_rule: dict[str, Any] | None,
    formula_trigger: bool,
) -> bool:
    trimmed = val.strip()
    is_coupon_col = is_coupon_header(header_name)
    if is_coupon_col and trimmed == "":
        return val != ""
    if is_coupon_col and trimmed.lower() in COUPON_EMPTY_TOKENS:
        return True
    if is_missing_value(val):
        return True
    if val != trimmed or MULTI_WS_RE.search(val):
        return True
    if formula_trigger:
        return True
    if detected_type == "email":
        return not is_valid_email_syntax(val)
    if detected_type == "date":
        return not parse_date_value(val, True).valid
    if detected_type == "phone":
        if trimmed.startswith("+"):
            if not E164_SAFE_RE.match(trimmed) or is_junk_phone_digits(trimmed[-10:], "IN"):
                try:
                    p = phonenumbers.parse(trimmed, None)
                    nat = re.sub(r"\D", "", str(p.national_number or ""))
                    reg = phonenumbers.region_code_for_number(p) or "IN"
                    return (not phonenumbers.is_valid_number(p)) or is_junk_phone_digits(nat, reg)
                except phonenumbers.NumberParseException:
                    return True
            return False
        digits = re.sub(r"\D", "", trimmed)
        return len(digits) < 7 or len(digits) > 15 or is_junk_phone_digits(digits[-10:], "IN")
    if numeric_rule is not None:
        return not validate_numeric_value(val, numeric_rule)[0]
    return False
