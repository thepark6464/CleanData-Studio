import json
import pandas as pd

from app.models import CleaningWarning, QualityScoreBreakdown
from app.services.validators.field_validators import infer_column_stats
from app.utils.security import is_formula_trigger


FORMULA_DESCRIPTION = (
    "score = clamp(100 - (30 * missing_rate + 30 * invalid_rate + "
    "25 * duplicate_rate + 15 * type_inconsistency_rate), 0, 100)"
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
            formulaDescription=FORMULA_DESCRIPTION,
        )
    else:
        missing_rate = missing_count / total_cells
        invalid_rate = invalid_count / total_cells
        duplicate_rate = duplicate_rows / total_rows
        populated = max(1, total_cells - missing_count)
        type_inconsistency_rate = min(1.0, type_inconsistent_count / populated)
        raw_score = 100.0 - (
            30.0 * missing_rate
            + 30.0 * invalid_rate
            + 25.0 * duplicate_rate
            + 15.0 * type_inconsistency_rate
        )
        score = round(max(0.0, min(100.0, raw_score)) * 10.0) / 10.0
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
