import hashlib
import hmac
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import Settings
from app.utils.security import ApiServiceError


@dataclass(frozen=True)
class CheckoutOrderResult:
    provider: str
    order_id: str
    amount_paise: int
    currency: str
    key_id: str | None = None


@dataclass(frozen=True)
class ParsedWebhookEvent:
    event_id: str
    provider_payment_id: str
    status: str  # 'paid' | 'failed' | 'refunded'
    payload_meta: dict[str, Any]


class PaymentProviderAdapter(ABC):
    provider_name: str

    @abstractmethod
    async def create_order(
        self,
        *,
        user_id: str,
        kind: str,
        item_name: str,
        amount_paise: int,
        currency: str,
        receipt_id: str,
    ) -> CheckoutOrderResult: ...

    @abstractmethod
    def verify_webhook_signature(self, raw_body: bytes, signature_header: str) -> bool: ...

    @abstractmethod
    def parse_webhook_event(self, payload: dict[str, Any]) -> ParsedWebhookEvent: ...


class RazorpayPaymentAdapter(PaymentProviderAdapter):
    """Razorpay India payment gateway adapter (INR paise + HMAC-SHA256 webhooks)."""

    provider_name = "razorpay"

    def __init__(self, settings: Settings) -> None:
        self.key_id = settings.payment_key_id
        self.key_secret = settings.payment_key_secret
        self.webhook_secret = settings.payment_webhook_secret

    async def create_order(
        self,
        *,
        user_id: str,
        kind: str,
        item_name: str,
        amount_paise: int,
        currency: str,
        receipt_id: str,
    ) -> CheckoutOrderResult:
        if not self.key_id or not self.key_secret:
            raise ApiServiceError(
                503,
                "PAYMENT_PROVIDER_NOT_CONFIGURED",
                "Razorpay API keys (PAYMENT_KEY_ID / PAYMENT_KEY_SECRET) are not configured on the server.",
            )

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                "https://api.razorpay.com/v1/orders",
                auth=(self.key_id, self.key_secret),
                json={
                    "amount": amount_paise,
                    "currency": currency,
                    "receipt": receipt_id[:40],
                    "notes": {
                        "user_id": user_id,
                        "kind": kind,
                        "item_name": item_name,
                    },
                },
            )
            if resp.status_code >= 400:
                raise ApiServiceError(
                    502,
                    "PAYMENT_GATEWAY_ERROR",
                    "Unable to initialize Razorpay checkout order.",
                )
            data = resp.json()
            return CheckoutOrderResult(
                provider=self.provider_name,
                order_id=str(data["id"]),
                amount_paise=int(data["amount"]),
                currency=str(data["currency"]),
                key_id=self.key_id,
            )

    def verify_webhook_signature(self, raw_body: bytes, signature_header: str) -> bool:
        if not self.webhook_secret or not signature_header:
            return False
        expected = hmac.new(
            self.webhook_secret.encode("utf-8"),
            raw_body,
            hashlib.sha256,
        ).hexdigest()
        return hmac.compare_digest(expected, signature_header.strip())

    def parse_webhook_event(self, payload: dict[str, Any]) -> ParsedWebhookEvent:
        event_name = str(payload.get("event", ""))
        event_id = str(payload.get("event_id") or payload.get("id") or "")
        entity = (
            payload.get("payload", {}).get("payment", {}).get("entity", {})
            if isinstance(payload.get("payload"), dict)
            else {}
        )
        order_id = str(entity.get("order_id") or payload.get("order_id") or "")
        payment_id = str(entity.get("id") or payload.get("payment_id") or "")

        if not event_id:
            event_id = f"{event_name}:{order_id or payment_id}"

        if event_name in {"payment.captured", "order.paid"}:
            status = "paid"
        elif event_name == "payment.failed":
            status = "failed"
        elif event_name.startswith("refund."):
            status = "refunded"
        else:
            status = "failed"

        return ParsedWebhookEvent(
            event_id=event_id,
            provider_payment_id=order_id or payment_id,
            status=status,
            payload_meta={
                "event": event_name,
                "amount": entity.get("amount"),
                "currency": entity.get("currency"),
            },
        )


class TestHmacPaymentAdapter(PaymentProviderAdapter):
    """Deterministic HMAC-SHA256 adapter for local/CI pytest checkout & webhook testing."""

    provider_name = "test_hmac"

    def __init__(self, settings: Settings) -> None:
        self.webhook_secret = settings.payment_webhook_secret

    async def create_order(
        self,
        *,
        user_id: str,
        kind: str,
        item_name: str,
        amount_paise: int,
        currency: str,
        receipt_id: str,
    ) -> CheckoutOrderResult:
        return CheckoutOrderResult(
            provider=self.provider_name,
            order_id=f"order_{uuid.uuid4().hex[:14]}",
            amount_paise=amount_paise,
            currency=currency,
            key_id="test_public_key",
        )

    def verify_webhook_signature(self, raw_body: bytes, signature_header: str) -> bool:
        if not self.webhook_secret or not signature_header:
            return False
        expected = hmac.new(
            self.webhook_secret.encode("utf-8"),
            raw_body,
            hashlib.sha256,
        ).hexdigest()
        return hmac.compare_digest(expected, signature_header.strip())

    def parse_webhook_event(self, payload: dict[str, Any]) -> ParsedWebhookEvent:
        return ParsedWebhookEvent(
            event_id=str(payload["event_id"]),
            provider_payment_id=str(payload["order_id"]),
            status=str(payload.get("status", "paid")),
            payload_meta={"event": payload.get("event", "payment.captured")},
        )


def get_payment_adapter(settings: Settings) -> PaymentProviderAdapter:
    if settings.payment_provider == "test_hmac" and settings.environment in {"test", "development"}:
        return TestHmacPaymentAdapter(settings)
    return RazorpayPaymentAdapter(settings)
