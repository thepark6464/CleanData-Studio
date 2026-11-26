import json
import pandas as pd

from app.models import CleaningWarning, QualityScoreBreakdown
from app.services.validators.field_validators import (
    default_numeric_rule_for_header,
    infer_column_stats,
    is_cell_failing_validation,
)
from app.utils.security import is_formula_trigger


FORMULA_DESCRIPTION = (
    "score = round(100 * (passing_cells / total_cells), 1); non-coupon empty/missing cells always fail, empty coupon cells pass as no-coupon, each cell counted at most once"
)


def inspect_dataframe(
    df: pd.DataFrame, normalized_headers_count: int = 0
) -> dict:
    headers = [str(c) for c in df.columns]
    total_rows = len(df)
    total_cols = len(headers)
    total_cells = total_rows * total_cols

    empty_rows = 0
    duplicate_rows = 0
    seen_rows: set[str] = set()
    formula_cells = 0

    for row in df.itertuples(index=False, name=None):
        cells = [str(c) for c in row]
        if all(c.strip() == "" for c in cells):
            empty_rows += 1
            continue
        key = json.dumps(cells)
        if key in seen_rows:
            duplicate_rows += 1
        else:
            seen_rows.add(key)
        for c in cells:
            if is_formula_trigger(c):
                formula_cells += 1

    column_types: dict[str, str] = {}
    missing_count = 0
    invalid_count = 0
    type_inconsistent_count = 0
    ambiguous_dates = 0
    invalid_emails = 0

    for col in headers:
        values = [str(v) for v in df[col].tolist()] if total_rows > 0 else []
        stats = infer_column_stats(values, col)
        column_types[col] = stats["detected_type"]
        missing_count += stats["missing_count"]
        invalid_count += stats["invalid_count"]
        type_inconsistent_count += stats["type_inconsistent_count"]
        if stats["detected_type"] == "date":
            ambiguous_dates += stats["ambiguous_date_count"]
        elif stats["detected_type"] == "email":
            invalid_emails += stats["invalid_count"]

    if total_rows == 0 or total_cells == 0:
        breakdown = QualityScoreBreakdown(
            score=100.0,
            missingRate=0.0,
            invalidRate=0.0,
            duplicateRate=0.0,
            typeInconsistencyRate=0.0,
            missingCount=0,
            invalidCount=0,
            duplicateRowCount=0,
            typeInconsistentCount=0,
            totalCells=0,
            totalRows=0,
            passingCells=0,
            failingCells=0,
            validationPassRate=1.0,
            formulaDescription=FORMULA_DESCRIPTION,
        )
    else:
        missing_rate = missing_count / total_cells
        invalid_rate = invalid_count / total_cells
        duplicate_rate = duplicate_rows / total_rows
        populated = max(1, total_cells - missing_count)
        type_inconsistency_rate = min(1.0, type_inconsistent_count / populated)

        numeric_rules = [default_numeric_rule_for_header(h) for h in headers]
        detected_types = [column_types.get(h, "text") for h in headers]

        failing_cells = 0
        seen_row_keys: set[str] = set()
        for row in df.itertuples(index=False, name=None):
            cells = [str(c) for c in row]
            if all(c.strip() == "" for c in cells):
                failing_cells += total_cols
                continue
            rkey = json.dumps(cells)
            if rkey in seen_row_keys:
                failing_cells += total_cols
                continue
            seen_row_keys.add(rkey)
            for c_idx in range(total_cols):
                val = cells[c_idx]
                dtype = detected_types[c_idx]
                is_num_col = dtype in ("integer", "decimal")
                if is_cell_failing_validation(
                    val,
                    headers[c_idx],
                    dtype,
                    numeric_rules[c_idx],
                    is_formula_trigger(val, is_num_col),
                ):
                    failing_cells += 1

        failing_cells = min(total_cells, failing_cells)
        passing_cells = max(0, total_cells - failing_cells)
        validation_pass_rate = passing_cells / total_cells
        score = round(max(0.0, min(100.0, validation_pass_rate * 100.0)) * 10.0) / 10.0

        breakdown = QualityScoreBreakdown(
            score=score,
            missingRate=missing_rate,
            invalidRate=invalid_rate,
            duplicateRate=duplicate_rate,
            typeInconsistencyRate=type_inconsistency_rate,
            missingCount=missing_count,
            invalidCount=invalid_count,
            duplicateRowCount=duplicate_rows,
            typeInconsistentCount=type_inconsistent_count,
            totalCells=total_cells,
            totalRows=total_rows,
            passingCells=passing_cells,
            failingCells=failing_cells,
            validationPassRate=validation_pass_rate,
            formulaDescription=FORMULA_DESCRIPTION,
        )

    warnings: list[CleaningWarning] = []
    if normalized_headers_count > 0:
        warnings.append(
            CleaningWarning(
                code="NORMALIZED_HEADERS",
                severity="warning",
                message=f"{normalized_headers_count} blank or duplicate column header(s) were automatically disambiguated.",
                count=normalized_headers_count,
            )
        )
    if total_rows == 0:
        warnings.append(
            CleaningWarning(
                code="HEADER_ONLY_FILE",
                severity="info",
                message="This file contains column headers but zero data rows.",
            )
        )
    if ambiguous_dates > 0:
        warnings.append(
            CleaningWarning(
                code="AMBIGUOUS_DATES",
                severity="warning",
                message=f"{ambiguous_dates} date value(s) are ambiguous; explicit day_first preference is applied.",
                count=ambiguous_dates,
            )
        )
    if formula_cells > 0:
        warnings.append(
            CleaningWarning(
                code="FORMULA_CELLS_DETECTED",
                severity="warning",
                message=f"{formula_cells} cell(s) start with =, +, -, @, tab, or CR. Formula-injection protection is enabled on export.",
                count=formula_cells,
            )
        )
    if invalid_emails > 0:
        warnings.append(
            CleaningWarning(
                code="INVALID_EMAILS",
                severity="warning",
                message=f"{invalid_emails} email value(s) failed syntax validation. Syntax validation never verifies mailbox existence.",
                count=invalid_emails,
            )
        )

    return {
        "column_types": column_types,
        "quality": breakdown,
        "warnings": warnings,
        "empty_rows": empty_rows,
        "duplicate_rows": duplicate_rows,
        "missing_cells": missing_count,
        "formula_cells": formula_cells,
    }
