import pandas as pd


def remove_duplicates(
    df: pd.DataFrame, key_columns: list[str] | None = None, keep: str = "first"
) -> tuple[pd.DataFrame, int, str]:
    if df.empty:
        return df.copy(), 0, "No duplicate rows found."
    subset = [c for c in (key_columns or []) if c in df.columns] or None
    keep_arg = "last" if keep == "last" else "first"
    before = len(df)
    cleaned = df.drop_duplicates(subset=subset, keep=keep_arg).reset_index(drop=True)
    removed = before - len(cleaned)
    details = (
        f"Removed {removed} duplicate row(s) (keep: {keep_arg})."
        if removed > 0
        else "No duplicate rows matched the selected key columns."
    )
    return cleaned, removed, details
