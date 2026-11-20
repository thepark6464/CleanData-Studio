import base64
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
from app.services.credits import PACK_CATALOG, PLAN_CATALOG, estimate_credits_for_rows
from app.services.payments import CashfreePaymentAdapter, OrderVerificationResult, SubscriptionVerificationResult

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "fixtures"
TEST_JWT_SECRET = "test-supabase-jwt-secret-must-be-at-least-32-chars"
TEST_WEBHOOK_SECRET = "test-cashfree-webhook-secret-123456"


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


def _sign_cashfree_webhook(
    raw_body: bytes, timestamp: str = "1718450000000", secret: str = TEST_WEBHOOK_SECRET
) -> dict[str, str]:
    signed_payload = timestamp.encode("utf-8") + raw_body
    digest = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).digest()
    signature = base64.b64encode(digest).decode("utf-8")
    return {
        "x-webhook-timestamp": timestamp,
        "x-webhook-signature": signature,
        "Content-Type": "application/json",
    }


def _make_client(tmp_path) -> TestClient:
    settings = Settings(
        environment="test",
        storage_dir=str(tmp_path),
        supabase_jwt_secret=TEST_JWT_SECRET,
        payment_provider="test_hmac",
        cashfree_webhook_secret=TEST_WEBHOOK_SECRET,
        rate_limit_per_min=300,
    )
    return TestClient(create_app(settings))


def test_estimate_credits_ceil():
    assert estimate_credits_for_rows(0) == 0
    assert estimate_credits_for_rows(1) == 1
    assert estimate_credits_for_rows(1000) == 1
    assert estimate_credits_for_rows(1001) == 2
    assert estimate_credits_for_rows(2500) == 3


def test_catalog_pricing_and_credit_packs():
    assert PLAN_CATALOG["Free"].monthly_price_paise == 0
    assert PLAN_CATALOG["Starter"].monthly_price_paise == 29900
    assert PLAN_CATALOG["Starter"].monthly_credits == 100
    assert PLAN_CATALOG["Pro"].monthly_price_paise == 79900
    assert PLAN_CATALOG["Pro"].monthly_credits == 500
    assert PLAN_CATALOG["Business"].monthly_price_paise == 199900
    assert PLAN_CATALOG["Business"].monthly_credits == 2000

    assert PACK_CATALOG["10 Credits"].price_paise == 4900
    assert PACK_CATALOG["50 Credits"].price_paise == 14900
    assert PACK_CATALOG["150 Credits"].price_paise == 34900
    assert PACK_CATALOG["500 Credits"].price_paise == 89900


def test_cashfree_adapter_webhook_signature_and_payload_parsing():
    cfg = Settings(
        environment="test",
        cashfree_app_id="cf_app_test",
        cashfree_secret_key="cf_secret_test",
        cashfree_webhook_secret=TEST_WEBHOOK_SECRET,
        cashfree_env="sandbox",
        cashfree_api_version="2025-01-01",
    )
    adapter = CashfreePaymentAdapter(cfg)
    assert adapter.cashfree_base_url if hasattr(adapter, "cashfree_base_url") else adapter.base_url == "https://sandbox.cashfree.com/pg"

    payload_bytes = json.dumps(
        {
            "type": "PAYMENT_SUCCESS_WEBHOOK",
            "event_time": "2026-06-15T12:20:30+05:30",
            "data": {
                "order": {"order_id": "cd_ord_123", "order_amount": 149.0, "order_currency": "INR"},
                "payment": {"cf_payment_id": "99887766", "payment_status": "SUCCESS", "payment_amount": 149.0, "payment_currency": "INR"},
            },
        }
    ).encode("utf-8")
    headers = _sign_cashfree_webhook(payload_bytes)
    assert adapter.verify_webhook_signature(
        payload_bytes, headers["x-webhook-signature"], headers["x-webhook-timestamp"]
    )
    # Missing timestamp must fail
    assert not adapter.verify_webhook_signature(payload_bytes, headers["x-webhook-signature"], "")
    # Tampered payload must fail
    assert not adapter.verify_webhook_signature(
        payload_bytes + b" ", headers["x-webhook-signature"], headers["x-webhook-timestamp"]
    )

    parsed = adapter.parse_webhook_event(json.loads(payload_bytes))
    assert parsed.domain == "order"
    assert parsed.status == "paid"
    assert parsed.provider_payment_id == "cd_ord_123"
    assert parsed.cf_payment_id == "99887766"
    assert parsed.amount_paise == 14900
    assert parsed.currency == "INR"

    parsed_sub_act = adapter.parse_webhook_event(
        {
            "type": "SUBSCRIPTION_ACTIVATED",
            "event_time": "2026-06-15T12:25:00+05:30",
            "data": {
                "subscription_details": {
                    "subscription_id": "cd_sub_999",
                    "cf_subscription_id": "cf_sub_999",
                },
                "plan_details": {"plan_id": "cleandata_pro_monthly", "plan_amount": 799.0, "plan_currency": "INR"},
            },
        }
    )
    assert parsed_sub_act.domain == "subscription"
    assert parsed_sub_act.subscription_id == "cd_sub_999"
    assert parsed_sub_act.status == "activated"

    parsed_ping = adapter.parse_webhook_event({"type": "WEBHOOK_TEST", "data": {}})
    assert parsed_ping.domain == "unknown"


