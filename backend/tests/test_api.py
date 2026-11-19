import io
import json
import zipfile
from pathlib import Path
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "fixtures"


def _make_client(rate_limit: int = 60, tmp_dir: str = "/tmp/cleandata_api_test") -> TestClient:
    settings = Settings(
        storage_dir=tmp_dir,
        rate_limit_per_min=rate_limit,
        signed_url_ttl_seconds=300,
    )
    return TestClient(create_app(settings))


def test_health_and_upload_and_clean_pipeline(tmp_path):
    client = _make_client(tmp_dir=str(tmp_path))
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"

    csv_bytes = (FIXTURES_DIR / "messy_customers.csv").read_bytes()

    # 1. Separate /files/upload -> /clean via file_id
    up = client.post(
        "/v1/files/upload",
        files={"file": ("messy_customers.csv", csv_bytes, "text/csv")},
    )
    assert up.status_code == 200
    file_id = up.json()["file_id"]

    ops = json.dumps(
        [
            {"id": "remove_empty_rows", "enabled": True, "params": {}},
            {"id": "remove_duplicates", "enabled": True, "params": {"keep": "first"}},
            {"id": "trim_whitespace", "enabled": True, "params": {"collapseInternal": True}},
        ]
    )
    clean_resp = client.post(
        "/v1/clean",
        data={"file_id": file_id, "operations": ops, "output_format": "csv"},
        headers={"Idempotency-Key": "idem-1"},
    )
    assert clean_resp.status_code == 200
    job_id = clean_resp.json()["job_id"]

    # Idempotency retry returns same job_id without reprocessing
    retry_resp = client.post(
        "/v1/clean",
        data={"file_id": file_id, "operations": ops, "output_format": "csv"},
        headers={"Idempotency-Key": "idem-1"},
    )
    assert retry_resp.status_code == 200
    assert retry_resp.json()["job_id"] == job_id

    status = client.get(f"/v1/jobs/{job_id}").json()
    assert status["status"] == "completed"
    assert status["rows_processed"] == 8

    report = client.get(f"/v1/jobs/{job_id}/report").json()["report"]
    assert report["emptyRowsRemoved"] == 1
    assert report["duplicatesRemoved"] == 1

    dl_meta = client.get(f"/v1/jobs/{job_id}/download").json()
    dl_path = dl_meta["download_url"].replace("http://testserver", "")
    artifact = client.get(dl_path)
    assert artifact.status_code == 200
    assert "attachment;" in artifact.headers["content-disposition"]


def test_inline_clean_and_error_envelope_and_rate_limit(tmp_path):
    client = _make_client(rate_limit=4, tmp_dir=str(tmp_path))

    # Binary masquerading as CSV returns 415 structured error envelope
    bad = client.post(
        "/v1/clean",
        files={"file": ("fake.csv", b"%PDF-1.7 binary", "text/csv")},
    )
    assert bad.status_code == 415
    body = bad.json()
    assert body["success"] is False
    assert body["error"]["code"] == "UNSUPPORTED_BINARY_FILE"
    assert "request_id" in body["error"]

    # Zip-bomb / excessive entries guard
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w") as zf:
        for i in range(205):
            zf.writestr(f"entry_{i}.xml", "<x/>")
    bomb = client.post(
        "/v1/files/upload",
        files={
            "file": (
                "bomb.xlsx",
                zbuf.getvalue(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert bomb.status_code == 422
    assert bomb.json()["error"]["code"] == "XLSX_TOO_MANY_ENTRIES"

    # Rate limit triggers 429 with Retry-After
    client.get("/v1/jobs")
    client.get("/v1/jobs")
    limited = client.get("/v1/jobs")
    assert limited.status_code == 429
    assert "Retry-After" in limited.headers
    assert limited.json()["error"]["code"] == "RATE_LIMIT_EXCEEDED"
