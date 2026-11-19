import pandas as pd
from app.models import CleaningWarning
from app.services.validators.field_validators import is_missing_value, validate_and_format_phone


def normalize_phone_numbers(
    df: pd.DataFrame,
    column_types: dict[str, str],
    columns: list[str] | None = None,
    default_region: str = "IN",
    output_format: str = "E.164",
) -> tuple[pd.DataFrame, int, str, list[CleaningWarning]]:
    out = df.copy()
    target_cols = (
        [c for c in (columns or []) if c in out.columns]
        or [c for c in out.columns if column_types.get(c) == "phone"]
    )
    changed = 0
    invalid_count = 0

    for col in target_cols:
        new_vals: list[str] = []
        for val in out[col].tolist():
            s = str(val)
            if is_missing_value(s):
                new_vals.append(s)
                continue
            valid, formatted = validate_and_format_phone(s, default_region, output_format)
            if not valid:
                invalid_count += 1
                new_vals.append(s)
                continue
            if formatted != s:
                changed += 1
            new_vals.append(formatted)
        out[col] = new_vals

    warnings: list[CleaningWarning] = []
    if invalid_count > 0:
        warnings.append(
            CleaningWarning(
                code="INVALID_PHONE_FORMAT",
                severity="warning",
                message=(
                    f"{invalid_count} phone value(s) could not be validated as valid {default_region} numbers "
                    "and were preserved untouched. Phone validation checks format only, never active line status."
                ),
                count=invalid_count,
            )
        )

    details = (
        f"Formatted {changed} phone number(s) using region {default_region} "
        f"({output_format}, format check only)."
    )
    return out, changed, details, warnings
