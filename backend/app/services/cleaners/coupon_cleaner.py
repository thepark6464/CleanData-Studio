import re
import pandas as pd

from app.models import CleaningIssue
from app.services.validators.field_validators import (
    COUPON_EMPTY_TOKENS,
    is_coupon_header,
)


def canonicalize_coupons(
    df: pd.DataFrame,
    columns: list[str] | None = None,
    empty_tokens: list[str] | None = None,
    case_mode: str = "upper",
    row_numbers: list[int] | None = None,
) -> tuple[pd.DataFrame, int, str, list[CleaningIssue]]:
    out = df.copy()
    if columns:
        target_cols = [c for c in columns if c in out.columns]
    else:
        target_cols = [c for c in out.columns if is_coupon_header(str(c))]

    empty_set = (
        {t.strip().lower() for t in empty_tokens if t is not None}
        if empty_tokens
        else COUPON_EMPTY_TOKENS
    )
    row_nums = row_numbers if row_numbers is not None else list(range(1, len(out) + 1))

    changed = 0
    issues: list[CleaningIssue] = []

    for col in target_cols:
        col_name = str(col)
        new_vals: list[str] = []
        for idx, val in enumerate(out[col].tolist()):
            s = str(val)
            trimmed = re.sub(r"[ \t]+", " ", s.strip())
            rnum = row_nums[idx] if idx < len(row_nums) else idx + 1
            if trimmed == "":
                if s != "":
                    changed += 1
                    issues.append(
                        CleaningIssue(
                            row=rnum,
                            column=col_name,
                            original=s,
                            new="",
                            rule_id="coupon_canonicalized",
                            severity="info",
                        )
                    )
                new_vals.append("")
                continue
            if trimmed.lower() in empty_set:
                changed += 1
                issues.append(
                    CleaningIssue(
                        row=rnum,
                        column=col_name,
                        original=s,
                        new="",
                        rule_id="coupon_canonicalized",
                        severity="info",
                    )
                )
                new_vals.append("")
                continue

            nxt = trimmed.upper() if case_mode == "upper" else trimmed
            if nxt != s:
                changed += 1
                issues.append(
                    CleaningIssue(
                        row=rnum,
                        column=col_name,
                        original=s,
                        new=nxt,
                        rule_id="coupon_canonicalized",
                        severity="info",
                    )
                )
            new_vals.append(nxt)
        out[col] = new_vals

    details = (
        "No coupon columns selected or detected."
        if not target_cols
        else f"Canonicalized {changed} coupon cell(s) (treating NONE and blank identically)."
    )
    return out, changed, details, issues
