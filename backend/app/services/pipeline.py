import datetime as dt
import pandas as pd

from app.models import (
    CleaningReport,
    CleaningWarning,
    OperationRequest,
    OperationSummary,
    OutputFormat,
)
from app.services.cleaners.columns import rename_columns
from app.services.cleaners.date_cleaner import standardize_dates
from app.services.cleaners.duplicates import remove_duplicates
from app.services.cleaners.email_cleaner import normalize_emails
from app.services.cleaners.empty_rows import remove_empty_rows
from app.services.cleaners.missing_values import handle_missing_values
from app.services.cleaners.phone_cleaner import normalize_phone_numbers
from app.services.cleaners.text_cleaner import normalize_text, trim_whitespace
from app.services.reports import (
    export_dataframe_to_csv_bytes,
    export_dataframe_to_xlsx_bytes,
)
from app.services.scoring import inspect_dataframe
from app.services.validators.file_validator import ParsedDataset

OPERATION_LABELS = {
    "remove_empty_rows": "Remove Empty Rows",
    "remove_duplicates": "Remove Duplicate Rows",
    "trim_whitespace": "Trim Whitespace",
    "normalize_text": "Normalize Text",
    "standardize_dates": "Standardize Dates",
    "normalize_emails": "Normalize Emails",
    "normalize_phone_numbers": "Normalize Phone Numbers",
    "handle_missing_values": "Handle Missing Values",
    "rename_columns": "Rename Columns",
}


