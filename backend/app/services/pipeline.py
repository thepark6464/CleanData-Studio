import datetime as dt
import pandas as pd

from app.models import (
    CleaningIssue,
    CleaningReport,
    CleaningWarning,
    NearDuplicateMergeRecord,
    OperationRequest,
    OperationSummary,
    OutputFormat,
)
from app.services.cleaners.columns import rename_columns
from app.services.cleaners.coupon_cleaner import canonicalize_coupons
from app.services.cleaners.date_cleaner import standardize_dates
from app.services.cleaners.duplicates import remove_duplicates
from app.services.cleaners.email_cleaner import normalize_emails
from app.services.cleaners.empty_rows import remove_empty_rows
from app.services.cleaners.missing_values import handle_missing_values
from app.services.cleaners.number_cleaner import validate_numbers
from app.services.cleaners.phone_cleaner import normalize_phone_numbers
from app.services.cleaners.placeholder_cleaner import placeholder_to_null
from app.services.cleaners.text_cleaner import normalize_text, trim_whitespace
from app.services.reports import (
    export_dataframe_to_csv_bytes,
    export_dataframe_to_xlsx_bytes,
)
from app.services.scoring import inspect_dataframe
from app.services.validators.file_validator import ParsedDataset

OPERATION_LABELS = {
    "remove_empty_rows": "Remove Empty Rows",
    "remove_duplicates": "Remove & Merge Duplicate Rows",
    "trim_whitespace": "Trim Whitespace",
    "placeholder_to_null": "Placeholder-to-Null Cleanup",
    "canonicalize_coupons": "Canonicalize Coupon Codes",
    "normalize_text": "Normalize & Canonicalize Text",
    "standardize_dates": "Standardize Dates",
    "normalize_emails": "Normalize & Validate Emails",
    "normalize_phone_numbers": "Normalize & Validate Phones",
    "validate_numbers": "Validate Numeric Fields",
    "handle_missing_values": "Handle Missing Values",
    "rename_columns": "Rename Columns",
}

_RULE_PRECEDENCE: dict[str, int] = {
    "whitespace_trimmed": 1,
    "text_case_normalized": 2,
    "coupon_canonicalized": 3,
    "email_normalized": 4,
    "phone_normalized": 4,
    "date_standardized": 4,
    "numeric_normalized": 4,
    "missing_filled": 5,
    "placeholder_to_null": 6,
    "email_invalid_flagged": 7,
    "email_invalid_cleared": 7,
    "phone_invalid_flagged": 7,
    "phone_invalid_cleared": 7,
    "date_invalid_flagged": 7,
    "date_invalid_cleared": 7,
    "numeric_invalid_flagged": 7,
    "numeric_invalid_cleared": 7,
    "duplicate_key_merged": 8,
    "duplicate_key_conflict": 9,
    "empty_row_removed": 10,
    "missing_row_removed": 10,
    "duplicate_exact_removed": 10,
}

_SEVERITY_RANK: dict[str, int] = {"info": 1, "warning": 2, "error": 3}
_ROW_LEVEL_RULES = {"empty_row_removed", "missing_row_removed", "duplicate_exact_removed"}


def _coalesce_cell_issues(issues: list[CleaningIssue]) -> list[CleaningIssue]:
    result: list[CleaningIssue] = []
    cell_index_map: dict[tuple[int, str], int] = {}

    for issue in issues:
        if issue.column == "*" or issue.rule_id in _ROW_LEVEL_RULES:
            result.append(issue)
            continue

        key = (issue.row, issue.column)
        existing_idx = cell_index_map.get(key)
        if existing_idx is None:
            cell_index_map[key] = len(result)
            result.append(issue.model_copy())
            continue

        prev = result[existing_idx]
        prev_rank = _RULE_PRECEDENCE.get(prev.rule_id, 5)
        next_rank = _RULE_PRECEDENCE.get(issue.rule_id, 5)
        next_sev = (
            issue.severity
            if _SEVERITY_RANK.get(issue.severity, 1) >= _SEVERITY_RANK.get(prev.severity, 1)
            else prev.severity
        )
        result[existing_idx] = CleaningIssue(
            row=prev.row,
            column=prev.column,
            original=prev.original,
            new=issue.new,
            rule_id=issue.rule_id if next_rank >= prev_rank else prev.rule_id,
            severity=next_sev,
        )

    return result


