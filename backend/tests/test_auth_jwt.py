import datetime as dt
from pathlib import Path
import jwt
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "fixtures"
TEST_JWT_SECRET = "test-supabase-jwt-secret-must-be-at-least-32-chars"


def _make_jwt(user_id: str, email: str, expired: bool = False) -> str:
    now = dt.datetime.now(dt.timezone.utc)
    exp = now - dt.timedelta(minutes=5) if expired else now + dt.timedelta(hours=1)
    return jwt.encode(
        {
            "sub": user_id,
            "email": email,
            "role": "authenticated",
            "aud": "authenticated",
            "exp": int(exp.timestamp()),
        },
        TEST_JWT_SECRET,
        algorithm="HS256",
    )


def _make_client(tmp_path) -> TestClient:
    settings = Settings(
        storage_dir=str(tmp_path),
        supabase_jwt_secret=TEST_JWT_SECRET,
        rate_limit_per_min=120,
    )
    return TestClient(create_app(settings))


def test_jwt_validation_and_account_routes(tmp_path):
    client = _make_client(tmp_path)

    # Missing token on /v1/account/me -> 401
    unauth = client.get("/v1/account/me")
    assert unauth.status_code == 401
    assert unauth.json()["error"]["code"] == "UNAUTHORIZED"

    # Expired token -> 401
    expired_token = _make_jwt("user-a", "a@example.com", expired=True)
    exp_resp = client.get(
        "/v1/account/me",
        headers={"Authorization": f"Bearer {expired_token}"},
    )
    assert exp_resp.status_code == 401
    assert exp_resp.json()["error"]["code"] == "TOKEN_EXPIRED"

    # Valid token -> 200
    token_a = _make_jwt("user-a", "a@example.com")
    me = client.get(
        "/v1/account/me",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert me.status_code == 200
    assert me.json()["user"]["id"] == "user-a"
    assert me.json()["user"]["email"] == "a@example.com"

    # Account deletion request -> 200
    del_req = client.post(
        "/v1/account/delete-request",
        json={"reason": "No longer needed"},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert del_req.status_code == 200
    assert del_req.json()["user_id"] == "user-a"


def test_cross_user_job_isolation(tmp_path):
    client = _make_client(tmp_path)
    token_a = _make_jwt("11111111-1111-1111-1111-111111111111", "a@example.com")
    token_b = _make_jwt("22222222-2222-2222-2222-222222222222", "b@example.com")
    csv_bytes = (FIXTURES_DIR / "messy_customers.csv").read_bytes()

    # User A creates a cleaning job
    res_a = client.post(
        "/v1/clean",
        files={"file": ("messy_customers.csv", csv_bytes, "text/csv")},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert res_a.status_code == 200
    job_a = res_a.json()["job_id"]

    # User A sees their job
    list_a = client.get("/v1/jobs", headers={"Authorization": f"Bearer {token_a}"}).json()
    assert list_a["total"] == 1
    assert list_a["items"][0]["job_id"] == job_a

    # User B does NOT see User A's job and gets 403 on direct access
    list_b = client.get("/v1/jobs", headers={"Authorization": f"Bearer {token_b}"}).json()
    assert list_b["total"] == 0

    for endpoint in [
        f"/v1/jobs/{job_a}",
        f"/v1/jobs/{job_a}/report",
        f"/v1/jobs/{job_a}/download",
    ]:
        forbidden = client.get(endpoint, headers={"Authorization": f"Bearer {token_b}"})
        assert forbidden.status_code == 403
        assert forbidden.json()["error"]["code"] == "FORBIDDEN"

    # Unauthenticated request also gets 403 for User A's owned job
    anon_forbidden = client.get(f"/v1/jobs/{job_a}")
    assert anon_forbidden.status_code == 403
