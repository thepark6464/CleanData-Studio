import datetime as dt
import hashlib
import hmac
import json
from pathlib import Path
from unittest.mock import patch
import jwt
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.services.credits import estimate_credits_for_rows

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "fixtures"
TEST_JWT_SECRET = "test-supabase-jwt-secret-must-be-at-least-32-chars"
TEST_WEBHOOK_SECRET = "test-razorpay-webhook-secret-123456"


def _make_jwt(user_id: str, email: str = "user@example.com") -> str:
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


def _sign_webhook(body_bytes: bytes) -> str:
    return hmac.new(
        TEST_WEBHOOK_SECRET.encode("utf-8"),
        body_bytes,
        hashlib.sha256,
    ).hexdigest()


def _make_client(tmp_path) -> TestClient:
    settings = Settings(
        environment="test",
        storage_dir=str(tmp_path),
        supabase_jwt_secret=TEST_JWT_SECRET,
        payment_provider="test_hmac",
        payment_webhook_secret=TEST_WEBHOOK_SECRET,
        rate_limit_per_min=200,
    )
    return TestClient(create_app(settings))


def test_estimate_credits_ceil():
    assert estimate_credits_for_rows(0) == 0
    assert estimate_credits_for_rows(1) == 1
    assert estimate_credits_for_rows(1000) == 1
    assert estimate_credits_for_rows(1001) == 2
    assert estimate_credits_for_rows(2500) == 3


def test_checkout_webhook_signature_idempotency_and_split_spend(tmp_path):
    client = _make_client(tmp_path)
    user_id = "user-billing-1"
    token = _make_jwt(user_id)
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Checkout a credit pack (10 Credits = Rs 49 = 4900 paise)
    pack_checkout = client.post(
        "/v1/billing/checkout",
        json={"kind": "credit_pack", "item_name": "10 Credits"},
        headers=headers,
    )
    assert pack_checkout.status_code == 200
    pack_order_id = pack_checkout.json()["order_id"]
    assert pack_checkout.json()["amount_paise"] == 4900

    # Invalid webhook signature -> 401
    bad_body = json.dumps(
        {"event_id": "evt_1", "order_id": pack_order_id, "status": "paid"}
    ).encode("utf-8")
    bad_resp = client.post(
        "/v1/webhooks/payments",
        content=bad_body,
        headers={"X-Webhook-Signature": "invalid-sig"},
    )
    assert bad_resp.status_code == 401
    assert bad_resp.json()["error"]["code"] == "INVALID_WEBHOOK_SIGNATURE"

    # Valid webhook grants 10 purchased credits
    good_resp = client.post(
        "/v1/webhooks/payments",
        content=bad_body,
        headers={"X-Webhook-Signature": _sign_webhook(bad_body)},
    )
    assert good_resp.status_code == 200
    assert good_resp.json()["result"]["status"] == "processed"

    # Duplicate webhook event_id is deduplicated (does NOT double-grant)
    dup_resp = client.post(
        "/v1/webhooks/payments",
        content=bad_body,
        headers={"X-Webhook-Signature": _sign_webhook(bad_body)},
    )
    assert dup_resp.status_code == 200
    assert dup_resp.json()["result"]["status"] == "already_processed"

    # 2. Subscribe to Starter (100 monthly credits)
    sub_checkout = client.post(
        "/v1/billing/checkout",
        json={"kind": "subscription", "item_name": "Starter"},
        headers=headers,
    )
    assert sub_checkout.status_code == 200
    sub_order_id = sub_checkout.json()["order_id"]
    sub_body = json.dumps(
        {"event_id": "evt_sub_1", "order_id": sub_order_id, "status": "paid"}
    ).encode("utf-8")
    client.post(
        "/v1/webhooks/payments",
        content=sub_body,
        headers={"X-Webhook-Signature": _sign_webhook(sub_body)},
    )

    summary = client.get("/v1/billing/summary", headers=headers).json()
    assert summary["subscription"]["plan_name"] == "Starter"
    assert summary["wallet"]["subscription_balance"] == 100
    assert summary["wallet"]["purchased_balance"] == 10
    assert summary["wallet"]["total_balance"] == 110

    # 3. Run a 2,500-row CSV job (costs 3 credits); verify subscription spent BEFORE purchased
    rows = ["name,email"] + [f"User {i},user{i}@example.com" for i in range(2500)]
    csv_bytes = "\n".join(rows).encode("utf-8")
    clean_resp = client.post(
        "/v1/clean",
        files={"file": ("big.csv", csv_bytes, "text/csv")},
        headers={**headers, "Idempotency-Key": "job-idem-1"},
    )
    assert clean_resp.status_code == 200
    job_id = clean_resp.json()["job_id"]

    status = client.get(f"/v1/jobs/{job_id}", headers=headers).json()
    assert status["credits_charged"] == 3

    summary_after = client.get("/v1/billing/summary", headers=headers).json()
    assert summary_after["wallet"]["subscription_balance"] == 97
    assert summary_after["wallet"]["purchased_balance"] == 10

    # Idempotent retry does not double-charge
    retry_resp = client.post(
        "/v1/clean",
        files={"file": ("big.csv", csv_bytes, "text/csv")},
        headers={**headers, "Idempotency-Key": "job-idem-1"},
    )
    assert retry_resp.status_code == 200
    assert retry_resp.json()["job_id"] == job_id
    assert client.get("/v1/billing/summary", headers=headers).json()["wallet"]["subscription_balance"] == 97


