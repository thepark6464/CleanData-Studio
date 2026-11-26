import csv
import io
import re
import openpyxl
import pandas as pd

from app.models import CleaningIssue
from app.utils.security import escape_formula_cell, is_formula_trigger


def export_dataframe_to_csv_bytes(
    df: pd.DataFrame,
    delimiter: str = ",",
    formula_protection: bool = True,
    column_types: dict[str, str] | None = None,
) -> tuple[bytes, int]:
    column_types = column_types or {}
    escaped_count = 0

    headers = [str(c) for c in df.columns]
    safe_headers: list[str] = []
    for h in headers:
        if formula_protection and is_formula_trigger(h):
            safe_headers.append(f"'{h}")
            escaped_count += 1
        else:
            safe_headers.append(h)

    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=delimiter, quotechar='"', lineterminator="\n")
    writer.writerow(safe_headers)

    for row in df.itertuples(index=False, name=None):
        safe_row: list[str] = []
        for idx, val in enumerate(row):
            s = str(val)
            if not formula_protection:
                safe_row.append(s)
                continue
            col_name = headers[idx] if idx < len(headers) else ""
            ctype = column_types.get(col_name)
            is_num = ctype in ("integer", "decimal")
            is_phone = ctype == "phone"
            safe_val, did_escape = escape_formula_cell(s, is_num, is_phone)
            if did_escape:
                escaped_count += 1
            safe_row.append(safe_val)
        writer.writerow(safe_row)

    return buf.getvalue().encode("utf-8"), escaped_count


def export_issues_to_csv_bytes(
    issues: list[CleaningIssue], delimiter: str = ","
) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=delimiter, quotechar='"', lineterminator="\n")
    writer.writerow(["row", "column", "original", "new", "rule_id", "severity"])
    for issue in issues:
        writer.writerow([
            str(issue.row),
            issue.column,
            issue.original,
            issue.new,
            issue.rule_id,
            issue.severity,
        ])
    return buf.getvalue().encode("utf-8")


def export_dataframe_to_xlsx_bytes(
    df: pd.DataFrame,
    formula_protection: bool = True,
    column_types: dict[str, str] | None = None,
) -> tuple[bytes, int]:
    column_types = column_types or {}
    escaped_count = 0

    wb = openpyxl.Workbook(write_only=True)
    ws = wb.create_sheet(title="Cleaned Data")

    headers = [str(c) for c in df.columns]
    safe_headers: list[str] = []
    for h in headers:
        if formula_protection and is_formula_trigger(h):
            safe_headers.append(f"'{h}")
            escaped_count += 1
        else:
            safe_headers.append(h)
    ws.append(safe_headers)

    for row in df.itertuples(index=False, name=None):
        out_row: list[object] = []
        for idx, val in enumerate(row):
            s = str(val)
            col_name = headers[idx] if idx < len(headers) else ""
            ctype = column_types.get(col_name)
            is_num = ctype in ("integer", "decimal")
            is_phone = ctype == "phone"
            if is_num and re.match(r"^-?\d+(?:\.\d+)?$", s.strip()):
                num = float(s.strip())
                out_row.append(int(num) if num.is_integer() and "." not in s else num)
                continue
            if formula_protection:
                safe_val, did_escape = escape_formula_cell(s, is_num, is_phone)
                if did_escape:
                    escaped_count += 1
                out_row.append(safe_val)
            else:
                out_row.append(s)
        ws.append(out_row)

    out = io.BytesIO()
    wb.save(out)
    return out.getvalue(), escaped_count