def test_webhook_api_prefix_and_test_ping(tmp_path):
    client = _make_client(tmp_path)
    ping_body = json.dumps({"type": "WEBHOOK_TEST", "event_id": "evt_ping_1", "data": {}}).encode("utf-8")
    resp = client.post(
        "/api/v1/webhooks/payments",
        content=ping_body,
        headers=_sign_cashfree_webhook(ping_body),
    )
    assert resp.status_code == 200
    assert resp.json()["success"] is True
    assert resp.json()["result"]["status"] == "ignored"


def test_all_credit_packs_and_plans_checkout_validation(tmp_path):
    client = _make_client(tmp_path)
    headers = {"Authorization": f"Bearer {_make_jwt('user-catalog-1')}"}

    for pack_name, spec in PACK_CATALOG.items():
        resp = client.post(
            "/v1/billing/checkout",
            json={"kind": "credit_pack", "item_name": pack_name},
            headers=headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["amount_paise"] == spec.price_paise
        assert body["currency"] == "INR"
        assert body["payment_session_id"] is not None
        assert body["subscription_session_id"] is None

    # Free plan cannot be purchased via checkout
    free_resp = client.post(
        "/v1/billing/checkout",
        json={"kind": "subscription", "item_name": "Free"},
        headers=headers,
    )
    assert free_resp.status_code == 422

    for plan_name in ("Starter", "Pro", "Business"):
        plan = PLAN_CATALOG[plan_name]
        resp = client.post(
            "/v1/billing/checkout",
            json={"kind": "subscription", "item_name": plan_name},
            headers=headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["amount_paise"] == plan.monthly_price_paise
        assert body["subscription_session_id"] is not None
        assert body["subscription_id"] is not None
        assert body["payment_session_id"] is None


def test_credit_pack_webhook_signature_idempotency_mismatch_and_refund(tmp_path):
    client = _make_client(tmp_path)
    user_id = "user-billing-pack-1"
    headers = {"Authorization": f"Bearer {_make_jwt(user_id)}"}

    # Checkout 50 Credits (Rs 149 = 14900 paise)
    pack_checkout = client.post(
        "/v1/billing/checkout",
        json={"kind": "credit_pack", "item_name": "50 Credits"},
        headers=headers,
    )
    assert pack_checkout.status_code == 200
    pack_order_id = pack_checkout.json()["order_id"]

    # 1. Invalid or missing timestamp webhook signature -> 401
    ok_payload = json.dumps(
        {
            "type": "PAYMENT_SUCCESS_WEBHOOK",
            "event_id": "evt_cf_pack_1",
            "data": {
                "order": {"order_id": pack_order_id, "order_amount": 149.0, "order_currency": "INR"},
                "payment": {"cf_payment_id": "cf_pay_50_1", "payment_status": "SUCCESS", "payment_amount": 149.0, "payment_currency": "INR"},
            },
        }
    ).encode("utf-8")
    bad_sig = client.post(
        "/v1/webhooks/payments",
        content=ok_payload,
        headers={"x-webhook-signature": "invalid", "x-webhook-timestamp": "1718450000000"},
    )
    assert bad_sig.status_code == 401
    assert bad_sig.json()["error"]["code"] == "INVALID_WEBHOOK_SIGNATURE"

    missing_ts = client.post(
        "/v1/webhooks/payments",
        content=ok_payload,
        headers={"x-webhook-signature": _sign_cashfree_webhook(ok_payload)["x-webhook-signature"]},
    )
    assert missing_ts.status_code == 401

    # 2. Tampered amount payload (wrong rupees) -> does NOT grant credits
    tampered_payload = json.dumps(
        {
            "type": "PAYMENT_SUCCESS_WEBHOOK",
            "event_id": "evt_cf_pack_tampered",
            "data": {
                "order": {"order_id": pack_order_id, "order_amount": 1.0, "order_currency": "INR"},
                "payment": {"cf_payment_id": "cf_pay_tamper", "payment_status": "SUCCESS", "payment_amount": 1.0, "payment_currency": "INR"},
            },
        }
    ).encode("utf-8")
    tamper_resp = client.post(
        "/v1/webhooks/payments",
        content=tampered_payload,
        headers=_sign_cashfree_webhook(tampered_payload),
    )
    assert tamper_resp.status_code == 200
    assert tamper_resp.json()["result"]["status"] == "amount_mismatch"
    assert client.get("/v1/billing/summary", headers=headers).json()["wallet"]["purchased_balance"] == 0

    # 3. Valid webhook grants 50 purchased credits
    good_resp = client.post(
        "/v1/webhooks/payments",
        content=ok_payload,
        headers=_sign_cashfree_webhook(ok_payload),
    )
    assert good_resp.status_code == 200
    assert good_resp.json()["result"]["status"] == "processed"
    assert client.get("/v1/billing/summary", headers=headers).json()["wallet"]["purchased_balance"] == 50

    # 4. Duplicate webhook event is idempotent (no double-crediting)
    dup_resp = client.post(
        "/v1/webhooks/payments",
        content=ok_payload,
        headers=_sign_cashfree_webhook(ok_payload),
    )
    assert dup_resp.status_code == 200
    assert dup_resp.json()["result"]["status"] == "already_processed"
    assert client.get("/v1/billing/summary", headers=headers).json()["wallet"]["purchased_balance"] == 50

    # 5. Refund webhook marks payment refunded and revokes unspent purchased credits
    refund_payload = json.dumps(
        {
            "type": "REFUND_STATUS_WEBHOOK",
            "event_id": "evt_cf_pack_refund_1",
            "data": {
                "refund": {
                    "cf_refund_id": 7711,
                    "cf_payment_id": "cf_pay_50_1",
                    "order_id": pack_order_id,
                    "refund_amount": 149.0,
                    "refund_currency": "INR",
                    "refund_status": "SUCCESS",
                }
            },
        }
    ).encode("utf-8")
    refund_resp = client.post(
        "/v1/webhooks/payments",
        content=refund_payload,
        headers=_sign_cashfree_webhook(refund_payload),
    )
    assert refund_resp.status_code == 200
    summary = client.get("/v1/billing/summary", headers=headers).json()
    assert summary["wallet"]["purchased_balance"] == 0
    assert summary["payments"][0]["status"] == "refunded"


def test_subscription_lifecycle_renewal_upgrade_cancel_and_split_spend(tmp_path):
    client = _make_client(tmp_path)
    user_id = "user-sub-lifecycle-1"
    headers = {"Authorization": f"Bearer {_make_jwt(user_id)}"}

    # 1. Buy 10 Credits pack and verify via server verify endpoint (mocking Cashfree PAID response)
    pack_co = client.post(
        "/v1/billing/checkout",
        json={"kind": "credit_pack", "item_name": "10 Credits"},
        headers=headers,
    ).json()
    pack_order_id = pack_co["order_id"]

    client.app.state.payment_adapter.orders[pack_order_id] = OrderVerificationResult(
        order_id=pack_order_id,
        order_status="PAID",
        amount_paise=4900,
        currency="INR",
        cf_payment_id="cf_ord_pay_10",
    )
    verify_pack = client.post(
        "/v1/billing/verify",
        json={"kind": "credit_pack", "order_id": pack_order_id},
        headers=headers,
    )
    assert verify_pack.status_code == 200
    assert verify_pack.json()["status"] == "paid"
    assert verify_pack.json()["wallet"]["purchased_balance"] == 10

    # Cross-user verification check must fail (404)
    other_headers = {"Authorization": f"Bearer {_make_jwt('attacker-user')}"}
    cross = client.post(
        "/v1/billing/verify",
        json={"kind": "credit_pack", "order_id": pack_order_id},
        headers=other_headers,
    )
    assert cross.status_code == 404

    # 2. Subscribe to Starter (100 monthly credits, Rs 299)
    starter_co = client.post(
        "/v1/billing/checkout",
        json={"kind": "subscription", "item_name": "Starter"},
        headers=headers,
    ).json()
    starter_sub_id = starter_co["subscription_id"]

    # Activate Starter mandate via SUBSCRIPTION_STATUS_CHANGED
    act_body = json.dumps(
        {
            "type": "SUBSCRIPTION_STATUS_CHANGED",
            "event_id": "evt_sub_act_1",
            "data": {
                "subscription_details": {
                    "cf_subscription_id": "cf_sub_101",
                    "subscription_id": starter_sub_id,
                    "subscription_status": "ACTIVE",
                },
                "plan_details": {"plan_id": "cleandata_starter_monthly", "plan_amount": 299.0, "plan_currency": "INR"},
            },
        }
    ).encode("utf-8")
    r_act = client.post("/v1/webhooks/payments", content=act_body, headers=_sign_cashfree_webhook(act_body))
    assert r_act.status_code == 200
    assert r_act.json()["result"]["credited"] is True

    # Co-firing SUBSCRIPTION_PAYMENT_SUCCESS within Cycle 1 does NOT double-credit
    pay1_body = json.dumps(
        {
            "type": "SUBSCRIPTION_PAYMENT_SUCCESS",
            "event_id": "evt_sub_pay_cycle1",
            "data": {
                "subscription_details": {"subscription_id": starter_sub_id, "subscription_status": "ACTIVE"},
                "payment_details": {
                    "cf_payment_id": "cf_sub_pay_1",
                    "payment_status": "SUCCESS",
                    "payment_amount": 299.0,
                    "payment_currency": "INR",
                },
            },
        }
    ).encode("utf-8")
    r_pay1 = client.post("/v1/webhooks/payments", content=pay1_body, headers=_sign_cashfree_webhook(pay1_body))
    assert r_pay1.status_code == 200
    assert r_pay1.json()["result"]["credited"] is False

    summary = client.get("/v1/billing/summary", headers=headers).json()
    assert summary["subscription"]["plan_name"] == "Starter"
    assert summary["subscription"]["status"] == "active"
    assert summary["wallet"]["subscription_balance"] == 100
    assert summary["wallet"]["purchased_balance"] == 10
    assert summary["wallet"]["total_balance"] == 110

    # 3. Spend 3 credits -> deducts from subscription BEFORE purchased
    rows = ["name,email"] + [f"User {i},user{i}@example.com" for i in range(2500)]
    csv_bytes = "\n".join(rows).encode("utf-8")
    clean_resp = client.post(
        "/v1/clean",
        files={"file": ("big.csv", csv_bytes, "text/csv")},
        headers={**headers, "Idempotency-Key": "job-idem-cf-1"},
    )
    assert clean_resp.status_code == 200
    after_spend = client.get("/v1/billing/summary", headers=headers).json()
    assert after_spend["wallet"]["subscription_balance"] == 97
    assert after_spend["wallet"]["purchased_balance"] == 10

    # 4. Month 2 renewal webhook resets Starter subscription_balance back to 100 (preserving 10 purchased)
    store = client.app.state.credits
    store.subscriptions[starter_sub_id]["last_credited_at"] = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=30)
    renew_body = json.dumps(
        {
            "type": "SUBSCRIPTION_PAYMENT_SUCCESS",
            "event_id": "evt_sub_pay_cycle2",
            "data": {
                "subscription_details": {"subscription_id": starter_sub_id, "subscription_status": "ACTIVE"},
                "payment_details": {
                    "cf_payment_id": "cf_sub_pay_2",
                    "payment_status": "SUCCESS",
                    "payment_amount": 299.0,
                    "payment_currency": "INR",
                },
            },
        }
    ).encode("utf-8")
    r_renew = client.post("/v1/webhooks/payments", content=renew_body, headers=_sign_cashfree_webhook(renew_body))
    assert r_renew.status_code == 200
    assert r_renew.json()["result"]["credited"] is True
    assert client.get("/v1/billing/summary", headers=headers).json()["wallet"]["subscription_balance"] == 100

    # 5. Failed recurring payment moves subscription to past_due without resetting credits
    fail_body = json.dumps(
        {
            "type": "SUBSCRIPTION_PAYMENT_FAILED",
            "event_id": "evt_sub_fail_cycle3",
            "data": {
                "subscription_details": {"subscription_id": starter_sub_id, "subscription_status": "ON_HOLD"},
                "payment_details": {
                    "cf_payment_id": "cf_sub_pay_3_fail",
                    "payment_status": "FAILED",
                    "payment_amount": 299.0,
                    "payment_currency": "INR",
                },
            },
        }
    ).encode("utf-8")
    client.post("/v1/webhooks/payments", content=fail_body, headers=_sign_cashfree_webhook(fail_body))
    assert client.get("/v1/billing/summary", headers=headers).json()["subscription"]["status"] == "past_due"

    # 6. Upgrade to Pro (500 monthly credits, Rs 799) -> cancels old Starter subscription automatically
    pro_co = client.post(
        "/v1/billing/checkout",
        json={"kind": "subscription", "item_name": "Pro"},
        headers=headers,
    ).json()
    pro_sub_id = pro_co["subscription_id"]
    client.app.state.payment_adapter.subscriptions[pro_sub_id] = SubscriptionVerificationResult(
        subscription_id=pro_sub_id,
        subscription_status="ACTIVE",
        plan_id="cleandata_pro_monthly",
        amount_paise=79900,
        currency="INR",
    )
    verify_pro = client.post(
        "/v1/billing/verify",
        json={"kind": "subscription", "subscription_id": pro_sub_id},
        headers=headers,
    )
    assert verify_pro.status_code == 200
    assert verify_pro.json()["status"] == "active"
    assert verify_pro.json()["subscription"]["plan_name"] == "Pro"
    assert verify_pro.json()["wallet"]["subscription_balance"] == 500
    assert starter_sub_id in client.app.state.payment_adapter.canceled_subscriptions

    # 7. Cancel active Pro subscription cleanly
    cancel_resp = client.post("/v1/billing/subscription/cancel", headers=headers)
    assert cancel_resp.status_code == 200
    assert cancel_resp.json()["status"] == "canceled"
    assert pro_sub_id in client.app.state.payment_adapter.canceled_subscriptions

    # 8. Subscription expiration webhook zeros out remaining monthly credits
    exp_body = json.dumps(
        {
            "type": "SUBSCRIPTION_STATUS_CHANGED",
            "event_id": "evt_sub_exp_1",
            "data": {
                "subscription_details": {
                    "subscription_id": pro_sub_id,
                    "subscription_status": "EXPIRED",
                }
            },
        }
    ).encode("utf-8")
    client.post("/v1/webhooks/payments", content=exp_body, headers=_sign_cashfree_webhook(exp_body))
    final_summary = client.get("/v1/billing/summary", headers=headers).json()
    assert final_summary["subscription"]["status"] == "expired"
    assert final_summary["wallet"]["subscription_balance"] == 0
    assert final_summary["wallet"]["purchased_balance"] == 10


def test_failed_job_refunds_reserved_credits_and_rejects_insufficient(tmp_path):
    client = _make_client(tmp_path)
    user_id = "user-refund-2"
    headers = {"Authorization": f"Bearer {_make_jwt(user_id)}"}

    store = client.app.state.credits
    store.grant_subscription_credits(
        user_id,
        "Starter",
        2,
        dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=30),
    )
    store.grant_purchased_credits(user_id, 3, "pay-seed-1")

    big_rows = ["name,email"] + [f"U{i},u{i}@example.com" for i in range(6500)]
    too_expensive = client.post(
        "/v1/clean",
        files={"file": ("too_big.csv", "\n".join(big_rows).encode("utf-8"), "text/csv")},
        headers=headers,
    )
    assert too_expensive.status_code == 402
    assert too_expensive.json()["error"]["code"] == "INSUFFICIENT_CREDITS"

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


