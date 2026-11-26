import pandas as pd

from app.models import CleaningIssue
from app.services.validators.field_validators import (
    DEFAULT_PLACEHOLDER_TOKENS,
    is_placeholder_value,
)


def placeholder_to_null(
    df: pd.DataFrame,
    columns: list[str] | None = None,
    tokens: list[str] | None = None,
    exclude_columns: list[str] | None = None,
    row_numbers: list[int] | None = None,
) -> tuple[pd.DataFrame, int, str, list[CleaningIssue]]:
    out = df.copy()
    excluded = set(exclude_columns or [])
    if columns:
        target_cols = [c for c in columns if c in out.columns and c not in excluded]
    else:
        target_cols = [c for c in out.columns if c not in excluded]

    token_set = {
        t.strip().lower()
        for t in (tokens if tokens else DEFAULT_PLACEHOLDER_TOKENS)
        if t.strip()
    }
    row_nums = row_numbers if row_numbers is not None else list(range(1, len(out) + 1))

    changed = 0
    issues: list[CleaningIssue] = []

    for col in target_cols:
        col_name = str(col)
        new_vals: list[str] = []
        for idx, val in enumerate(out[col].tolist()):
            s = str(val)
            trimmed = s.strip()
            if trimmed == "":
                new_vals.append(s)
                continue
            if is_placeholder_value(trimmed, token_set):
                changed += 1
                issues.append(
                    CleaningIssue(
                        row=row_nums[idx] if idx < len(row_nums) else idx + 1,
                        column=col_name,
                        original=s,
                        new="",
                        rule_id="placeholder_to_null",
                        severity="warning",
                    )
                )
                new_vals.append("")
            else:
                new_vals.append(s)
        out[col] = new_vals

    details = (
        f"Converted {changed} placeholder token(s) to empty null values."
        if changed > 0
        else "No placeholder tokens detected."
    )
    return out, changed, details, issues
