import pandas as pd
from app.models import CleaningIssue, CleaningWarning
from app.services.validators.field_validators import is_missing_value, validate_and_format_phone


def normalize_phone_numbers(
    df: pd.DataFrame,
    column_types: dict[str, str],
    columns: list[str] | None = None,
    default_region: str = "IN",
    output_format: str = "E.164",
    clear_invalid: bool = False,
    row_numbers: list[int] | None = None,
) -> tuple[pd.DataFrame, int, str, list[CleaningWarning], list[CleaningIssue]]:
    out = df.copy()
    target_cols = (
        [c for c in (columns or []) if c in out.columns]
        or [c for c in out.columns if column_types.get(c) == "phone"]
    )
    row_nums = row_numbers if row_numbers is not None else list(range(1, len(out) + 1))
    changed = 0
    invalid_count = 0
    issues: list[CleaningIssue] = []

    for col in target_cols:
        col_name = str(col)
        new_vals: list[str] = []
        for idx, val in enumerate(out[col].tolist()):
            s = str(val)
            if s.strip() == "":
                new_vals.append(s)
                continue
            rnum = row_nums[idx] if idx < len(row_nums) else idx + 1
            if is_missing_value(s):
                if clear_invalid and s != "":
                    invalid_count += 1
                    changed += 1
                    issues.append(
                        CleaningIssue(
                            row=rnum,
                            column=col_name,
                            original=s,
                            new="",
                            rule_id="phone_invalid_cleared",
                            severity="warning",
                        )
                    )
                    new_vals.append("")
                else:
                    new_vals.append(s)
                continue

            valid, formatted = validate_and_format_phone(s, default_region, output_format)
            if not valid:
                invalid_count += 1
                if clear_invalid:
                    changed += 1
                    issues.append(
                        CleaningIssue(
                            row=rnum,
                            column=col_name,
                            original=s,
                            new="",
                            rule_id="phone_invalid_cleared",
                            severity="warning",
                        )
                    )
                    new_vals.append("")
                else:
                    issues.append(
                        CleaningIssue(
                            row=rnum,
                            column=col_name,
                            original=s,
                            new=s,
                            rule_id="phone_invalid_flagged",
                            severity="warning",
                        )
                    )
                    new_vals.append(s)
                continue

            if formatted != s:
                changed += 1
                issues.append(
                    CleaningIssue(
                        row=rnum,
                        column=col_name,
                        original=s,
                        new=formatted,
                        rule_id="phone_normalized",
                        severity="info",
                    )
                )
            new_vals.append(formatted)
        out[col] = new_vals

    warnings: list[CleaningWarning] = []
    if invalid_count > 0:
        warnings.append(
            CleaningWarning(
                code="INVALID_PHONE_FORMAT",
                severity="warning",
                message=(
                    f"{invalid_count} invalid/junk phone value(s) failed {default_region} format checks and were cleared to empty."
                    if clear_invalid
                    else (
                        f"{invalid_count} phone value(s) could not be validated as valid {default_region} numbers "
                        "and were preserved untouched. Phone validation checks format only, never active line status."
                    )
                ),
                count=invalid_count,
            )
        )

    details = (
        f"Formatted {changed} phone number(s) using region {default_region} "
        f"({output_format}, format check only)."
    )
    return out, changed, details, warnings, issues
