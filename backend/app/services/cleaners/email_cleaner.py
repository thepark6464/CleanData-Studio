import pandas as pd
from app.models import CleaningWarning
from app.services.validators.field_validators import is_missing_value, is_valid_email_syntax


def normalize_emails(
    df: pd.DataFrame,
    column_types: dict[str, str],
    columns: list[str] | None = None,
) -> tuple[pd.DataFrame, int, str, list[CleaningWarning]]:
    out = df.copy()
    target_cols = (
        [c for c in (columns or []) if c in out.columns]
        or [c for c in out.columns if column_types.get(c) == "email"]
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
            nxt = s.strip().lower()
            if not is_valid_email_syntax(nxt):
                invalid_count += 1
            if nxt != s:
                changed += 1
            new_vals.append(nxt)
        out[col] = new_vals

    warnings: list[CleaningWarning] = []
    if invalid_count > 0:
        warnings.append(
            CleaningWarning(
                code="INVALID_EMAIL_SYNTAX_REMAINING",
                severity="warning",
                message=(
                    f"{invalid_count} email value(s) still fail syntax checks after normalization. "
                    "Syntax validation never verifies mailbox existence."
                ),
                count=invalid_count,
            )
        )

    details = f"Normalized {changed} email cell(s) (trimmed & lowercased). Syntax checked only."
    return out, changed, details, warnings
