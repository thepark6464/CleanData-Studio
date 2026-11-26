import re
import statistics
import pandas as pd
from app.models import CleaningIssue, CleaningWarning
from app.services.validators.field_validators import is_missing_value

NUMERIC_RE = re.compile(r"^[+-]?\d+(?:\.\d+)?$")


def handle_missing_values(
    df: pd.DataFrame,
    strategies: dict[str, dict],
    row_numbers: list[int] | None = None,
) -> tuple[pd.DataFrame, int, int, str, list[CleaningWarning], list[CleaningIssue]]:
    out = df.copy()
    row_nums = list(row_numbers) if row_numbers is not None else list(range(1, len(out) + 1))
    filled = 0
    removed_rows = 0
    warnings: list[CleaningWarning] = []
    issues: list[CleaningIssue] = []

    for col in list(out.columns):
        col_name = str(col)
        rule = strategies.get(col_name)
        if not rule:
            continue
        strategy = rule.get("strategy", "keep")
        if strategy == "keep":
            continue

        if strategy == "remove_row":
            mask = out[col].apply(lambda v: not is_missing_value(str(v)))
            col_vals = out[col].tolist()
            next_row_nums: list[int] = []
            for pos, keep_row in enumerate(mask.tolist()):
                rnum = row_nums[pos] if pos < len(row_nums) else pos + 1
                if keep_row:
                    next_row_nums.append(rnum)
                else:
                    removed_rows += 1
                    issues.append(
                        CleaningIssue(
                            row=rnum,
                            column=col_name,
                            original=str(col_vals[pos]),
                            new="",
                            rule_id="missing_row_removed",
                            severity="warning",
                        )
                    )
            row_nums = next_row_nums
            out = out.loc[mask].reset_index(drop=True)
            continue

        replacement: str | None = None
        if strategy == "fill_constant":
            replacement = str(rule.get("constantValue", ""))
        elif strategy == "fill_zero":
            replacement = "0"
        elif strategy in ("fill_mean", "fill_median"):
            nums: list[float] = []
            for raw in out[col].tolist():
                s = str(raw).strip()
                if not is_missing_value(s) and NUMERIC_RE.match(s):
                    nums.append(float(s))
            if not nums:
                stat_name = "mean" if strategy == "fill_mean" else "median"
                warnings.append(
                    CleaningWarning(
                        code="NUMERIC_FILL_NO_DATA",
                        severity="warning",
                        column=col_name,
                        message=f'Cannot compute {stat_name} for "{col_name}" because no valid numeric values exist.',
                    )
                )
                continue
            stat = sum(nums) / len(nums) if strategy == "fill_mean" else statistics.median(nums)
            replacement = str(int(stat)) if float(stat).is_integer() else str(round(stat, 2))

        if replacement is not None:
            new_vals: list[str] = []
            for idx, val in enumerate(out[col].tolist()):
                s = str(val)
                if is_missing_value(s):
                    new_vals.append(replacement)
                    filled += 1
                    issues.append(
                        CleaningIssue(
                            row=row_nums[idx] if idx < len(row_nums) else idx + 1,
                            column=col_name,
                            original=s,
                            new=replacement,
                            rule_id="missing_filled",
                            severity="info",
                        )
                    )
                else:
                    new_vals.append(s)
            out[col] = new_vals

    total_affected = filled + removed_rows
    details = f"Filled {filled} missing cell(s) and removed {removed_rows} row(s) via per-column missing rules."
    return out, total_affected, removed_rows, details, warnings, issues
