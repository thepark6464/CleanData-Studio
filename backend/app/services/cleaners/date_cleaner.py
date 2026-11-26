import pandas as pd
from app.models import CleaningIssue, CleaningWarning
from app.services.validators.field_validators import is_missing_value, parse_date_value


def standardize_dates(
    df: pd.DataFrame,
    column_types: dict[str, str],
    columns: list[str] | None = None,
    day_first: bool = True,
    output_format: str = "YYYY-MM-DD",
    clear_invalid: bool = False,
    row_numbers: list[int] | None = None,
) -> tuple[pd.DataFrame, int, str, list[CleaningWarning], list[CleaningIssue]]:
    out = df.copy()
    target_cols = (
        [c for c in (columns or []) if c in out.columns]
        or [c for c in out.columns if column_types.get(c) == "date"]
    )
    row_nums = row_numbers if row_numbers is not None else list(range(1, len(out) + 1))
    changed = 0
    ambiguous_resolved = 0
    unparseable = 0
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
                    unparseable += 1
                    changed += 1
                    issues.append(
                        CleaningIssue(
                            row=rnum,
                            column=col_name,
                            original=s,
                            new="",
                            rule_id="date_invalid_cleared",
                            severity="warning",
                        )
                    )
                    new_vals.append("")
                else:
                    new_vals.append(s)
                continue

            parsed = parse_date_value(s, day_first=day_first, output_format=output_format)
            if not parsed.valid or not parsed.formatted:
                unparseable += 1
                if clear_invalid:
                    changed += 1
                    issues.append(
                        CleaningIssue(
                            row=rnum,
                            column=col_name,
                            original=s,
                            new="",
                            rule_id="date_invalid_cleared",
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
                            rule_id="date_invalid_flagged",
                            severity="warning",
                        )
                    )
                    new_vals.append(s)
                continue

            if parsed.ambiguous:
                ambiguous_resolved += 1
            if parsed.formatted != s:
                changed += 1
                issues.append(
                    CleaningIssue(
                        row=rnum,
                        column=col_name,
                        original=s,
                        new=parsed.formatted,
                        rule_id="date_standardized",
                        severity="info",
                    )
                )
            new_vals.append(parsed.formatted)
        out[col] = new_vals

    warnings: list[CleaningWarning] = []
    if unparseable > 0:
        warnings.append(
            CleaningWarning(
                code="INVALID_DATES_CLEARED" if clear_invalid else "UNPARSEABLE_DATES_PRESERVED",
                severity="warning",
                message=(
                    f"{unparseable} invalid/out-of-range date value(s) could not be parsed reliably and were cleared to empty (never guessed)."
                    if clear_invalid
                    else f"{unparseable} date value(s) could not be parsed reliably and were left unchanged (never guessed)."
                ),
                count=unparseable,
            )
        )

    order_label = "day-first (DD/MM)" if day_first else "month-first (MM/DD)"
    details = (
        f"Standardized {changed} date cell(s) to {output_format} using {order_label} "
        f"({ambiguous_resolved} ambiguous date(s) resolved)."
    )
    return out, changed, details, warnings, issues
