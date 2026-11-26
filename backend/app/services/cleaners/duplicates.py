import json
import re
import pandas as pd

from app.models import (
    CleaningIssue,
    NearDuplicateMergeConflict,
    NearDuplicateMergeRecord,
)


_MERGE_KEY_PATTERNS = [
    re.compile(r"^order_id$", re.I),
    re.compile(r"^customer_id$", re.I),
    re.compile(r"^record_id$", re.I),
    re.compile(r"^account_id$", re.I),
    re.compile(r"^user_id$", re.I),
    re.compile(r"^id$", re.I),
]


def detect_merge_key_columns(df: pd.DataFrame) -> list[str]:
    if df.empty:
        return []
    total = len(df)
    headers = [str(c) for c in df.columns]
    for pat in _MERGE_KEY_PATTERNS:
        col_name = next((h for h in headers if pat.match(h.strip())), None)
        if col_name is None:
            continue
        non_empty = 0
        distinct: set[str] = set()
        for val in df[col_name].tolist():
            v = str(val).strip().lower()
            if v:
                non_empty += 1
                distinct.add(v)
        if non_empty / total >= 0.9 and (distinct and (len(distinct) / non_empty) >= 0.85):
            return [col_name]
    return []


def remove_duplicates(
    df: pd.DataFrame,
    key_columns: list[str] | None = None,
    keep: str = "first",
    merge_near_duplicates: bool = False,
    merge_key_columns: list[str] | None = None,
    row_numbers: list[int] | None = None,
) -> tuple[
    pd.DataFrame,
    int,
    str,
    list[CleaningIssue],
    list[NearDuplicateMergeRecord],
    list[int],
]:
    if df.empty:
        return df.copy(), 0, "No duplicate rows found.", [], [], []

    headers = [str(c) for c in df.columns]
    row_nums = row_numbers if row_numbers is not None else list(range(1, len(df) + 1))
    valid_keys = [c for c in (key_columns or []) if c in df.columns]
    key_indices = [headers.index(c) for c in valid_keys] if valid_keys else list(range(len(headers)))
    keep_arg = "last" if keep == "last" else "first"

    rows_list = [[str(v) for v in row] for row in df.itertuples(index=False, name=None)]

    def _key(cells: list[str]) -> str:
        return json.dumps([cells[idx] if idx < len(cells) else "" for idx in key_indices])

    issues: list[CleaningIssue] = []
    merges: list[NearDuplicateMergeRecord] = []
    kept_rows: list[tuple[int, list[str]]] = []
    exact_removed = 0
    col_label = ",".join(valid_keys) if valid_keys else "*"

    if keep_arg == "first":
        seen: set[str] = set()
        for pos, cells in enumerate(rows_list):
            rnum = row_nums[pos] if pos < len(row_nums) else pos + 1
            k = _key(cells)
            if k in seen:
                exact_removed += 1
                issues.append(
                    CleaningIssue(
                        row=rnum,
                        column=col_label,
                        original="duplicate_row",
                        new="",
                        rule_id="duplicate_exact_removed",
                        severity="info",
                    )
                )
            else:
                seen.add(k)
                kept_rows.append((rnum, cells))
    else:
        last_idx: dict[str, int] = {}
        for pos, cells in enumerate(rows_list):
            last_idx[_key(cells)] = pos
        for pos, cells in enumerate(rows_list):
            rnum = row_nums[pos] if pos < len(row_nums) else pos + 1
            k = _key(cells)
            if last_idx[k] == pos:
                kept_rows.append((rnum, cells))
            else:
                exact_removed += 1
                issues.append(
                    CleaningIssue(
                        row=rnum,
                        column=col_label,
                        original="duplicate_row",
                        new="",
                        rule_id="duplicate_exact_removed",
                        severity="info",
                    )
                )

    merged_count = 0
    if merge_near_duplicates and kept_rows:
        exact_df = pd.DataFrame([r[1] for r in kept_rows], columns=headers)
        merge_cols = (
            [c for c in merge_key_columns if c in headers]
            if merge_key_columns
            else detect_merge_key_columns(exact_df)
        )
        if merge_cols:
            merge_indices = [headers.index(c) for c in merge_cols]
            groups: dict[str, list[tuple[int, list[str]]]] = {}
            order_entries: list[tuple[bool, str | None, tuple[int, list[str]] | None]] = []

            for rnum, cells in kept_rows:
                key_parts = [cells[idx].strip().lower() for idx in merge_indices]
                if any(part == "" for part in key_parts):
                    order_entries.append((False, None, (rnum, cells)))
                    continue
                mkey = json.dumps(key_parts)
                if mkey not in groups:
                    groups[mkey] = [(rnum, cells)]
                    order_entries.append((True, mkey, None))
                else:
                    groups[mkey].append((rnum, cells))

            next_kept: list[tuple[int, list[str]]] = []
            for is_group, mkey, single_row in order_entries:
                if not is_group:
                    assert single_row is not None
                    next_kept.append(single_row)
                    continue
                assert mkey is not None
                group = groups[mkey]
                if len(group) == 1:
                    next_kept.append(group[0])
                    continue

                winner_rnum, winner_cells = group[0]
                winner_score = sum(1 for c in winner_cells if c.strip() != "")
                for cand_rnum, cand_cells in group[1:]:
                    score = sum(1 for c in cand_cells if c.strip() != "")
                    if score > winner_score or (score == winner_score and keep_arg == "last"):
                        winner_rnum, winner_cells = cand_rnum, cand_cells
                        winner_score = score

                merged_cells = list(winner_cells)
                filled_columns: list[str] = []
                conflicts: list[NearDuplicateMergeConflict] = []

                for c_idx, col_name in enumerate(headers):
                    if merged_cells[c_idx].strip() == "":
                        for other_rnum, other_cells in group:
                            if other_rnum == winner_rnum:
                                continue
                            val = other_cells[c_idx]
                            if val.strip() != "":
                                merged_cells[c_idx] = val
                                filled_columns.append(col_name)
                                issues.append(
                                    CleaningIssue(
                                        row=winner_rnum,
                                        column=col_name,
                                        original="",
                                        new=val,
                                        rule_id="duplicate_key_merged",
                                        severity="info",
                                    )
                                )
                                break

                    conflict_vals: list[str] = []
                    for other_rnum, other_cells in group:
                        if other_rnum == winner_rnum:
                            continue
                        other_val = other_cells[c_idx]
                        if (
                            other_val.strip() != ""
                            and other_val != merged_cells[c_idx]
                            and other_val not in conflict_vals
                        ):
                            conflict_vals.append(other_val)
                            issues.append(
                                CleaningIssue(
                                    row=other_rnum,
                                    column=col_name,
                                    original=other_val,
                                    new=merged_cells[c_idx],
                                    rule_id="duplicate_key_conflict",
                                    severity="warning",
                                )
                            )
                    if conflict_vals:
                        conflicts.append(
                            NearDuplicateMergeConflict(
                                column=col_name,
                                keptValue=merged_cells[c_idx],
                                conflictingValues=conflict_vals,
                            )
                        )

                merged_row_numbers: list[int] = []
                key_display = "|".join(merged_cells[idx] for idx in merge_indices)
                merge_col_label = ",".join(merge_cols)
                for other_rnum, _ in group:
                    if other_rnum == winner_rnum:
                        continue
                    merged_row_numbers.append(other_rnum)
                    merged_count += 1
                    issues.append(
                        CleaningIssue(
                            row=other_rnum,
                            column=merge_col_label,
                            original=key_display,
                            new=f"merged_into_row_{winner_rnum}",
                            rule_id="duplicate_key_merged",
                            severity="info",
                        )
                    )

                merges.append(
                    NearDuplicateMergeRecord(
                        keyColumns=merge_cols,
                        keyValue=key_display,
                        keptRowNumber=winner_rnum,
                        mergedRowNumbers=merged_row_numbers,
                        filledColumns=filled_columns,
                        conflicts=conflicts,
                    )
                )
                next_kept.append((winner_rnum, merged_cells))
            kept_rows = next_kept

    cleaned_df = pd.DataFrame([r[1] for r in kept_rows], columns=headers)
    kept_row_nums = [r[0] for r in kept_rows]
    total_removed = exact_removed + merged_count
    parts: list[str] = []
    if exact_removed > 0:
        parts.append(f"Removed {exact_removed} exact duplicate row(s) (keep: {keep_arg})")
    if merged_count > 0:
        parts.append(f"Merged {merged_count} key-duplicate row(s)")
    details = (
        f"{'; '.join(parts)}."
        if parts
        else "No duplicate rows matched the selected key columns."
    )
    return cleaned_df, total_removed, details, issues, merges, kept_row_nums
