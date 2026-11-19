import pandas as pd
from app.models import CleaningWarning
from app.services.validators.field_validators import is_missing_value, parse_date_value


def standardize_dates(
    df: pd.DataFrame,
    column_types: dict[str, str],
    columns: list[str] | None = None,
    day_first: bool = True,
    output_format: str = "YYYY-MM-DD",
) -> tuple[pd.DataFrame, int, str, list[CleaningWarning]]:
    out = df.copy()
    target_cols = (
        [c for c in (columns or []) if c in out.columns]
        or [c for c in out.columns if column_types.get(c) == "date"]
    )
    changed = 0
    ambiguous_resolved = 0
    unparseable = 0

    for col in target_cols:
        new_vals: list[str] = []
        for val in out[col].tolist():
            s = str(val)
            if is_missing_value(s):
                new_vals.append(s)
                continue
            parsed = parse_date_value(s, day_first=day_first, output_format=output_format)
            if not parsed.valid or not parsed.formatted:
                unparseable += 1
                new_vals.append(s)
                continue
            if parsed.ambiguous:
                ambiguous_resolved += 1
            if parsed.formatted != s:
                changed += 1
            new_vals.append(parsed.formatted)
        out[col] = new_vals

    warnings: list[CleaningWarning] = []
    if unparseable > 0:
        warnings.append(
            CleaningWarning(
                code="UNPARSEABLE_DATES_PRESERVED",
                severity="warning",
                message=f"{unparseable} date value(s) could not be parsed reliably and were left unchanged (never guessed).",
                count=unparseable,
            )
        )

    order_label = "day-first (DD/MM)" if day_first else "month-first (MM/DD)"
    details = (
        f"Standardized {changed} date cell(s) to {output_format} using {order_label} "
        f"({ambiguous_resolved} ambiguous date(s) resolved)."
    )
    return out, changed, details, warnings
