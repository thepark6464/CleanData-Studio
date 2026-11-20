import datetime as dt
from pathlib import Path
from types import SimpleNamespace
import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from app.auth import jwt_auth
from app.config import Settings
from app.main import create_app

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "fixtures"
TEST_JWT_SECRET = "test-supabase-jwt-secret-must-be-at-least-32-chars"
TEST_SUPABASE_URL = "https://oqvpyoirsgvhpxfnqpgo.supabase.co"


def _make_hs256_jwt(user_id: str, email: str, expired: bool = False) -> str:
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


def _generate_es256_keypair():
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()
    return private_key, public_key


def _make_es256_jwt(
    private_key,
    *,
    user_id: str,
    email: str,
    issuer: str = f"{TEST_SUPABASE_URL}/auth/v1",
    audience: str = "authenticated",
    expired: bool = False,
    kid: str = "test-es256-kid-1",
) -> str:
    now = dt.datetime.now(dt.timezone.utc)
    exp = now - dt.timedelta(minutes=5) if expired else now + dt.timedelta(hours=1)
    return jwt.encode(
        {
            "sub": user_id,
            "email": email,
            "role": "authenticated",
            "aud": audience,
            "iss": issuer,
            "exp": int(exp.timestamp()),
        },
        private_key,
        algorithm="ES256",
        headers={"kid": kid},
    )


def _make_client(
    tmp_path,
    *,
    supabase_url: str = "",
    supabase_jwt_secret: str = TEST_JWT_SECRET,
) -> TestClient:
    settings = Settings(
        storage_dir=str(tmp_path),
        supabase_url=supabase_url,
        supabase_jwt_secret=supabase_jwt_secret,
        rate_limit_per_min=120,
    )
    return TestClient(create_app(settings))


def test_es256_jwks_validation_expiry_issuer_and_missing_config(tmp_path, monkeypatch):
    private_key, public_key = _generate_es256_keypair()
    other_private_key, _ = _generate_es256_keypair()

    class FakeJwkClient:
        def get_signing_key_from_jwt(self, token: str):
            return SimpleNamespace(key=public_key)

    seen_urls: list[str] = []

    def fake_get_jwk_client(jwks_url: str):
        seen_urls.append(jwks_url)
        return FakeJwkClient()

    monkeypatch.setattr(jwt_auth, "get_jwk_client", fake_get_jwk_client)

    # 1. Missing SUPABASE_URL on ES256 token -> 500 AUTH_NOT_CONFIGURED
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    unconfigured_client = _make_client(tmp_path, supabase_url="", supabase_jwt_secret="")
    es_token = _make_es256_jwt(private_key, user_id="user-es256", email="es256@example.com")

    health_unconf = unconfigured_client.get("/api/health").json()
    assert health_unconf["auth"]["jwks_configured"] is False

    err_resp = unconfigured_client.get(
        "/api/v1/account/me",
        headers={"Authorization": f"Bearer {es_token}"},
    )
    assert err_resp.status_code == 500
    assert err_resp.json()["error"]["code"] == "AUTH_NOT_CONFIGURED"
    assert "SUPABASE_URL" in err_resp.json()["error"]["message"]

    # 2. Setting SUPABASE_URL dynamically via os.environ works without recreating Settings
    monkeypatch.setenv("SUPABASE_URL", f"{TEST_SUPABASE_URL}/")
    ok_resp = unconfigured_client.get(
        "/api/v1/account/me",
        headers={"Authorization": f"Bearer {es_token}"},
    )
    assert ok_resp.status_code == 200
    assert ok_resp.json()["user"]["id"] == "user-es256"
    assert ok_resp.json()["user"]["email"] == "es256@example.com"
    assert seen_urls[-1] == f"{TEST_SUPABASE_URL}/auth/v1/.well-known/jwks.json"

    # 3. Configured client health reports jwks_configured=True
    client = _make_client(tmp_path, supabase_url=TEST_SUPABASE_URL, supabase_jwt_secret="")
    assert client.get("/health").json()["auth"]["jwks_configured"] is True

    # 4. Expired ES256 token -> 401 TOKEN_EXPIRED
    expired_es = _make_es256_jwt(
        private_key, user_id="user-es256", email="es256@example.com", expired=True
    )
    exp_resp = client.get(
        "/v1/account/me",
        headers={"Authorization": f"Bearer {expired_es}"},
    )
    assert exp_resp.status_code == 401
    assert exp_resp.json()["error"]["code"] == "TOKEN_EXPIRED"

    # 5. Wrong issuer -> 401 INVALID_TOKEN
    bad_iss = _make_es256_jwt(
        private_key,
        user_id="user-es256",
        email="es256@example.com",
        issuer="https://evil.supabase.co/auth/v1",
    )
    assert (
        client.get("/v1/account/me", headers={"Authorization": f"Bearer {bad_iss}"}).status_code
        == 401
    )

    # 6. Wrong audience -> 401 INVALID_TOKEN
    bad_aud = _make_es256_jwt(
        private_key,
        user_id="user-es256",
        email="es256@example.com",
        audience="anon",
    )
    assert (
        client.get("/v1/account/me", headers={"Authorization": f"Bearer {bad_aud}"}).status_code
        == 401
    )

    # 7. Invalid signature (signed with wrong private key) -> 401 INVALID_TOKEN
    forged = _make_es256_jwt(
        other_private_key, user_id="user-es256", email="es256@example.com"
    )
    assert (
        client.get("/v1/account/me", headers={"Authorization": f"Bearer {forged}"}).status_code
        == 401
    )


def test_jwt_validation_and_account_routes(tmp_path):
    client = _make_client(tmp_path)

    # Missing token on /v1/account/me -> 401
    unauth = client.get("/v1/account/me")
    assert unauth.status_code == 401
    assert unauth.json()["error"]["code"] == "UNAUTHORIZED"

    # Expired token -> 401
    expired_token = _make_hs256_jwt("user-a", "a@example.com", expired=True)
    exp_resp = client.get(
        "/v1/account/me",
        headers={"Authorization": f"Bearer {expired_token}"},
    )
    assert exp_resp.status_code == 401
    assert exp_resp.json()["error"]["code"] == "TOKEN_EXPIRED"

    # Valid token -> 200 (also works via /api/v1/account/me)
    token_a = _make_hs256_jwt("user-a", "a@example.com")
    me = client.get(
        "/api/v1/account/me",
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
    token_a = _make_hs256_jwt("11111111-1111-1111-1111-111111111111", "a@example.com")
    token_b = _make_hs256_jwt("22222222-2222-2222-2222-222222222222", "b@example.com")
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
