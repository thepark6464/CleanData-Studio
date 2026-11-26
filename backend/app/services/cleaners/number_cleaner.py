from typing import Any
import pandas as pd

from app.models import CleaningIssue, CleaningWarning
from app.services.validators.field_validators import (
    default_numeric_rule_for_header,
    is_quantity_header,
    validate_numeric_value,
)


def validate_numbers(
    df: pd.DataFrame,
    column_types: dict[str, str],
    columns: list[str] | None = None,
    rules: dict[str, dict[str, Any]] | None = None,
    default_max_quantity: int = 1000,
    clear_invalid: bool = True,
    row_numbers: list[int] | None = None,
) -> tuple[pd.DataFrame, int, str, list[CleaningWarning], list[CleaningIssue]]:
    out = df.copy()
    rules = rules or {}
    explicit_set = set(columns) if columns else None

    col_rules: dict[str, dict[str, Any]] = {}
    for col in out.columns:
        col_name = str(col)
        if explicit_set is not None and col_name not in explicit_set and col_name not in rules:
            continue
        rule = rules.get(col_name) or default_numeric_rule_for_header(col_name)
        if rule is None and explicit_set is not None and col_name in explicit_set:
            ctype = column_types.get(col_name)
            if ctype == "integer":
                rule = {
                    "mode": "positive_integer",
                    "min": 1,
                    "max": default_max_quantity,
                    "sentinels": ["-99", "-999"],
                }
            else:
                rule = {
                    "mode": "positive_decimal",
                    "min": 0.000001,
                    "decimals": 2,
                    "sentinels": ["-99", "-999"],
                }
        if rule is not None:
            rule_copy = dict(rule)
            if is_quantity_header(col_name) and col_name not in rules:
                rule_copy["max"] = default_max_quantity
            col_rules[col_name] = rule_copy

    row_nums = row_numbers if row_numbers is not None else list(range(1, len(out) + 1))
    changed = 0
    invalid_count = 0
    issues: list[CleaningIssue] = []

    for col_name, rule in col_rules.items():
        new_vals: list[str] = []
        for idx, val in enumerate(out[col_name].tolist()):
            s = str(val)
            if s.strip() == "":
                new_vals.append(s)
                continue
            rnum = row_nums[idx] if idx < len(row_nums) else idx + 1
            valid, formatted = validate_numeric_value(s, rule)
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
                            rule_id="numeric_invalid_cleared",
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
                            rule_id="numeric_invalid_flagged",
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
                        rule_id="numeric_normalized",
                        severity="info",
                    )
                )
            new_vals.append(formatted)
        out[col_name] = new_vals

    warnings: list[CleaningWarning] = []
    if invalid_count > 0:
        warnings.append(
            CleaningWarning(
                code="INVALID_NUMERIC_VALUES",
                severity="warning",
                message=(
                    f"{invalid_count} invalid/out-of-range numeric cell(s) were cleared to empty (never auto-filled)."
                    if clear_invalid
                    else f"{invalid_count} invalid/out-of-range numeric cell(s) were flagged."
                ),
                count=invalid_count,
            )
        )

    details = (
        f"Validated numeric fields across {len(col_rules)} column(s); "
        f"{changed} cell(s) updated ({invalid_count} invalid)."
    )
    return out, changed, details, warnings, issues
