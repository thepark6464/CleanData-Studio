import json
from pathlib import Path
import pytest

from app.config import Settings
from app.models import OperationRequest
from app.services.pipeline import run_cleaning_pipeline
from app.services.validators.file_validator import parse_upload_bytes
from app.utils.security import ApiServiceError

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "fixtures"


def _settings() -> Settings:
    return Settings(storage_dir="/tmp/cleandata_test_storage")


def test_golden_messy_customers_parity():
    raw = (FIXTURES_DIR / "messy_customers.csv").read_bytes()
    expected = json.loads((FIXTURES_DIR / "messy_customers.expected.json").read_text("utf-8"))

    dataset = parse_upload_bytes(raw, "messy_customers.csv", _settings())
    ops = [
        OperationRequest(id="remove_empty_rows", enabled=True),
        OperationRequest(id="trim_whitespace", enabled=True, params={"collapseInternal": True}),
        OperationRequest(id="normalize_emails", enabled=True),
        OperationRequest(
            id="standardize_dates",
            enabled=True,
            params={"dayFirst": True, "outputFormat": "YYYY-MM-DD"},
        ),
        OperationRequest(id="remove_duplicates", enabled=True, params={"keep": "first"}),
    ]

    cleaned_df, output_bytes, report = run_cleaning_pipeline(
        dataset, ops, job_id="test_golden_1", output_format="csv", formula_protection=True
    )
    csv_text = output_bytes.decode("utf-8")

    assert report.rowsBefore == expected["rowsBefore"]
    assert report.rowsAfter == expected["rowsAfter"]
    assert report.emptyRowsRemoved == expected["emptyRowsRemoved"]
    assert report.duplicatesRemoved == expected["duplicatesRemoved"]
    assert report.formulaCellsEscaped == expected["formulaCellsEscaped"]
    assert cleaned_df.iloc[0].tolist() == expected["expectedFirstRow"]
    assert cleaned_df.iloc[1].tolist() == expected["expectedSecondRowDayFirst"]
    for escaped in expected["expectedFormulaNoteCells"]:
        assert escaped in csv_text
    assert ",-45.00," in csv_text
    assert report.qualityAfter.score > report.qualityBefore.score


def test_ambiguous_dates_day_first_vs_month_first():
    raw = (FIXTURES_DIR / "ambiguous_dates.csv").read_bytes()
    dataset = parse_upload_bytes(raw, "ambiguous_dates.csv", _settings())

    res_dmy, _, rep_dmy = run_cleaning_pipeline(
        dataset,
        [
            OperationRequest(
                id="standardize_dates",
                enabled=True,
                params={"columns": ["order_date"], "dayFirst": True, "outputFormat": "YYYY-MM-DD"},
            )
        ],
        job_id="dmy",
    )
    assert res_dmy.iloc[0]["order_date"] == "2025-04-03"
    assert res_dmy.iloc[1]["order_date"] == "2025-04-15"
    assert res_dmy.iloc[3]["order_date"] == "invalid_date"
    assert any(w.code == "UNPARSEABLE_DATES_PRESERVED" for w in rep_dmy.warnings)

    res_mdy, _, _ = run_cleaning_pipeline(
        dataset,
        [
            OperationRequest(
                id="standardize_dates",
                enabled=True,
                params={"columns": ["order_date"], "dayFirst": False, "outputFormat": "YYYY-MM-DD"},
            )
        ],
        job_id="mdy",
    )
    assert res_mdy.iloc[0]["order_date"] == "2025-03-04"


def test_bom_and_quoted_newlines():
    raw = b"\xef\xbb\xbf" + (FIXTURES_DIR / "bom_quoted_newlines.csv").read_bytes()
    dataset = parse_upload_bytes(raw, "bom_quoted_newlines.csv", _settings())
    assert dataset.encoding == "UTF-8-BOM"
    assert dataset.headers[0] == "id"
    assert len(dataset.df) == 2
    assert dataset.df.iloc[0]["address"] == "12 MG Road\nBengaluru, KA"


def test_windows1252_semicolon_fallback():
    raw = "name;city\nMüller;Café\n".encode("cp1252")
    dataset = parse_upload_bytes(raw, "latin1.csv", _settings())
    assert dataset.delimiter == ";"
    assert dataset.df.iloc[0].tolist() == ["Müller", "Café"]


def test_duplicate_blank_headers():
    raw = (FIXTURES_DIR / "duplicate_blank_headers.csv").read_bytes()
    dataset = parse_upload_bytes(raw, "duplicate_blank_headers.csv", _settings())
    assert dataset.headers == ["name", "column_2", "name_2", "email"]


def test_header_only_and_empty_and_malformed():
    header_only = parse_upload_bytes(
        (FIXTURES_DIR / "header_only.csv").read_bytes(), "header_only.csv", _settings()
    )
    assert len(header_only.df) == 0

    with pytest.raises(ApiServiceError) as empty_exc:
        parse_upload_bytes((FIXTURES_DIR / "empty.csv").read_bytes(), "empty.csv", _settings())
    assert empty_exc.value.code == "EMPTY_FILE"

    with pytest.raises(ApiServiceError) as quotes_exc:
        parse_upload_bytes(
            (FIXTURES_DIR / "malformed_quotes.csv").read_bytes(), "malformed_quotes.csv", _settings()
        )
    assert quotes_exc.value.code == "MALFORMED_CSV"


def test_pipe_delimiter_and_phone_and_xlsx_roundtrip():
    pipe_ds = parse_upload_bytes(
        (FIXTURES_DIR / "pipe_delimiter.csv").read_bytes(), "pipe_delimiter.csv", _settings()
    )
    assert pipe_ds.delimiter == "|"

    phone_ds = parse_upload_bytes(
        b"name,phone\nAsha,098765 43210\nBad,123\n", "phones.csv", _settings()
    )
    cleaned_phone, xlsx_bytes, rep = run_cleaning_pipeline(
        phone_ds,
        [
            OperationRequest(
                id="normalize_phone_numbers",
                enabled=True,
                params={"columns": ["phone"], "defaultRegion": "IN", "format": "E.164"},
            )
        ],
        job_id="phone_xlsx",
        output_format="xlsx",
    )
    assert cleaned_phone.iloc[0]["phone"] == "+919876543210"
    assert cleaned_phone.iloc[1]["phone"] == "123"
    assert any(w.code == "INVALID_PHONE_FORMAT" for w in rep.warnings)

    reparsed_xlsx = parse_upload_bytes(xlsx_bytes, "cleaned.xlsx", _settings())
    assert reparsed_xlsx.input_format == "xlsx"
    assert reparsed_xlsx.df.iloc[0]["phone"] == "+919876543210"