def test_failed_job_refunds_reserved_credits_and_rejects_insufficient(tmp_path):
    client = _make_client(tmp_path)
    user_id = "user-refund-2"
    token = _make_jwt(user_id)
    headers = {"Authorization": f"Bearer {token}"}

    # Seed user on Starter with 2 subscription + 3 purchased credits directly via store
    store = client.app.state.credits
    store.grant_subscription_credits(
        user_id,
        "Starter",
        2,
        dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=30),
    )
    store.grant_purchased_credits(user_id, 3, "pay-seed-1")

    # 6,500 rows requires 7 credits -> rejected with 402 BEFORE processing
    big_rows = ["name,email"] + [f"U{i},u{i}@example.com" for i in range(6500)]
    too_expensive = client.post(
        "/v1/clean",
        files={"file": ("too_big.csv", "\n".join(big_rows).encode("utf-8"), "text/csv")},
        headers=headers,
    )
    assert too_expensive.status_code == 402
    assert too_expensive.json()["error"]["code"] == "INSUFFICIENT_CREDITS"

    # 3,500 rows requires 4 credits (spends 2 sub + 2 pur), force pipeline failure -> automatic refund!
    mid_rows = ["name,email"] + [f"U{i},u{i}@example.com" for i in range(3500)]
    with patch("app.routes.jobs.run_cleaning_pipeline", side_effect=RuntimeError("Simulated failure")):
        failed = client.post(
            "/v1/clean",
            files={"file": ("fail.csv", "\n".join(mid_rows).encode("utf-8"), "text/csv")},
            headers=headers,
        )
    assert failed.status_code == 500

    summary = client.get("/v1/billing/summary", headers=headers).json()
    assert summary["wallet"]["subscription_balance"] == 2
    assert summary["wallet"]["purchased_balance"] == 3
    tx_types = [t["transaction_type"] for t in summary["transactions"]]
    assert "refund" in tx_types


def test_free_plan_daily_server_limit_and_expiration(tmp_path):
    client = _make_client(tmp_path)
    user_id = "user-free-3"
    token = _make_jwt(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    csv_bytes = (FIXTURES_DIR / "messy_customers.csv").read_bytes()

    # Free user gets 3 server jobs/day
    for _ in range(3):
        resp = client.post(
            "/v1/clean",
            files={"file": ("messy.csv", csv_bytes, "text/csv")},
            headers=headers,
        )
        assert resp.status_code == 200

    # 4th job same day is rejected with 429 DAILY_JOB_LIMIT_REACHED
    fourth = client.post(
        "/v1/clean",
        files={"file": ("messy.csv", csv_bytes, "text/csv")},
        headers=headers,
    )
    assert fourth.status_code == 429
    assert fourth.json()["error"]["code"] == "DAILY_JOB_LIMIT_REACHED"

    # Expired subscription credits are zeroed out cleanly
    store = client.app.state.credits
    store.grant_subscription_credits(
        "expired-user",
        "Pro",
        500,
        dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1),
    )
    expired_count = store.expire_credits()
    assert expired_count == 1
    assert store.get_summary("expired-user").wallet.subscription_balance == 0
