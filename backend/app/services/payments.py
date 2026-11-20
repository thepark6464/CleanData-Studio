import base64
import datetime as dt
import hashlib
import hmac
import re
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import Settings
from app.utils.security import ApiServiceError, log_event


def _sanitize_phone(raw_phone: str | None) -> str:
    digits = re.sub(r"\D", "", raw_phone or "")
    if len(digits) >= 10:
        return digits[-10:]
    return "9999999999"


def _sanitize_customer_id(user_id: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_-]", "", user_id)
    return (cleaned or "cust_user")[:48]


def _rupees_to_paise(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(round(float(value) * 100))
    except (TypeError, ValueError):
        return None


def _plan_id_for_name(plan_name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", plan_name.strip().lower()).strip("_")
    return f"cleandata_{slug}_monthly"


@dataclass(frozen=True)
class CheckoutSessionResult:
    provider: str
    kind: str  # 'credit_pack' | 'subscription'
    order_id: str
    amount_paise: int
    currency: str
    cashfree_mode: str = "sandbox"
    payment_session_id: str | None = None
    subscription_id: str | None = None
    subscription_session_id: str | None = None
    cf_subscription_id: str | None = None
    provider_plan_id: str | None = None


@dataclass(frozen=True)
class OrderVerificationResult:
    order_id: str
    order_status: str  # 'PAID' | 'ACTIVE' | 'EXPIRED'
    amount_paise: int
    currency: str
    cf_payment_id: str | None = None


@dataclass(frozen=True)
class SubscriptionVerificationResult:
    subscription_id: str
    subscription_status: str
    cf_subscription_id: str | None = None
    plan_id: str | None = None
    amount_paise: int | None = None
    currency: str = "INR"
    next_schedule_date: str | None = None
    cf_payment_id: str | None = None


@dataclass(frozen=True)
class ParsedWebhookEvent:
    domain: str  # 'order' | 'subscription' | 'unknown'
    event_type: str
    event_id: str
    provider_payment_id: str
    status: str  # 'paid' | 'failed' | 'refunded' | 'activated' | 'renewal_paid' | 'payment_failed' | 'canceled' | 'expired' | 'pending'
    payload_meta: dict[str, Any]
    subscription_id: str | None = None
    cf_payment_id: str | None = None
    amount_paise: int | None = None
    currency: str = "INR"
    next_schedule_date: str | None = None


class PaymentProviderAdapter(ABC):
    provider_name: str

    @abstractmethod
    async def create_order(
        self,
        *,
        user_id: str,
        user_email: str | None,
        customer_phone: str | None,
        item_name: str,
        amount_paise: int,
        currency: str,
        receipt_id: str,
    ) -> CheckoutSessionResult: ...

    @abstractmethod
    async def create_subscription(
        self,
        *,
        user_id: str,
        user_email: str | None,
        customer_phone: str | None,
        plan_name: str,
        amount_paise: int,
        currency: str,
        receipt_id: str,
    ) -> CheckoutSessionResult: ...

    @abstractmethod
    async def fetch_order_status(self, order_id: str) -> OrderVerificationResult: ...

    @abstractmethod
    async def fetch_subscription_status(
        self, subscription_id: str
    ) -> SubscriptionVerificationResult: ...

    @abstractmethod
    async def cancel_subscription(self, subscription_id: str) -> dict[str, Any]: ...

    @abstractmethod
    def verify_webhook_signature(
        self, raw_body: bytes, signature_header: str, timestamp_header: str = ""
    ) -> bool: ...

    @abstractmethod
    def parse_webhook_event(self, payload: dict[str, Any]) -> ParsedWebhookEvent: ...


class CashfreePaymentAdapter(PaymentProviderAdapter):
    """
    Cashfree Payments adapter:
      - One-time credit packs via Cashfree Payment Gateway (/pg/orders)
      - Recurring monthly plans via Cashfree Subscriptions (/pg/plans + /pg/subscriptions)
      - Webhook HMAC-SHA256 Base64 signature verification using x-webhook-timestamp + raw_body
    """

    provider_name = "cashfree"

    def __init__(self, settings: Settings) -> None:
        self.app_id = settings.resolved_cashfree_app_id
        self.secret_key = settings.resolved_cashfree_secret_key
        self.webhook_secret = settings.resolved_cashfree_webhook_secret
        self.env = settings.resolved_cashfree_env
        self.base_url = settings.cashfree_base_url
        self.api_version = settings.resolved_cashfree_api_version
        self.frontend_origin = settings.resolved_frontend_origin

    def _ensure_configured(self) -> None:
        if not self.app_id or not self.secret_key:
            raise ApiServiceError(
                503,
                "PAYMENT_PROVIDER_NOT_CONFIGURED",
                "Cashfree credentials (CASHFREE_APP_ID / CASHFREE_SECRET_KEY) are not configured on the server.",
            )

    def _headers(self) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "x-api-version": self.api_version,
            "x-client-id": self.app_id,
            "x-client-secret": self.secret_key,
        }

    @staticmethod
    def _provider_error_code(resp: httpx.Response) -> str | None:
        """Read only Cashfree's machine-readable error code; never expose response bodies."""
        try:
            body = resp.json()
        except (ValueError, TypeError):
            return None
        if not isinstance(body, dict):
            return None
        code = body.get("code") or body.get("error_code") or body.get("type")
        return str(code).strip().lower() if code else None

    @staticmethod
    def _log_provider_error(operation: str, resp: httpx.Response, reference_id: str) -> None:
        """Log only non-sensitive Cashfree error metadata; never log request/response bodies or credentials."""
        provider_code = CashfreePaymentAdapter._provider_error_code(resp)
        log_event(
            "cashfree_api_error",
            reference_id,
            operation=operation,
            http_status=resp.status_code,
            provider_code=provider_code[:120] if provider_code else None,
        )

    async def create_order(
        self,
        *,
        user_id: str,
        user_email: str | None,
        customer_phone: str | None,
        item_name: str,
        amount_paise: int,
        currency: str,
        receipt_id: str,
    ) -> CheckoutSessionResult:
        self._ensure_configured()

        order_id = f"cd_ord_{receipt_id}"[:45]
        order_amount = round(amount_paise / 100.0, 2)
        customer_details: dict[str, str] = {
            "customer_id": _sanitize_customer_id(user_id),
            "customer_phone": _sanitize_phone(customer_phone),
        }
        if user_email:
            customer_details["customer_email"] = user_email

        payload = {
            "order_id": order_id,
            "order_amount": order_amount,
            "order_currency": currency,
            "customer_details": customer_details,
            "order_meta": {
                "return_url": f"{self.frontend_origin}/dashboard/billing?kind=credit_pack&order_id={{order_id}}",
            },
            "order_note": f"CleanData Studio Credit Pack: {item_name}",
            "order_tags": {
                "user_id": user_id,
                "kind": "credit_pack",
                "item_name": item_name,
            },
        }

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{self.base_url}/orders",
                headers=self._headers(),
                json=payload,
            )
            if resp.status_code >= 400:
                self._log_provider_error("create_payment_order", resp, order_id)
                raise ApiServiceError(
                    502,
                    "PAYMENT_GATEWAY_ERROR",
                    "Unable to initialize Cashfree Payment Gateway checkout order.",
                )
            data = resp.json()
            resolved_order_id = str(data.get("order_id") or order_id)
            payment_session_id = str(data.get("payment_session_id") or "")
            if not payment_session_id:
                raise ApiServiceError(
                    502,
                    "PAYMENT_GATEWAY_ERROR",
                    "Cashfree did not return a payment_session_id.",
                )
            resolved_paise = _rupees_to_paise(data.get("order_amount")) or amount_paise
            return CheckoutSessionResult(
                provider=self.provider_name,
                kind="credit_pack",
                order_id=resolved_order_id,
                amount_paise=resolved_paise,
                currency=str(data.get("order_currency") or currency),
                cashfree_mode=self.env,
                payment_session_id=payment_session_id,
            )

    async def _ensure_subscription_plan(
        self,
        client: httpx.AsyncClient,
        *,
        plan_name: str,
        amount_paise: int,
        currency: str,
    ) -> str:
        plan_id = _plan_id_for_name(plan_name)
        existing = await client.get(
            f"{self.base_url}/plans/{plan_id}",
            headers=self._headers(),
        )
        if existing.status_code == 200:
            return plan_id
        # Cashfree Sandbox can report a missing plan as HTTP 400 with the
        # explicit machine code "plan_not_found" (rather than HTTP 404).
        # Only that exact provider code is treated as absence; auth, validation,
        # and server errors must still fail closed.
        provider_code = self._provider_error_code(existing)
        if existing.status_code != 404 and provider_code != "plan_not_found":
            self._log_provider_error("lookup_subscription_plan", existing, plan_id)
            raise ApiServiceError(
                502,
                "PAYMENT_GATEWAY_ERROR",
                "Cashfree rejected the subscription plan lookup. Check the Cashfree API credentials and environment.",
            )

        amount_rupees = round(amount_paise / 100.0, 2)
        create_resp = await client.post(
            f"{self.base_url}/plans",
            headers=self._headers(),
            json={
                "plan_id": plan_id,
                "plan_name": f"CleanData {plan_name} Monthly",
                "plan_type": "PERIODIC",
                "plan_recurring_amount": amount_rupees,
                "plan_max_amount": amount_rupees,
                "plan_currency": currency,
                "plan_intervals": 1,
                "plan_interval_type": "MONTH",
                "plan_note": f"CleanData Studio {plan_name} monthly subscription",
            },
        )
        if create_resp.status_code in (200, 201, 409):
            return plan_id

        self._log_provider_error("create_subscription_plan", create_resp, plan_id)
        raise ApiServiceError(
            502,
            "PAYMENT_GATEWAY_ERROR",
            f"Unable to provision Cashfree Subscription plan '{plan_id}'.",
        )

    async def create_subscription(
        self,
        *,
        user_id: str,
        user_email: str | None,
        customer_phone: str | None,
        plan_name: str,
        amount_paise: int,
        currency: str,
        receipt_id: str,
    ) -> CheckoutSessionResult:
        self._ensure_configured()
        subscription_id = f"cd_sub_{receipt_id}"[:45]
        amount_rupees = round(amount_paise / 100.0, 2)

        async with httpx.AsyncClient(timeout=20.0) as client:
            plan_id = await self._ensure_subscription_plan(
                client,
                plan_name=plan_name,
                amount_paise=amount_paise,
                currency=currency,
            )

            customer_details: dict[str, str] = {
                "customer_name": (user_email.split("@")[0] if user_email else "CleanData User")[:60],
                "customer_phone": _sanitize_phone(customer_phone),
            }
            if user_email:
                customer_details["customer_email"] = user_email

            expiry_iso = (
                dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=3650)
            ).strftime("%Y-%m-%dT%H:%M:%SZ")

            payload = {
                "subscription_id": subscription_id,
                "customer_details": customer_details,
                "plan_details": {
                    "plan_id": plan_id,
                },
                "authorization_details": {
                    "authorization_amount": amount_rupees,
                    "authorization_amount_refund": False,
                    "payment_methods": ["upi", "card", "enach"],
                },
                "subscription_meta": {
                    "return_url": f"{self.frontend_origin}/dashboard/billing?kind=subscription&subscription_id={{subscription_id}}",
                },
                "subscription_expiry_time": expiry_iso,
                "subscription_note": f"CleanData {plan_name} monthly subscription",
                "subscription_tags": {
                    "user_id": user_id,
                    "plan_name": plan_name,
                },
            }

            resp = await client.post(
                f"{self.base_url}/subscriptions",
                headers=self._headers(),
                json=payload,
            )
            if resp.status_code >= 400:
                self._log_provider_error("create_subscription", resp, subscription_id)
                raise ApiServiceError(
                    502,
                    "PAYMENT_GATEWAY_ERROR",
                    "Unable to initialize Cashfree Subscription checkout session.",
                )
            data = resp.json()
            resolved_sub_id = str(data.get("subscription_id") or subscription_id)
            subs_session_id = str(
                data.get("subscription_session_id") or data.get("subs_session_id") or ""
            )
            if not subs_session_id:
                raise ApiServiceError(
                    502,
                    "PAYMENT_GATEWAY_ERROR",
                    "Cashfree did not return a subscription_session_id.",
                )

            return CheckoutSessionResult(
                provider=self.provider_name,
                kind="subscription",
                order_id=resolved_sub_id,
                subscription_id=resolved_sub_id,
                subscription_session_id=subs_session_id,
                cf_subscription_id=(
                    str(data["cf_subscription_id"]) if data.get("cf_subscription_id") else None
                ),
                provider_plan_id=plan_id,
                amount_paise=amount_paise,
                currency=currency,
                cashfree_mode=self.env,
            )

    async def fetch_order_status(self, order_id: str) -> OrderVerificationResult:
        self._ensure_configured()
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{self.base_url}/orders/{order_id}",
                headers=self._headers(),
            )
            if resp.status_code == 404:
                raise ApiServiceError(404, "ORDER_NOT_FOUND", "Cashfree order not found.")
            if resp.status_code >= 400:
                raise ApiServiceError(
                    502,
                    "PAYMENT_GATEWAY_ERROR",
                    "Unable to verify Cashfree order status.",
                )
            order_data = resp.json()

            cf_payment_id: str | None = None
            payments_resp = await client.get(
                f"{self.base_url}/orders/{order_id}/payments",
                headers=self._headers(),
            )
            if payments_resp.status_code == 200:
                payments_list = payments_resp.json()
                if isinstance(payments_list, list):
                    for item in payments_list:
                        if isinstance(item, dict) and str(item.get("payment_status", "")).upper() == "SUCCESS":
                            cf_payment_id = str(item.get("cf_payment_id") or "") or None
                            break
                    if not cf_payment_id and payments_list and isinstance(payments_list[0], dict):
                        cf_payment_id = str(payments_list[0].get("cf_payment_id") or "") or None

            return OrderVerificationResult(
                order_id=str(order_data.get("order_id") or order_id),
                order_status=str(order_data.get("order_status") or "ACTIVE").upper(),
                amount_paise=_rupees_to_paise(order_data.get("order_amount")) or 0,
                currency=str(order_data.get("order_currency") or "INR").upper(),
                cf_payment_id=cf_payment_id,
            )

    async def fetch_subscription_status(
        self, subscription_id: str
    ) -> SubscriptionVerificationResult:
        self._ensure_configured()
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{self.base_url}/subscriptions/{subscription_id}",
                headers=self._headers(),
            )
            if resp.status_code == 404:
                raise ApiServiceError(404, "SUBSCRIPTION_NOT_FOUND", "Cashfree subscription not found.")
            if resp.status_code >= 400:
                raise ApiServiceError(
                    502,
                    "PAYMENT_GATEWAY_ERROR",
                    "Unable to verify Cashfree subscription status.",
                )
            data = resp.json()
            plan_details = data.get("plan_details") if isinstance(data.get("plan_details"), dict) else {}
            auth_details = (
                data.get("authorization_details")
                if isinstance(data.get("authorization_details"), dict)
                else {}
            )
            amount_paise = _rupees_to_paise(
                plan_details.get("plan_recurring_amount")
                or plan_details.get("plan_amount")
                or auth_details.get("authorization_amount")
            )
            return SubscriptionVerificationResult(
                subscription_id=str(data.get("subscription_id") or subscription_id),
                subscription_status=str(data.get("subscription_status") or "INITIALIZED").upper(),
                cf_subscription_id=(
                    str(data["cf_subscription_id"]) if data.get("cf_subscription_id") else None
                ),
                plan_id=str(plan_details.get("plan_id") or "") or None,
                amount_paise=amount_paise,
                currency=str(plan_details.get("plan_currency") or "INR").upper(),
                next_schedule_date=str(data.get("next_schedule_date") or "") or None,
            )

    async def cancel_subscription(self, subscription_id: str) -> dict[str, Any]:
        self._ensure_configured()
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{self.base_url}/subscriptions/{subscription_id}/manage",
                headers=self._headers(),
                json={
                    "subscription_id": subscription_id,
                    "action": "CANCEL",
                },
            )
            if resp.status_code >= 400:
                raise ApiServiceError(
                    502,
                    "PAYMENT_GATEWAY_ERROR",
                    "Unable to cancel subscription on Cashfree.",
                )
            return resp.json() if resp.content else {"subscription_status": "CANCELLED"}

    def verify_webhook_signature(
        self, raw_body: bytes, signature_header: str, timestamp_header: str = ""
    ) -> bool:
        """
        Verify official Cashfree webhook signature:
          signed_payload = x-webhook-timestamp + raw_body
          expected = base64(hmac_sha256(secret, signed_payload))
        """
        if not self.webhook_secret or not signature_header or not timestamp_header:
            return False
        signed_payload = timestamp_header.strip().encode("utf-8") + raw_body
        digest = hmac.new(
            self.webhook_secret.encode("utf-8"),
            signed_payload,
            hashlib.sha256,
        ).digest()
        expected_b64 = base64.b64encode(digest).decode("utf-8")
        return hmac.compare_digest(expected_b64, signature_header.strip())

    def parse_webhook_event(self, payload: dict[str, Any]) -> ParsedWebhookEvent:
        event_type = str(payload.get("type") or payload.get("event") or "").upper()
        event_time = str(payload.get("event_time") or "")
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}

        # 1. Cashfree Subscriptions webhook events
        if (
            event_type.startswith("SUBSCRIPTION_")
            or "subscription_details" in data
            or "subscription" in data
        ):
            sub_details = (
                data.get("subscription_details")
                if isinstance(data.get("subscription_details"), dict)
                else (
                    data.get("subscription")
                    if isinstance(data.get("subscription"), dict)
                    else {}
                )
            )
            pay_details = (
                data.get("payment_details")
                if isinstance(data.get("payment_details"), dict)
                else (
                    data.get("payment")
                    if isinstance(data.get("payment"), dict)
                    else {}
                )
            )
            plan_details = (
                data.get("plan_details")
                if isinstance(data.get("plan_details"), dict)
                else (
                    data.get("plan")
                    if isinstance(data.get("plan"), dict)
                    else {}
                )
            )

            sub_id = str(
                sub_details.get("subscription_id")
                or data.get("subscription_id")
                or ""
            )
            cf_sub_id = str(sub_details.get("cf_subscription_id") or "")
            cf_payment_id = str(
                pay_details.get("cf_payment_id") or pay_details.get("payment_id") or ""
            )
            sub_status_raw = str(sub_details.get("subscription_status") or "").upper()
            pay_status_raw = str(pay_details.get("payment_status") or "").upper()
            currency = str(
                pay_details.get("payment_currency")
                or plan_details.get("plan_currency")
                or "INR"
            ).upper()
            amount_paise = _rupees_to_paise(
                pay_details.get("payment_amount")
                or plan_details.get("plan_amount")
                or plan_details.get("plan_recurring_amount")
            )
            next_schedule_date = (
                str(sub_details.get("next_schedule_date") or "") or None
            )

            if event_type == "SUBSCRIPTION_PAYMENT_SUCCESS" or (
                event_type.startswith("SUBSCRIPTION_PAYMENT") and pay_status_raw == "SUCCESS"
            ):
                normalized_kind = "renewal_paid"
            elif event_type == "SUBSCRIPTION_PAYMENT_FAILED" or (
                event_type.startswith("SUBSCRIPTION_PAYMENT") and pay_status_raw in {"FAILED", "USER_DROPPED"}
            ):
                normalized_kind = "payment_failed"
            elif event_type in {"SUBSCRIPTION_CANCELLED", "SUBSCRIPTION_PAUSED"} or sub_status_raw in {
                "CANCELLED",
                "CUSTOMER_CANCELLED",
                "PAUSED",
            }:
                normalized_kind = "canceled"
            elif event_type == "SUBSCRIPTION_EXPIRED" or sub_status_raw in {"EXPIRED", "COMPLETED"}:
                normalized_kind = "expired"
            elif sub_status_raw in {"ON_HOLD", "BANK_APPROVAL_FAILED"}:
                normalized_kind = "payment_failed"
            elif event_type == "SUBSCRIPTION_ACTIVATED" or sub_status_raw == "ACTIVE":
                normalized_kind = "activated"
            else:
                normalized_kind = "pending"

            explicit_id = payload.get("event_id") or payload.get("id")
            event_id = str(
                explicit_id
                or f"{event_type}:{sub_id}:{cf_payment_id or sub_status_raw}:{event_time}"
            )

            return ParsedWebhookEvent(
                domain="subscription",
                event_type=event_type or "SUBSCRIPTION_EVENT",
                event_id=event_id,
                provider_payment_id=cf_payment_id or sub_id,
                subscription_id=sub_id,
                cf_payment_id=cf_payment_id or None,
                status=normalized_kind,
                amount_paise=amount_paise,
                currency=currency,
                next_schedule_date=next_schedule_date,
                payload_meta={
                    "event": event_type,
                    "subscription_id": sub_id,
                    "cf_subscription_id": cf_sub_id,
                    "provider_plan_id": plan_details.get("plan_id"),
                    "subscription_status": sub_status_raw,
                    "cf_payment_id": cf_payment_id or None,
                    "amount_paise": amount_paise,
                    "currency": currency,
                },
            )

        # 2. Cashfree Payment Gateway one-time order & refund webhooks
        order_obj = data.get("order") if isinstance(data.get("order"), dict) else {}
        payment_obj = data.get("payment") if isinstance(data.get("payment"), dict) else {}
        refund_obj = data.get("refund") if isinstance(data.get("refund"), dict) else {}

        order_id = str(
            order_obj.get("order_id")
            or refund_obj.get("order_id")
            or payload.get("order_id")
            or ""
        )
        cf_payment_id = str(
            payment_obj.get("cf_payment_id")
            or refund_obj.get("cf_payment_id")
            or ""
        )
        currency = str(
            payment_obj.get("payment_currency")
            or order_obj.get("order_currency")
            or refund_obj.get("refund_currency")
            or "INR"
        ).upper()
        amount_paise = _rupees_to_paise(
            order_obj.get("order_amount")
            or payment_obj.get("payment_amount")
            or refund_obj.get("refund_amount")
        )

        is_known_order_event = (
            event_type
            in {
                "PAYMENT_SUCCESS_WEBHOOK",
                "PAYMENT_FAILED_WEBHOOK",
                "PAYMENT_USER_DROPPED_WEBHOOK",
                "PAYMENT_CHARGES_WEBHOOK",
                "REFUND_STATUS_WEBHOOK",
            }
            or bool(order_obj)
            or bool(payment_obj)
            or bool(refund_obj)
        )

        if not is_known_order_event:
            explicit_id = payload.get("event_id") or payload.get("id")
            return ParsedWebhookEvent(
                domain="unknown",
                event_type=event_type or "UNKNOWN_EVENT",
                event_id=str(explicit_id or f"{event_type or 'UNKNOWN'}:{event_time}"),
                provider_payment_id="",
                status="pending",
                payload_meta={"event": event_type},
            )

        if event_type == "REFUND_STATUS_WEBHOOK" or (
            refund_obj and str(refund_obj.get("refund_status", "")).upper() == "SUCCESS"
        ):
            status = "refunded"
        elif event_type == "PAYMENT_SUCCESS_WEBHOOK" or (
            str(payment_obj.get("payment_status", "")).upper() == "SUCCESS"
        ):
            status = "paid"
        elif event_type in {
            "PAYMENT_FAILED_WEBHOOK",
            "PAYMENT_USER_DROPPED_WEBHOOK",
            "PAYMENT_CHARGES_WEBHOOK",
        } or str(payment_obj.get("payment_status", "")).upper() in {"FAILED", "USER_DROPPED", "CANCELLED"}:
            status = "failed"
        else:
            status = "pending"

        explicit_id = payload.get("event_id") or payload.get("id")
        event_id = str(
            explicit_id
            or f"{event_type}:{order_id}:{cf_payment_id or refund_obj.get('cf_refund_id') or event_time}"
        )

        return ParsedWebhookEvent(
            domain="order",
            event_type=event_type or "PAYMENT_EVENT",
            event_id=event_id,
            provider_payment_id=order_id or cf_payment_id,
            cf_payment_id=cf_payment_id or None,
            status=status,
            amount_paise=amount_paise,
            currency=currency,
            payload_meta={
                "event": event_type,
                "order_id": order_id,
                "cf_payment_id": cf_payment_id or None,
                "cf_refund_id": refund_obj.get("cf_refund_id"),
                "amount_paise": amount_paise,
                "currency": currency,
            },
        )