def run_cleaning_pipeline(
    dataset: ParsedDataset,
    operations: list[OperationRequest],
    job_id: str,
    output_format: OutputFormat = "csv",
    formula_protection: bool = True,
) -> tuple[pd.DataFrame, bytes, CleaningReport]:
    before_info = inspect_dataframe(dataset.df, dataset.normalized_headers_count)
    column_types = before_info["column_types"]
    working_df = dataset.df.copy()

    # Track source row identity via _source_idx so recordsChanged is accurate
    working_df["_source_idx"] = list(range(len(working_df)))

    summaries: list[OperationSummary] = []
    warnings: list[CleaningWarning] = list(before_info["warnings"])
    empty_rows_removed = 0
    duplicates_removed = 0

    for op in operations:
        if not op.enabled:
            continue

        source_idx = working_df.pop("_source_idx")
        params = op.params
        op_warnings: list[CleaningWarning] = []
        affected = 0
        details = ""

        if op.id == "remove_empty_rows":
            is_blank = working_df.apply(lambda row: all(str(v).strip() == "" for v in row), axis=1)
            working_df, affected, details = remove_empty_rows(working_df)
            source_idx = source_idx.loc[~is_blank].reset_index(drop=True)
            empty_rows_removed += affected

        elif op.id == "remove_duplicates":
            subset = [c for c in (params.get("keyColumns") or []) if c in working_df.columns] or None
            keep_arg = "last" if params.get("keep") == "last" else "first"
            dup_mask = working_df.duplicated(subset=subset, keep=keep_arg)
            working_df, affected, details = remove_duplicates(
                working_df, key_columns=params.get("keyColumns"), keep=keep_arg
            )
            source_idx = source_idx.loc[~dup_mask].reset_index(drop=True)
            duplicates_removed += affected

        elif op.id == "trim_whitespace":
            working_df, affected, details = trim_whitespace(
                working_df,
                columns=params.get("columns"),
                collapse_internal=bool(params.get("collapseInternal", False)),
            )

        elif op.id == "normalize_text":
            working_df, affected, details = normalize_text(
                working_df,
                column_types=column_types,
                columns=params.get("columns"),
                case_mode=str(params.get("caseMode", "none")),
                collapse_whitespace=bool(params.get("collapseWhitespace", True)),
            )

        elif op.id == "standardize_dates":
            working_df, affected, details, op_warnings = standardize_dates(
                working_df,
                column_types=column_types,
                columns=params.get("columns"),
                day_first=bool(params.get("dayFirst", True)),
                output_format=str(params.get("outputFormat", "YYYY-MM-DD")),
            )

        elif op.id == "normalize_emails":
            working_df, affected, details, op_warnings = normalize_emails(
                working_df,
                column_types=column_types,
                columns=params.get("columns"),
            )

        elif op.id == "normalize_phone_numbers":
            working_df, affected, details, op_warnings = normalize_phone_numbers(
                working_df,
                column_types=column_types,
                columns=params.get("columns"),
                default_region=str(params.get("defaultRegion", "IN")),
                output_format=str(params.get("format", "E.164")),
            )

        elif op.id == "handle_missing_values":
            working_df["_source_idx"] = source_idx
            strategies = params.get("strategies") or {}
            # Apply missing rules cleanly while preserving _source_idx alignment
            temp_df = working_df.drop(columns=["_source_idx"])
            cleaned_temp, affected, _rem, details, op_warnings = handle_missing_values(
                temp_df, strategies=strategies
            )
            # Re-align source_idx for remove_row rules
            kept_mask = pd.Series([True] * len(working_df))
            for col, rule in strategies.items():
                if rule.get("strategy") == "remove_row" and col in working_df.columns:
                    from app.services.validators.field_validators import is_missing_value
                    kept_mask &= ~working_df[col].apply(lambda v: is_missing_value(str(v)))
            source_idx = source_idx.loc[kept_mask].reset_index(drop=True)
            working_df = cleaned_temp

        elif op.id == "rename_columns":
            working_df, affected, details = rename_columns(
                working_df,
                convention=str(params.get("convention", "snake_case")),
                custom_map=params.get("customMap"),
            )

        working_df["_source_idx"] = source_idx
        warnings.extend(op_warnings)
        summaries.append(
            OperationSummary(
                id=op.id,
                label=OPERATION_LABELS[op.id],
                applied=True,
                recordsAffected=affected,
                details=details,
                parameters=params,
            )
        )

    final_source_idx = working_df.pop("_source_idx").tolist()

    # Count modified rows compared to original dataset
    orig_rows = dataset.df.values.tolist()
    after_rows = working_df.values.tolist()
    records_changed = 0
    for pos, src_i in enumerate(final_source_idx):
        if src_i < len(orig_rows) and after_rows[pos] != orig_rows[src_i]:
            records_changed += 1

    after_info = inspect_dataframe(working_df, normalized_headers_count=0)
    post_col_types = after_info["column_types"]

    if output_format == "xlsx":
        output_bytes, escaped_count = export_dataframe_to_xlsx_bytes(
            working_df, formula_protection=formula_protection, column_types=post_col_types
        )
    else:
        output_bytes, escaped_count = export_dataframe_to_csv_bytes(
            working_df,
            delimiter=dataset.delimiter,
            formula_protection=formula_protection,
            column_types=post_col_types,
        )

    if formula_protection and escaped_count > 0:
        warnings.append(
            CleaningWarning(
                code="FORMULA_CELLS_ESCAPED",
                severity="info",
                message=(
                    f"Formula-injection protection prefixed {escaped_count} cell(s) starting with "
                    "=, +, -, @, tab, or CR with a single quote (') in the exported artifact."
                ),
                count=escaped_count,
            )
        )

    deduped_warnings: list[CleaningWarning] = []
    seen_warn: set[str] = set()
    for w in warnings:
        k = f"{w.code}:{w.column or ''}:{w.message}"
        if k not in seen_warn:
            seen_warn.add(k)
            deduped_warnings.append(w)

    missing_before = before_info["missing_cells"]
    missing_after = after_info["missing_cells"]

    report = CleaningReport(
        jobId=job_id,
        createdAt=dt.datetime.now(dt.timezone.utc).isoformat(),
        processingPath="server",
        sourceFilename=dataset.filename,
        inputFormat="xlsx" if dataset.input_format == "xlsx" else "csv",
        encoding=dataset.encoding,
        delimiter=dataset.delimiter,
        rowsBefore=len(dataset.df),
        rowsAfter=len(working_df),
        columnsBefore=len(dataset.headers),
        columnsAfter=len(working_df.columns),
        headersBefore=dataset.headers,
        headersAfter=[str(c) for c in working_df.columns],
        operationsApplied=summaries,
        recordsChanged=records_changed,
        recordsRemoved=len(dataset.df) - len(working_df),
        duplicatesRemoved=duplicates_removed,
        emptyRowsRemoved=empty_rows_removed,
        missingValuesFound=missing_before,
        missingValuesHandled=max(0, missing_before - missing_after),
        formulaInjectionProtected=formula_protection,
        formulaCellsEscaped=escaped_count,
        warnings=deduped_warnings,
        qualityBefore=before_info["quality"],
        qualityAfter=after_info["quality"],
    )

    return working_df, output_bytes, report
