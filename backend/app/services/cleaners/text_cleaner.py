import re
import pandas as pd
from app.models import CleaningIssue
from app.services.validators.field_validators import is_coupon_header, is_missing_value
from app.utils.security import is_formula_trigger


def trim_whitespace(
    df: pd.DataFrame,
    columns: list[str] | None = None,
    collapse_internal: bool = False,
    row_numbers: list[int] | None = None,
) -> tuple[pd.DataFrame, int, str, list[CleaningIssue]]:
    out = df.copy()
    target_cols = [c for c in (columns or []) if c in out.columns] or list(out.columns)
    row_nums = row_numbers if row_numbers is not None else list(range(1, len(out) + 1))
    changed = 0
    issues: list[CleaningIssue] = []

    for col in target_cols:
        col_name = str(col)
        new_vals: list[str] = []
        for idx, val in enumerate(out[col].tolist()):
            s = str(val)
            nxt = s.strip()
            if collapse_internal:
                nxt = re.sub(r"[ \t]+", " ", nxt)
            if nxt != s:
                changed += 1
                issues.append(
                    CleaningIssue(
                        row=row_nums[idx] if idx < len(row_nums) else idx + 1,
                        column=col_name,
                        original=s,
                        new=nxt,
                        rule_id="whitespace_trimmed",
                        severity="info",
                    )
                )
            new_vals.append(nxt)
        out[col] = new_vals

    details = (
        f"Trimmed whitespace in {changed} cell(s)."
        if changed > 0
        else "No leading/trailing whitespace changes needed."
    )
    return out, changed, details, issues


def _to_title_case(value: str) -> str:
    return re.sub(r"\S+", lambda m: m.group(0)[0].upper() + m.group(0)[1:].lower(), value)


def _choose_canonical_variant(variants: dict[str, int], case_mode: str) -> str:
    # Highest frequency first, then mixed-case preference, then lexicographical tie-break
    sorted_items = sorted(
        variants.items(),
        key=lambda item: (
            -item[1],
            -(1 if (item[0] != item[0].lower() and item[0] != item[0].upper()) else 0),
            item[0],
        ),
    )
    top = sorted_items[0][0]
    if case_mode == "lower":
        return top.lower()
    if case_mode == "upper":
        return top.upper()
    if case_mode == "title":
        is_short_acronym = len(top) <= 3 and top == top.upper() and bool(re.search(r"[A-Z]", top))
        is_mixed_case = top != top.lower() and top != top.upper()
        if is_short_acronym or is_mixed_case:
            return top
        return _to_title_case(top)
    return top


def normalize_text(
    df: pd.DataFrame,
    column_types: dict[str, str],
    columns: list[str] | None = None,
    case_mode: str = "none",
    collapse_whitespace: bool = True,
    canonical_merge: bool = False,
    row_numbers: list[int] | None = None,
) -> tuple[pd.DataFrame, int, str, list[CleaningIssue]]:
    out = df.copy()
    if columns:
        target_cols = [c for c in columns if c in out.columns]
    else:
        target_cols = [
            c
            for c in out.columns
            if column_types.get(c) in ("text", "mixed")
            and not is_coupon_header(str(c))
            and not re.match(r"^(?:.*_)?id$", str(c).strip(), re.I)
            and str(c).strip() != "_cleaning_flags"
        ]

    row_nums = row_numbers if row_numbers is not None else list(range(1, len(out) + 1))
    changed = 0
    issues: list[CleaningIssue] = []

    if canonical_merge:
        for col in target_cols:
            col_name = str(col)
            col_vals = [str(v) for v in out[col].tolist()]
            grouped: dict[str, dict[str, int]] = {}
            for s in col_vals:
                if is_missing_value(s) or is_formula_trigger(s):
                    continue
                collapsed = re.sub(r"[ \t]+", " ", s.strip()) if collapse_whitespace else s
                if not collapsed:
                    continue
                key = collapsed.lower()
                bucket = grouped.setdefault(key, {})
                bucket[collapsed] = bucket.get(collapsed, 0) + 1

            canonical_map = {
                k: _choose_canonical_variant(variants, case_mode)
                for k, variants in grouped.items()
            }

            new_vals: list[str] = []
            for idx, s in enumerate(col_vals):
                if is_missing_value(s) or is_formula_trigger(s):
                    new_vals.append(s)
                    continue
                collapsed = re.sub(r"[ \t]+", " ", s.strip()) if collapse_whitespace else s
                canonical = canonical_map.get(collapsed.lower(), collapsed)
                if canonical != s:
                    changed += 1
                    issues.append(
                        CleaningIssue(
                            row=row_nums[idx] if idx < len(row_nums) else idx + 1,
                            column=col_name,
                            original=s,
                            new=canonical,
                            rule_id="text_case_normalized",
                            severity="info",
                        )
                    )
                new_vals.append(canonical)
            out[col] = new_vals

        return (
            out,
            changed,
            f"Normalized {changed} text cell(s) with canonical variant merge (case: {case_mode}).",
            issues,
        )

    for col in target_cols:
        col_name = str(col)
        new_vals = []
        for idx, val in enumerate(out[col].tolist()):
            s = str(val)
            if is_missing_value(s) or is_formula_trigger(s):
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
                issues.append(
                    CleaningIssue(
                        row=row_nums[idx] if idx < len(row_nums) else idx + 1,
                        column=col_name,
                        original=s,
                        new=nxt,
                        rule_id="text_case_normalized",
                        severity="info",
                    )
                )
            new_vals.append(nxt)
        out[col] = new_vals

    return out, changed, f"Normalized {changed} text cell(s) (case: {case_mode}).", issues
