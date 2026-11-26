import pandas as pd
from app.models import CleaningIssue, CleaningWarning
from app.services.validators.field_validators import is_missing_value, is_valid_email_syntax


def normalize_emails(
    df: pd.DataFrame,
    column_types: dict[str, str],
    columns: list[str] | None = None,
    clear_invalid: bool = False,
    row_numbers: list[int] | None = None,
) -> tuple[pd.DataFrame, int, str, list[CleaningWarning], list[CleaningIssue]]:
    out = df.copy()
    target_cols = (
        [c for c in (columns or []) if c in out.columns]
        or [c for c in out.columns if column_types.get(c) == "email"]
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
                            rule_id="email_invalid_cleared",
                            severity="warning",
                        )
                    )
                    new_vals.append("")
                else:
                    new_vals.append(s)
                continue

            nxt = s.strip().lower()
            if not is_valid_email_syntax(nxt):
                invalid_count += 1
                if clear_invalid:
                    changed += 1
                    issues.append(
                        CleaningIssue(
                            row=rnum,
                            column=col_name,
                            original=s,
                            new="",
                            rule_id="email_invalid_cleared",
                            severity="warning",
                        )
                    )
                    new_vals.append("")
                else:
                    if nxt != s:
                        changed += 1
                    issues.append(
                        CleaningIssue(
                            row=rnum,
                            column=col_name,
                            original=s,
                            new=nxt,
                            rule_id="email_invalid_flagged",
                            severity="warning",
                        )
                    )
                    new_vals.append(nxt)
                continue

            if nxt != s:
                changed += 1
                issues.append(
                    CleaningIssue(
                        row=rnum,
                        column=col_name,
                        original=s,
                        new=nxt,
                        rule_id="email_normalized",
                        severity="info",
                    )
                )
            new_vals.append(nxt)
        out[col] = new_vals

    warnings: list[CleaningWarning] = []
    if invalid_count > 0:
        warnings.append(
            CleaningWarning(
                code="INVALID_EMAILS_CLEARED" if clear_invalid else "INVALID_EMAIL_SYNTAX_REMAINING",
                severity="warning",
                message=(
                    f"{invalid_count} invalid email value(s) failed syntax checks and were cleared to empty."
                    if clear_invalid
                    else (
                        f"{invalid_count} email value(s) still fail syntax checks after normalization. "
                        "Syntax validation never verifies mailbox existence."
                    )
                ),
                count=invalid_count,
            )
        )

    details = f"Normalized {changed} email cell(s) (trimmed & lowercased). Syntax checked only."
    return out, changed, details, warnings, issues