def run_cleaning_pipeline(
    dataset: ParsedDataset,
    operations: list[OperationRequest],
    job_id: str,
    output_format: OutputFormat = "csv",
    formula_protection: bool = True,
    include_cleaning_flags: bool = False,
) -> tuple[pd.DataFrame, bytes, CleaningReport]:
    before_info = inspect_dataframe(dataset.df, dataset.normalized_headers_count)
    column_types = before_info["column_types"]
    working_df = dataset.df.copy()

    # Track 0-based source row identity via _source_idx so recordsChanged and 1-based issue row numbers stay exact
    working_df["_source_idx"] = list(range(len(working_df)))

    summaries: list[OperationSummary] = []
    warnings: list[CleaningWarning] = list(before_info["warnings"])
    all_issues: list[CleaningIssue] = []
    all_merges: list[NearDuplicateMergeRecord] = []
    empty_rows_removed = 0
    duplicates_removed = 0
    near_duplicates_merged = 0

    for op in operations:
        if not op.enabled:
            continue

        source_idx = working_df.pop("_source_idx")
        row_numbers = [int(i) + 1 for i in source_idx.tolist()]
        params = op.params
        op_warnings: list[CleaningWarning] = []
        op_issues: list[CleaningIssue] = []
        affected = 0
        details = ""

        if op.id == "remove_empty_rows":
            is_blank = working_df.apply(lambda row: all(str(v).strip() == "" for v in row), axis=1)
            working_df, affected, details, op_issues = remove_empty_rows(
                working_df, row_numbers=row_numbers
            )
            source_idx = source_idx.loc[~is_blank].reset_index(drop=True)
            empty_rows_removed += affected

        elif op.id == "remove_duplicates":
            keep_arg = "last" if params.get("keep") == "last" else "first"
            working_df, affected, details, op_issues, op_merges, kept_row_nums = remove_duplicates(
                working_df,
                key_columns=params.get("keyColumns"),
                keep=keep_arg,
                merge_near_duplicates=bool(params.get("mergeNearDuplicates", False)),
                merge_key_columns=params.get("mergeKeyColumns"),
                row_numbers=row_numbers,
            )
            source_idx = pd.Series([r - 1 for r in kept_row_nums], dtype=int)
            duplicates_removed += affected
            if op_merges:
                all_merges.extend(op_merges)
                near_duplicates_merged += sum(len(m.mergedRowNumbers) for m in op_merges)

        elif op.id == "trim_whitespace":
            working_df, affected, details, op_issues = trim_whitespace(
                working_df,
                columns=params.get("columns"),
                collapse_internal=bool(params.get("collapseInternal", False)),
                row_numbers=row_numbers,
            )

        elif op.id == "placeholder_to_null":
            working_df, affected, details, op_issues = placeholder_to_null(
                working_df,
                columns=params.get("columns"),
                tokens=params.get("tokens"),
                exclude_columns=params.get("excludeColumns"),
                row_numbers=row_numbers,
            )

        elif op.id == "canonicalize_coupons":
            working_df, affected, details, op_issues = canonicalize_coupons(
                working_df,
                columns=params.get("columns"),
                empty_tokens=params.get("emptyTokens"),
                case_mode=str(params.get("caseMode", "upper")),
                row_numbers=row_numbers,
            )

        elif op.id == "normalize_text":
            working_df, affected, details, op_issues = normalize_text(
                working_df,
                column_types=column_types,
                columns=params.get("columns"),
                case_mode=str(params.get("caseMode", "none")),
                collapse_whitespace=bool(params.get("collapseWhitespace", True)),
                canonical_merge=bool(params.get("canonicalMerge", False)),
                row_numbers=row_numbers,
            )

        elif op.id == "standardize_dates":
            working_df, affected, details, op_warnings, op_issues = standardize_dates(
                working_df,
                column_types=column_types,
                columns=params.get("columns"),
                day_first=bool(params.get("dayFirst", True)),
                output_format=str(params.get("outputFormat", "YYYY-MM-DD")),
                clear_invalid=bool(params.get("clearInvalid", False)),
                row_numbers=row_numbers,
            )

        elif op.id == "normalize_emails":
            working_df, affected, details, op_warnings, op_issues = normalize_emails(
                working_df,
                column_types=column_types,
                columns=params.get("columns"),
                clear_invalid=bool(params.get("clearInvalid", False)),
                row_numbers=row_numbers,
            )

        elif op.id == "normalize_phone_numbers":
            working_df, affected, details, op_warnings, op_issues = normalize_phone_numbers(
                working_df,
                column_types=column_types,
                columns=params.get("columns"),
                default_region=str(params.get("defaultRegion", "IN")),
                output_format=str(params.get("format", "E.164")),
                clear_invalid=bool(params.get("clearInvalid", False)),
                row_numbers=row_numbers,
            )

        elif op.id == "validate_numbers":
            working_df, affected, details, op_warnings, op_issues = validate_numbers(
                working_df,
                column_types=column_types,
                columns=params.get("columns"),
                rules=params.get("rules"),
                default_max_quantity=int(params.get("defaultMaxQuantity", 1000)),
                clear_invalid=bool(params.get("clearInvalid", True)),
                row_numbers=row_numbers,
            )

        elif op.id == "handle_missing_values":
            working_df["_source_idx"] = source_idx
            strategies = params.get("strategies") or {}
            temp_df = working_df.drop(columns=["_source_idx"])
            cleaned_temp, affected, _rem, details, op_warnings, op_issues = handle_missing_values(
                temp_df, strategies=strategies, row_numbers=row_numbers
            )
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
        all_issues.extend(op_issues)
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

    deduplicated_issues = _coalesce_cell_issues(all_issues)

    issue_counts_by_rule: dict[str, int] = {}
    flags_by_row: dict[int, list[str]] = {}
    for issue in deduplicated_issues:
        issue_counts_by_rule[issue.rule_id] = issue_counts_by_rule.get(issue.rule_id, 0) + 1
        if include_cleaning_flags and issue.column != "*":
            tag = f"{issue.column}:{issue.rule_id}"
            bucket = flags_by_row.setdefault(issue.row, [])
            if tag not in bucket:
                bucket.append(tag)

    after_info = inspect_dataframe(working_df, normalized_headers_count=0)
    post_col_types = dict(after_info["column_types"])

    export_df = working_df
    if include_cleaning_flags:
        export_df = working_df.copy()
        export_df["_cleaning_flags"] = [
            ";".join(flags_by_row.get(int(src_i) + 1, [])) for src_i in final_source_idx
        ]
        post_col_types["_cleaning_flags"] = "text"

    if output_format == "xlsx":
        output_bytes, escaped_count = export_dataframe_to_xlsx_bytes(
            export_df, formula_protection=formula_protection, column_types=post_col_types
        )
    else:
        output_bytes, escaped_count = export_dataframe_to_csv_bytes(
            export_df,
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
        rowsAfter=len(export_df),
        columnsBefore=len(dataset.headers),
        columnsAfter=len(export_df.columns),
        headersBefore=dataset.headers,
        headersAfter=[str(c) for c in export_df.columns],
        operationsApplied=summaries,
        recordsChanged=records_changed,
        recordsRemoved=len(dataset.df) - len(export_df),
        duplicatesRemoved=duplicates_removed,
        emptyRowsRemoved=empty_rows_removed,
        missingValuesFound=missing_before,
        missingValuesHandled=max(0, missing_before - missing_after),
        formulaInjectionProtected=formula_protection,
        formulaCellsEscaped=escaped_count,
        warnings=deduped_warnings,
        qualityBefore=before_info["quality"],
        qualityAfter=after_info["quality"],
        issues=deduplicated_issues,
        issueCountsByRule=issue_counts_by_rule,
        merges=all_merges,
        nearDuplicatesMerged=near_duplicates_merged,
        includeCleaningFlags=include_cleaning_flags,
    )

    return export_df, output_bytes, report
