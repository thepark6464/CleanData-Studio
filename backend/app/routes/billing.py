import json
import uuid
from fastapi import APIRouter, Request

from app.auth.jwt_auth import require_jwt_user
from app.database import SupabaseServiceClient
from app.models import (
    BillingSummaryResponse,
    CheckoutCreateRequest,
    CheckoutCreateResponse,
)
from app.services.credits import PACK_CATALOG, PLAN_CATALOG
from app.services.payments import get_payment_adapter
from app.utils.security import ApiServiceError, log_event

router = APIRouter(prefix="/v1", tags=["Billing & Credits"])


@router.get("/billing/summary", response_model=BillingSummaryResponse)
async def get_billing_summary(request: Request) -> BillingSummaryResponse:
    user = require_jwt_user(request)
    settings = request.app.state.settings
    db = SupabaseServiceClient(settings)
    if db.configured:
        return await db.get_billing_summary(user.user_id)
    return request.app.state.credits.get_summary(user.user_id)


@router.post("/billing/checkout", response_model=CheckoutCreateResponse)
async def create_checkout(
    request: Request, payload: CheckoutCreateRequest
) -> CheckoutCreateResponse:
    user = require_jwt_user(request)
    settings = request.app.state.settings
    request_id = request.state.request_id
    adapter = get_payment_adapter(settings)
    db = SupabaseServiceClient(settings)

    package_id: str | None = None
    plan_id: str | None = None
    currency = "INR"

    if payload.kind == "credit_pack":
        pack = PACK_CATALOG.get(payload.item_name)
        if not pack:
            raise ApiServiceError(
                422, "UNKNOWN_CREDIT_PACKAGE", f"Unknown credit package '{payload.item_name}'."
            )
        amount_paise = pack.price_paise
        currency = pack.currency
        if db.configured:
            row = await db.get_catalog_package(payload.item_name)
            if not row:
                raise ApiServiceError(
                    422, "UNKNOWN_CREDIT_PACKAGE", f"Credit package '{payload.item_name}' not found."
                )
            package_id = str(row["id"])
            amount_paise = int(row["price"])
            currency = str(row["currency"])
    else:
        plan = PLAN_CATALOG.get(payload.item_name)
        if not plan or plan.monthly_price_paise <= 0:
            raise ApiServiceError(
                422, "INVALID_SUBSCRIPTION_PLAN", f"Subscription plan '{payload.item_name}' cannot be purchased."
            )
        amount_paise = plan.monthly_price_paise
        if db.configured:
            row = await db.get_catalog_plan(payload.item_name)
            if not row:
                raise ApiServiceError(
                    422, "INVALID_SUBSCRIPTION_PLAN", f"Plan '{payload.item_name}' not found."
                )
            plan_id = str(row["id"])
            amount_paise = int(row["monthly_price"])

    receipt_id = f"rcpt_{uuid.uuid4().hex[:16]}"
    order = await adapter.create_order(
        user_id=user.user_id,
        kind=payload.kind,
        item_name=payload.item_name,
        amount_paise=amount_paise,
        currency=currency,
        receipt_id=receipt_id,
    )

    if db.configured:
        payment_id = await db.create_pending_payment(
            user_id=user.user_id,
            amount_paise=order.amount_paise,
            currency=order.currency,
            provider=order.provider,
            provider_payment_id=order.order_id,
            kind=payload.kind,
            package_id=package_id,
            plan_id=plan_id,
        )
    else:
        payment_id = request.app.state.credits.create_pending_payment(
            user_id=user.user_id,
            amount_paise=order.amount_paise,
            currency=order.currency,
            provider=order.provider,
            provider_payment_id=order.order_id,
            kind=payload.kind,
            item_name=payload.item_name,
        )

    log_event(
        "checkout_order_created",
        request_id,
        user_id=user.user_id,
        kind=payload.kind,
        item_name=payload.item_name,
        amount_paise=order.amount_paise,
        provider=order.provider,
    )

    return CheckoutCreateResponse(
        payment_id=payment_id,
        provider=order.provider,
        order_id=order.order_id,
        amount_paise=order.amount_paise,
        currency=order.currency,
        kind=payload.kind,
        item_name=payload.item_name,
        key_id=order.key_id,
        message="Checkout order initialized. Complete payment via provider gateway; credits activate only after verified webhook.",
    )


@router.post("/webhooks/payments")
async def handle_payment_webhook(request: Request) -> dict:
    settings = request.app.state.settings
    request_id = request.state.request_id
    adapter = get_payment_adapter(settings)

    raw_body = await request.body()
    signature = (
        request.headers.get("X-Razorpay-Signature")
        or request.headers.get("X-Webhook-Signature")
        or ""
    )

    if not adapter.verify_webhook_signature(raw_body, signature):
        log_event("webhook_signature_rejected", request_id, provider=adapter.provider_name)
        raise ApiServiceError(
            401,
            "INVALID_WEBHOOK_SIGNATURE",
            "Webhook signature verification failed.",
        )

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except Exception as exc:
        raise ApiServiceError(400, "INVALID_WEBHOOK_PAYLOAD", "Malformed JSON webhook body.") from exc

    parsed = adapter.parse_webhook_event(payload)
    db = SupabaseServiceClient(settings)
    if db.configured:
        result = await db.rpc(
            "process_payment_event",
            {
                "p_provider": adapter.provider_name,
                "p_event_id": parsed.event_id,
                "p_provider_payment_id": parsed.provider_payment_id,
                "p_status": parsed.status,
                "p_payload_meta": parsed.payload_meta,
            },
        )
    else:
        result = request.app.state.credits.process_payment_event(
            provider=adapter.provider_name,
            event_id=parsed.event_id,
            provider_payment_id=parsed.provider_payment_id,
            status=parsed.status,
        )

    log_event(
        "payment_webhook_processed",
        request_id,
        provider=adapter.provider_name,
        event_id=parsed.event_id,
        status=parsed.status,
        outcome=result.get("status") if isinstance(result, dict) else "ok",
    )
    return {"success": True, "result": result}
