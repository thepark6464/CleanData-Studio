import pandas as pd
from app.models import CleaningIssue


def remove_empty_rows(
    df: pd.DataFrame, row_numbers: list[int] | None = None
) -> tuple[pd.DataFrame, int, str, list[CleaningIssue]]:
    """Remove only fully blank rows; partially populated rows are preserved."""
    if df.empty:
        return df.copy(), 0, "No fully blank rows found.", []
    row_nums = row_numbers if row_numbers is not None else list(range(1, len(df) + 1))
    is_blank = df.apply(lambda row: all(str(v).strip() == "" for v in row), axis=1)
    issues: list[CleaningIssue] = []
    for pos, blank in enumerate(is_blank.tolist()):
        if blank:
            issues.append(
                CleaningIssue(
                    row=row_nums[pos] if pos < len(row_nums) else pos + 1,
                    column="*",
                    original="(blank row)",
                    new="",
                    rule_id="empty_row_removed",
                    severity="info",
                )
            )
    removed_count = int(is_blank.sum())
    cleaned = df.loc[~is_blank].reset_index(drop=True)
    details = (
        f"Removed {removed_count} fully blank row(s). Partially populated rows were preserved."
        if removed_count > 0
        else "No fully blank rows found."
    )
    return cleaned, removed_count, details, issues
