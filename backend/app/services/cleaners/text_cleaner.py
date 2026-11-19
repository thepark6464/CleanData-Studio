import re
import pandas as pd
from app.services.validators.field_validators import is_missing_value


def trim_whitespace(
    df: pd.DataFrame, columns: list[str] | None = None, collapse_internal: bool = False
) -> tuple[pd.DataFrame, int, str]:
    out = df.copy()
    target_cols = [c for c in (columns or []) if c in out.columns] or list(out.columns)
    changed = 0

    for col in target_cols:
        new_vals: list[str] = []
        for val in out[col].tolist():
            s = str(val)
            nxt = s.strip()
            if collapse_internal:
                nxt = re.sub(r"[ \t]+", " ", nxt)
            if nxt != s:
                changed += 1
            new_vals.append(nxt)
        out[col] = new_vals

    details = (
        f"Trimmed whitespace in {changed} cell(s)."
        if changed > 0
        else "No leading/trailing whitespace changes needed."
    )
    return out, changed, details


def _to_title_case(value: str) -> str:
    return re.sub(r"\S+", lambda m: m.group(0)[0].upper() + m.group(0)[1:].lower(), value)


def normalize_text(
    df: pd.DataFrame,
    column_types: dict[str, str],
    columns: list[str] | None = None,
    case_mode: str = "none",
    collapse_whitespace: bool = True,
) -> tuple[pd.DataFrame, int, str]:
    out = df.copy()
    target_cols = (
        [c for c in (columns or []) if c in out.columns]
        or [c for c in out.columns if column_types.get(c) in ("text", "mixed")]
    )
    changed = 0

    for col in target_cols:
        new_vals: list[str] = []
        for val in out[col].tolist():
            s = str(val)
            if is_missing_value(s):
                new_vals.append(s)
                continue
            nxt = re.sub(r"[ \t]+", " ", s.strip()) if collapse_whitespace else s
            if case_mode == "lower":
                nxt = nxt.lower()
            elif case_mode == "upper":
                nxt = nxt.upper()
            elif case_mode == "title":
                nxt = _to_title_case(nxt)
            if nxt != s:
                changed += 1
            new_vals.append(nxt)
        out[col] = new_vals

    return out, changed, f"Normalized {changed} text cell(s) (case: {case_mode})."
