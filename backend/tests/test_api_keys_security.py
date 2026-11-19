import datetime as dt
from pathlib import Path
import jwt
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "fixtures"
TEST_JWT_SECRET = "test-supabase-jwt-secret-must-be-at-least-32-chars"


def _make_jwt(user_id: str, email: str = "pro@example.com") -> str:
    now = dt.datetime.now(dt.timezone.utc)
    return jwt.encode(
        {
            "sub": user_id,
            "email": email,
            "role": "authenticated",
            "aud": "authenticated",
            "exp": int((now + dt.timedelta(hours=1)).timestamp()),
        },
        TEST_JWT_SECRET,
        algorithm="HS256",
    )


def _make_client(tmp_path, environment: str = "production") -> TestClient:
    settings = Settings(
        environment=environment,
        storage_dir=str(tmp_path),
        supabase_jwt_secret=TEST_JWT_SECRET,
        api_key_pepper="test-pepper-secret-0123456789abcdef",
        rate_limit_per_min=60,
    )
    return TestClient(create_app(settings))


def test_api_key_lifecycle_plan_gating_and_usage(tmp_path):
    client = _make_client(tmp_path)
    free_user = "user-free-no-api"
    pro_user = "user-pro-api"
    free_headers = {"Authorization": f"Bearer {_make_jwt(free_user)}"}
    pro_headers = {"Authorization": f"Bearer {_make_jwt(pro_user)}"}

    # 1. Free plan cannot create API keys -> 403 PLAN_UPGRADE_REQUIRED
    denied = client.post("/v1/api-keys", json={"name": "CI Key"}, headers=free_headers)
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "PLAN_UPGRADE_REQUIRED"

    # 2. Upgrade pro_user to Pro (500 monthly credits, api_access=True)
    client.app.state.credits.grant_subscription_credits(
        pro_user,
        "Pro",
        500,
        dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=30),
    )

    created = client.post("/v1/api-keys", json={"name": "ETL Worker"}, headers=pro_headers)
    assert created.status_code == 200
    body = created.json()
    raw_key = body["plaintext_key"]
    key_id = body["key"]["id"]
    assert raw_key.startswith("cd_live_")
    assert "key_hash" not in body["key"]

    # List endpoint omits key_hash and plaintext
    listed = client.get("/v1/api-keys", headers=pro_headers).json()
    assert len(listed["items"]) == 1
    assert listed["items"][0]["prefix"] == raw_key[:14]
    assert "key_hash" not in listed["items"][0]

    # 3. Call /v1/credits, /v1/clean, and /v1/usage using the API key
    api_headers = {"Authorization": f"Bearer {raw_key}"}
    credits_resp = client.get("/v1/credits", headers=api_headers)
    assert credits_resp.status_code == 200
    assert credits_resp.json()["wallet"]["subscription_balance"] == 500

    csv_bytes = (FIXTURES_DIR / "messy_customers.csv").read_bytes()
    clean_resp = client.post(
        "/v1/clean",
        files={"file": ("messy.csv", csv_bytes, "text/csv")},
        headers=api_headers,
    )
    assert clean_resp.status_code == 200
    job_id = clean_resp.json()["job_id"]

    status_resp = client.get(f"/v1/jobs/{job_id}", headers=api_headers)
    assert status_resp.status_code == 200
    assert status_resp.json()["credits_charged"] == 1

    usage_resp = client.get("/v1/usage", headers=api_headers)
    assert usage_resp.status_code == 200
    assert usage_resp.json()["total_requests_logged"] >= 1
    assert usage_resp.json()["rate_limit_per_min"] == 60

    # 4. Cross-user revocation fails cleanly and owner revocation invalidates key immediately
    other_del = client.delete(f"/v1/api-keys/{key_id}", headers=free_headers)
    assert other_del.status_code == 404

    revoked = client.delete(f"/v1/api-keys/{key_id}", headers=pro_headers)
    assert revoked.status_code == 200

    rejected = client.get("/v1/credits", headers=api_headers)
    assert rejected.status_code == 401
    assert rejected.json()["error"]["code"] == "INVALID_API_KEY"


def test_security_headers_and_metrics(tmp_path):
    client = _make_client(tmp_path, environment="production")
    resp = client.get("/health/metrics")
    assert resp.status_code == 200
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["x-frame-options"] == "DENY"
    assert resp.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert "strict-transport-security" in resp.headers
    assert "content-security-policy" in resp.headers
    assert "uptime_seconds" in resp.json()
