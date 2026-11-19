import pandas as pd


def remove_empty_rows(df: pd.DataFrame) -> tuple[pd.DataFrame, int, str]:
    """Remove only fully blank rows; partially populated rows are preserved."""
    if df.empty:
        return df.copy(), 0, "No fully blank rows found."
    is_blank = df.apply(lambda row: all(str(v).strip() == "" for v in row), axis=1)
    removed_count = int(is_blank.sum())
    cleaned = df.loc[~is_blank].reset_index(drop=True)
    details = (
        f"Removed {removed_count} fully blank row(s). Partially populated rows were preserved."
        if removed_count > 0
        else "No fully blank rows found."
    )
    return cleaned, removed_count, details