def test_free_plan_daily_server_limit_and_purchased_credit_expiry(tmp_path):
    client = _make_client(tmp_path)
    user_id = "user-free-3"
    headers = {"Authorization": f"Bearer {_make_jwt(user_id)}"}
    csv_bytes = (FIXTURES_DIR / "messy_customers.csv").read_bytes()

    for _ in range(3):
        resp = client.post(
            "/v1/clean",
            files={"file": ("messy.csv", csv_bytes, "text/csv")},
            headers=headers,
        )
        assert resp.status_code == 200

    fourth = client.post(
        "/v1/clean",
        files={"file": ("messy.csv", csv_bytes, "text/csv")},
        headers=headers,
    )
    assert fourth.status_code == 429
    assert fourth.json()["error"]["code"] == "DAILY_JOB_LIMIT_REACHED"

    # Verify both monthly subscription credits AND 365-day purchased credits expire cleanly
    store = client.app.state.credits
    store.grant_subscription_credits(
        "expired-user",
        "Pro",
        500,
        dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1),
    )
    store.grant_purchased_credits("expired-user", 150, "pay-pack-exp")
    assert store.get_summary("expired-user").wallet.purchased_balance == 150
    store.expire_credits(now=dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=366))
    expired_summary = store.get_summary("expired-user")
    assert expired_summary.wallet.subscription_balance == 0
    assert expired_summary.wallet.purchased_balance == 0
