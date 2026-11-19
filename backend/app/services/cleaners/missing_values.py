import re
import statistics
import pandas as pd
from app.models import CleaningWarning
from app.services.validators.field_validators import is_missing_value

NUMERIC_RE = re.compile(r"^[+-]?\d+(?:\.\d+)?$")


def handle_missing_values(
    df: pd.DataFrame, strategies: dict[str, dict]
) -> tuple[pd.DataFrame, int, int, str, list[CleaningWarning]]:
    out = df.copy()
    filled = 0
    removed_rows = 0
    warnings: list[CleaningWarning] = []

    for col in list(out.columns):
        rule = strategies.get(col)
        if not rule:
            continue
        strategy = rule.get("strategy", "keep")
        if strategy == "keep":
            continue

        if strategy == "remove_row":
            mask = out[col].apply(lambda v: not is_missing_value(str(v)))
            removed_rows += int((~mask).sum())
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
                        column=col,
                        message=f'Cannot compute {stat_name} for "{col}" because no valid numeric values exist.',
                    )
                )
                continue
            stat = sum(nums) / len(nums) if strategy == "fill_mean" else statistics.median(nums)
            replacement = str(int(stat)) if float(stat).is_integer() else str(round(stat, 2))

        if replacement is not None:
            new_vals: list[str] = []
            for val in out[col].tolist():
                s = str(val)
                if is_missing_value(s):
                    new_vals.append(replacement)
                    filled += 1
                else:
                    new_vals.append(s)
            out[col] = new_vals

    total_affected = filled + removed_rows
    details = f"Filled {filled} missing cell(s) and removed {removed_rows} row(s) via per-column missing rules."
    return out, total_affected, removed_rows, details, warnings