class TestHmacPaymentAdapter(PaymentProviderAdapter):
    """Deterministic HMAC-SHA256 adapter for offline unit/integration testing without network calls."""

    provider_name = "test_hmac"

    def __init__(self, settings: Settings) -> None:
        self.webhook_secret = settings.resolved_cashfree_webhook_secret
        self.orders: dict[str, OrderVerificationResult] = {}
        self.subscriptions: dict[str, SubscriptionVerificationResult] = {}
        self.canceled_subscriptions: list[str] = []

    async def create_order(
        self,
        *,
        user_id: str,
        user_email: str | None,
        customer_phone: str | None,
        item_name: str,
        amount_paise: int,
        currency: str,
        receipt_id: str,
    ) -> CheckoutSessionResult:
        order_id = f"cd_ord_{uuid.uuid4().hex[:14]}"
        self.orders[order_id] = OrderVerificationResult(
            order_id=order_id,
            order_status="ACTIVE",
            amount_paise=amount_paise,
            currency=currency,
        )
        return CheckoutSessionResult(
            provider=self.provider_name,
            kind="credit_pack",
            order_id=order_id,
            amount_paise=amount_paise,
            currency=currency,
            cashfree_mode="sandbox",
            payment_session_id=f"session_pg_{uuid.uuid4().hex[:16]}",
        )

    async def create_subscription(
        self,
        *,
        user_id: str,
        user_email: str | None,
        customer_phone: str | None,
        plan_name: str,
        amount_paise: int,
        currency: str,
        receipt_id: str,
    ) -> CheckoutSessionResult:
        sub_id = f"cd_sub_{uuid.uuid4().hex[:14]}"
        self.subscriptions[sub_id] = SubscriptionVerificationResult(
            subscription_id=sub_id,
            subscription_status="INITIALIZED",
            plan_id=_plan_id_for_name(plan_name),
            amount_paise=amount_paise,
            currency=currency,
        )
        return CheckoutSessionResult(
            provider=self.provider_name,
            kind="subscription",
            order_id=sub_id,
            subscription_id=sub_id,
            subscription_session_id=f"session_sub_{uuid.uuid4().hex[:16]}",
            provider_plan_id=_plan_id_for_name(plan_name),
            amount_paise=amount_paise,
            currency=currency,
            cashfree_mode="sandbox",
        )

    async def fetch_order_status(self, order_id: str) -> OrderVerificationResult:
        if order_id in self.orders:
            return self.orders[order_id]
        raise ApiServiceError(404, "ORDER_NOT_FOUND", "Order not found.")

    async def fetch_subscription_status(
        self, subscription_id: str
    ) -> SubscriptionVerificationResult:
        if subscription_id in self.subscriptions:
            return self.subscriptions[subscription_id]
        raise ApiServiceError(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found.")

    async def cancel_subscription(self, subscription_id: str) -> dict[str, Any]:
        self.canceled_subscriptions.append(subscription_id)
        if subscription_id in self.subscriptions:
            cur = self.subscriptions[subscription_id]
            self.subscriptions[subscription_id] = SubscriptionVerificationResult(
                subscription_id=cur.subscription_id,
                subscription_status="CANCELLED",
                cf_subscription_id=cur.cf_subscription_id,
                plan_id=cur.plan_id,
                amount_paise=cur.amount_paise,
                currency=cur.currency,
            )
        return {"subscription_id": subscription_id, "subscription_status": "CANCELLED"}

    def verify_webhook_signature(
        self, raw_body: bytes, signature_header: str, timestamp_header: str = ""
    ) -> bool:
        if not self.webhook_secret or not signature_header or not timestamp_header:
            return False
        signed_payload = timestamp_header.strip().encode("utf-8") + raw_body
        digest = hmac.new(
            self.webhook_secret.encode("utf-8"),
            signed_payload,
            hashlib.sha256,
        ).digest()
        expected_b64 = base64.b64encode(digest).decode("utf-8")
        return hmac.compare_digest(expected_b64, signature_header.strip())

    def parse_webhook_event(self, payload: dict[str, Any]) -> ParsedWebhookEvent:
        # Delegate to CashfreePaymentAdapter parsing rules so unit tests validate Cashfree payloads directly
        return CashfreePaymentAdapter.parse_webhook_event(self, payload)  # type: ignore[arg-type]


def get_payment_adapter(settings: Settings) -> PaymentProviderAdapter:
    if settings.payment_provider == "test_hmac" and settings.environment in {"test", "development"}:
        return TestHmacPaymentAdapter(settings)
    return CashfreePaymentAdapter(settings)
