import json
import uuid
from urllib.parse import parse_qs, quote
from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse

from app.auth.jwt_auth import require_jwt_user
from app.database import SupabaseServiceClient
from app.models import (
    BillingSummaryResponse,
    CheckoutCreateRequest,
    CheckoutCreateResponse,
    CheckoutVerifyRequest,
    CheckoutVerifyResponse,
    SubscriptionCancelResponse,
)
from app.services.credits import PACK_CATALOG, PLAN_CATALOG
from app.services.payments import PaymentProviderAdapter, get_payment_adapter
from app.utils.security import ApiServiceError, log_event

router = APIRouter(prefix="/v1", tags=["Billing & Credits"])


def _resolve_adapter(request: Request) -> PaymentProviderAdapter:
    adapter = getattr(request.app.state, "payment_adapter", None)
    if adapter is not None:
        return adapter
    return get_payment_adapter(request.app.state.settings)


async def _cancel_superseded_cashfree_subscriptions(
    *,
    db: SupabaseServiceClient,
    request: Request,
    adapter: PaymentProviderAdapter,
    user_id: str,
    keep_subscription_id: str,
    request_id: str,
) -> None:
    if db.configured:
        others = await db.list_other_active_cashfree_subscriptions(user_id, keep_subscription_id)
    else:
        others = request.app.state.credits.list_other_active_subscriptions(
            user_id, keep_subscription_id
        )

    for old in others:
        old_id = old.get("provider_subscription_id")
        if not old_id or old.get("provider") not in {"cashfree", "test_hmac"}:
            continue
        try:
            await adapter.cancel_subscription(str(old_id))
        except Exception:
            log_event(
                "cashfree_old_subscription_cancel_warning",
                request_id,
                user_id=user_id,
                old_subscription_id=str(old_id),
            )


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
    adapter = _resolve_adapter(request)
    db = SupabaseServiceClient(settings)

    package_id: str | None = None
    plan_id: str | None = None
    currency = "INR"
    receipt_id = uuid.uuid4().hex[:16]

    if payload.kind == "credit_pack":
        pack = PACK_CATALOG.get(payload.item_name)
        if not pack:
            raise ApiServiceError(
                422,
                "UNKNOWN_CREDIT_PACKAGE",
                f"Unknown credit package '{payload.item_name}'.",
            )
        amount_paise = pack.price_paise
        currency = pack.currency
        if db.configured:
            row = await db.get_catalog_package(payload.item_name)
            if not row:
                raise ApiServiceError(
                    422,
                    "UNKNOWN_CREDIT_PACKAGE",
                    f"Credit package '{payload.item_name}' not found.",
                )
            package_id = str(row["id"])
            amount_paise = int(row["price"])
            currency = str(row["currency"])

        session = await adapter.create_order(
            user_id=user.user_id,
            user_email=user.email,
            customer_phone=payload.customer_phone,
            item_name=payload.item_name,
            amount_paise=amount_paise,
            currency=currency,
            receipt_id=receipt_id,
        )

        if db.configured:
            payment_id = await db.create_pending_payment(
                user_id=user.user_id,
                amount_paise=session.amount_paise,
                currency=session.currency,
                provider=session.provider,
                provider_payment_id=session.order_id,
                provider_order_id=session.order_id,
                kind="credit_pack",
                package_id=package_id,
                plan_id=None,
            )
        else:
            payment_id = request.app.state.credits.create_pending_payment(
                user_id=user.user_id,
                amount_paise=session.amount_paise,
                currency=session.currency,
                provider=session.provider,
                provider_payment_id=session.order_id,
                kind="credit_pack",
                item_name=payload.item_name,
            )

        log_event(
            "checkout_order_created",
            request_id,
            user_id=user.user_id,
            kind="credit_pack",
            item_name=payload.item_name,
            amount_paise=session.amount_paise,
            provider=session.provider,
        )

        return CheckoutCreateResponse(
            payment_id=payment_id,
            provider=session.provider,
            order_id=session.order_id,
            subscription_id=None,
            payment_session_id=session.payment_session_id,
            subscription_session_id=None,
            cashfree_mode="production" if session.cashfree_mode == "production" else "sandbox",
            amount_paise=session.amount_paise,
            currency=session.currency,
            kind="credit_pack",
            item_name=payload.item_name,
            message="Cashfree Payment Gateway order created. Complete payment via hosted checkout; credits activate only after verified server confirmation.",
        )

    # Recurring monthly subscription checkout (Free remains free without payment)
    plan = PLAN_CATALOG.get(payload.item_name)
    if not plan or plan.monthly_price_paise <= 0:
        raise ApiServiceError(
            422,
            "INVALID_SUBSCRIPTION_PLAN",
            f"Subscription plan '{payload.item_name}' cannot be purchased.",
        )
    amount_paise = plan.monthly_price_paise
    if db.configured:
        row = await db.get_catalog_plan(payload.item_name)
        if not row:
            raise ApiServiceError(
                422,
                "INVALID_SUBSCRIPTION_PLAN",
                f"Plan '{payload.item_name}' not found.",
            )
        plan_id = str(row["id"])
        amount_paise = int(row["monthly_price"])

    session = await adapter.create_subscription(
        user_id=user.user_id,
        user_email=user.email,
        customer_phone=payload.customer_phone,
        plan_name=payload.item_name,
        amount_paise=amount_paise,
        currency=currency,
        receipt_id=receipt_id,
    )
    sub_id = session.subscription_id or session.order_id

    if db.configured:
        payment_id = await db.create_pending_payment(
            user_id=user.user_id,
            amount_paise=session.amount_paise,
            currency=session.currency,
            provider=session.provider,
            provider_payment_id=sub_id,
            provider_order_id=sub_id,
            kind="subscription",
            package_id=None,
            plan_id=plan_id,
        )
        await db.create_pending_subscription(
            user_id=user.user_id,
            plan_id=plan_id or "",
            provider=session.provider,
            provider_subscription_id=sub_id,
            cf_subscription_id=session.cf_subscription_id,
            provider_plan_id=session.provider_plan_id,
        )
    else:
        payment_id = request.app.state.credits.create_pending_payment(
            user_id=user.user_id,
            amount_paise=session.amount_paise,
            currency=session.currency,
            provider=session.provider,
            provider_payment_id=sub_id,
            kind="subscription",
            item_name=payload.item_name,
        )
        request.app.state.credits.create_pending_subscription(
            user_id=user.user_id,
            plan_name=payload.item_name,
            provider=session.provider,
            provider_subscription_id=sub_id,
            provider_plan_id=session.provider_plan_id,
        )

    log_event(
        "checkout_subscription_created",
        request_id,
        user_id=user.user_id,
        kind="subscription",
        item_name=payload.item_name,
        amount_paise=session.amount_paise,
        provider=session.provider,
    )

    return CheckoutCreateResponse(
        payment_id=payment_id,
        provider=session.provider,
        order_id=sub_id,
        subscription_id=sub_id,
        payment_session_id=None,
        subscription_session_id=session.subscription_session_id,
        cashfree_mode="production" if session.cashfree_mode == "production" else "sandbox",
        amount_paise=session.amount_paise,
        currency=session.currency,
        kind="subscription",
        item_name=payload.item_name,
        message="Cashfree Subscription mandate session initialized. Authorize recurring payment via Cashfree hosted checkout.",
    )


@router.post("/billing/verify", response_model=CheckoutVerifyResponse)
async def verify_checkout(
    request: Request, payload: CheckoutVerifyRequest
) -> CheckoutVerifyResponse:
    """
    Authoritative server-side verification invoked when the user returns from Cashfree hosted checkout.
    Never trusts URL parameters alone — queries Cashfree directly and checks ownership/amount/currency.
    """
    user = require_jwt_user(request)
    settings = request.app.state.settings
    request_id = request.state.request_id
    adapter = _resolve_adapter(request)
    db = SupabaseServiceClient(settings)

    if payload.kind == "credit_pack":
        order_id = (payload.order_id or "").strip()
        if not order_id:
            raise ApiServiceError(422, "MISSING_ORDER_ID", "order_id is required to verify a credit pack payment.")

        if db.configured:
            owned = await db.get_payment_for_user(user.user_id, order_id)
        else:
            owned = request.app.state.credits.get_payment_for_user(user.user_id, order_id)

        if not owned or owned.get("kind") != "credit_pack":
            raise ApiServiceError(404, "ORDER_NOT_FOUND", "Payment order not found for your account.")

        item_name = (
            owned.get("item_name")
            or (owned.get("credit_packages") or {}).get("name")
            or None
        )

        verification = await adapter.fetch_order_status(order_id)
        if verification.order_status == "PAID":
            expected_paise = int(owned["amount"] if db.configured else owned["amount_paise"])
            if verification.amount_paise != expected_paise or verification.currency != str(owned["currency"]).upper():
                raise ApiServiceError(
                    409,
                    "PAYMENT_AMOUNT_MISMATCH",
                    "Cashfree order amount or currency did not match our catalog record.",
                )
            event_id = f"verify:order:{order_id}:{verification.cf_payment_id or 'paid'}"
            meta = {
                "event": "ORDER_VERIFY_PAID",
                "order_id": order_id,
                "cf_payment_id": verification.cf_payment_id,
                "amount_paise": verification.amount_paise,
                "currency": verification.currency,
            }
            if db.configured:
                await db.rpc(
                    "process_payment_event",
                    {
                        "p_provider": adapter.provider_name,
                        "p_event_id": event_id,
                        "p_provider_payment_id": order_id,
                        "p_status": "paid",
                        "p_payload_meta": meta,
                    },
                )
                summary = await db.get_billing_summary(user.user_id)
            else:
                request.app.state.credits.process_payment_event(
                    provider=adapter.provider_name,
                    event_id=event_id,
                    provider_payment_id=order_id,
                    status="paid",
                    payload_meta=meta,
                )
                summary = request.app.state.credits.get_summary(user.user_id)

            return CheckoutVerifyResponse(
                kind="credit_pack",
                status="paid",
                item_name=item_name,
                wallet=summary.wallet,
                subscription=summary.subscription,
                message="Payment verified with Cashfree and purchased credits added to your wallet.",
            )

        if verification.order_status == "EXPIRED":
            event_id = f"verify:order:{order_id}:expired"
            if db.configured:
                await db.rpc(
                    "process_payment_event",
                    {
                        "p_provider": adapter.provider_name,
                        "p_event_id": event_id,
                        "p_provider_payment_id": order_id,
                        "p_status": "failed",
                        "p_payload_meta": {"event": "ORDER_VERIFY_EXPIRED"},
                    },
                )
                summary = await db.get_billing_summary(user.user_id)
            else:
                request.app.state.credits.process_payment_event(
                    provider=adapter.provider_name,
                    event_id=event_id,
                    provider_payment_id=order_id,
                    status="failed",
                )
                summary = request.app.state.credits.get_summary(user.user_id)

            return CheckoutVerifyResponse(
                kind="credit_pack",
                status="failed",
                item_name=item_name,
                wallet=summary.wallet,
                subscription=summary.subscription,
                message="Payment order expired or failed before completion.",
            )

        summary = (
            await db.get_billing_summary(user.user_id)
            if db.configured
            else request.app.state.credits.get_summary(user.user_id)
        )
        return CheckoutVerifyResponse(
            kind="credit_pack",
            status="paid" if owned.get("status") == "paid" else "pending",
            item_name=item_name,
            wallet=summary.wallet,
            subscription=summary.subscription,
            message=(
                "Payment confirmed."
                if owned.get("status") == "paid"
                else "Payment is still pending confirmation from Cashfree. Credits will activate once settled."
            ),
        )

    # Subscription verification
    sub_id = (payload.subscription_id or payload.order_id or "").strip()
    if not sub_id:
        raise ApiServiceError(
            422,
            "MISSING_SUBSCRIPTION_ID",
            "subscription_id is required to verify a subscription checkout.",
        )

    if db.configured:
        owned_sub = await db.get_subscription_for_user(user.user_id, sub_id)
        item_name = ((owned_sub or {}).get("plans") or {}).get("name")
    else:
        owned_sub = request.app.state.credits.get_subscription_for_user(user.user_id, sub_id)
        item_name = (owned_sub or {}).get("plan_name")

    if not owned_sub:
        raise ApiServiceError(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found for your account.")

    verification = await adapter.fetch_subscription_status(sub_id)
    cf_status = verification.subscription_status.upper()

    if cf_status == "ACTIVE":
        # Cancel any prior active paid subscription on Cashfree before finalizing activation
        await _cancel_superseded_cashfree_subscriptions(
            db=db,
            request=request,
            adapter=adapter,
            user_id=user.user_id,
            keep_subscription_id=sub_id,
            request_id=request_id,
        )
        event_id = f"verify:sub:{sub_id}:active"
        if db.configured:
            await db.rpc(
                "process_subscription_event",
                {
                    "p_provider": adapter.provider_name,
                    "p_event_id": event_id,
                    "p_subscription_id": sub_id,
                    "p_event_kind": "activated",
                    "p_provider_payment_id": verification.cf_payment_id,
                    "p_amount_paise": verification.amount_paise,
                    "p_currency": verification.currency,
                    "p_period_end": verification.next_schedule_date,
                    "p_payload_meta": {
                        "event": "SUBSCRIPTION_VERIFY_ACTIVE",
                        "cf_subscription_id": verification.cf_subscription_id,
                        "provider_plan_id": verification.plan_id,
                    },
                },
            )
            summary = await db.get_billing_summary(user.user_id)
        else:
            request.app.state.credits.process_subscription_event(
                provider=adapter.provider_name,
                event_id=event_id,
                subscription_id=sub_id,
                event_kind="activated",
                provider_payment_id=verification.cf_payment_id,
                amount_paise=verification.amount_paise,
                currency=verification.currency,
            )
            summary = request.app.state.credits.get_summary(user.user_id)

        return CheckoutVerifyResponse(
            kind="subscription",
            status="active",
            item_name=item_name,
            wallet=summary.wallet,
            subscription=summary.subscription,
            message=f"{item_name or 'Monthly'} subscription mandate is active and monthly credits are ready.",
        )

    if cf_status in {"CANCELLED", "CUSTOMER_CANCELLED", "PAUSED"}:
        mapped_status = "canceled"
        event_kind = "canceled"
        msg = "Subscription mandate was cancelled."
    elif cf_status in {"EXPIRED", "COMPLETED"}:
        mapped_status = "expired"
        event_kind = "expired"
        msg = "Subscription has expired."
    elif cf_status in {"BANK_APPROVAL_FAILED", "ON_HOLD"}:
        mapped_status = "failed"
        event_kind = "payment_failed"
        msg = "Subscription mandate authorization or payment failed."
    else:
        mapped_status = "pending"
        event_kind = None
        msg = "Subscription mandate authorization is pending bank confirmation."

    if event_kind:
        event_id = f"verify:sub:{sub_id}:{event_kind}"
        if db.configured:
            await db.rpc(
                "process_subscription_event",
                {
                    "p_provider": adapter.provider_name,
                    "p_event_id": event_id,
                    "p_subscription_id": sub_id,
                    "p_event_kind": event_kind,
                    "p_payload_meta": {"event": f"SUBSCRIPTION_VERIFY_{cf_status}"},
                },
            )
        else:
            request.app.state.credits.process_subscription_event(
                provider=adapter.provider_name,
                event_id=event_id,
                subscription_id=sub_id,
                event_kind=event_kind,
            )

    summary = (
        await db.get_billing_summary(user.user_id)
        if db.configured
        else request.app.state.credits.get_summary(user.user_id)
    )
    return CheckoutVerifyResponse(
        kind="subscription",
        status=mapped_status,
        item_name=item_name,
        wallet=summary.wallet,
        subscription=summary.subscription,
        message=msg,
    )


@router.post("/billing/subscription/return")
async def cashfree_subscription_return(request: Request) -> RedirectResponse:
    """
    Cashfree Subscriptions posts form data to the configured return URL.
    Convert that POST into a same-site GET so the authenticated billing page
    can call /billing/verify and activate the subscription for its owner.
    """
    raw_body = await request.body()
    form = parse_qs(raw_body.decode("utf-8", errors="replace"))
    subscription_id = (
        (form.get("subscriptionId") or form.get("subscription_id") or [""])[0].strip()
    )
    origin = request.app.state.settings.resolved_frontend_origin.rstrip("/")
    if not subscription_id:
        target = f"{origin}/dashboard/billing?kind=subscription&return_status=missing_id"
    else:
        target = (
            f"{origin}/dashboard/billing?kind=subscription"
            f"&subscription_id={quote(subscription_id, safe='')}"
        )
    return RedirectResponse(url=target, status_code=303)


@router.post("/billing/subscription/cancel", response_model=SubscriptionCancelResponse)
async def cancel_active_subscription(request: Request) -> SubscriptionCancelResponse:
    user = require_jwt_user(request)
    settings = request.app.state.settings
    request_id = request.state.request_id
    adapter = _resolve_adapter(request)
    db = SupabaseServiceClient(settings)

    if db.configured:
        active_sub = await db.get_latest_active_cashfree_subscription(user.user_id)
        if not active_sub or not active_sub.get("provider_subscription_id"):
            raise ApiServiceError(
                404,
                "NO_ACTIVE_SUBSCRIPTION",
                "No active Cashfree subscription found on your account.",
            )
        sub_id = str(active_sub["provider_subscription_id"])
        plan_name = str(((active_sub.get("plans") or {}).get("name")) or "Free")
    else:
        summary = request.app.state.credits.get_summary(user.user_id)
        sub_id = summary.subscription.provider_subscription_id or ""
        plan_name = summary.subscription.plan_name
        if not sub_id or summary.subscription.status not in {"active", "past_due"}:
            raise ApiServiceError(
                404,
                "NO_ACTIVE_SUBSCRIPTION",
                "No active paid subscription found on your account.",
            )

    await adapter.cancel_subscription(sub_id)
    event_id = f"user_cancel:{sub_id}:{uuid.uuid4().hex[:8]}"

    if db.configured:
        await db.rpc(
            "process_subscription_event",
            {
                "p_provider": adapter.provider_name,
                "p_event_id": event_id,
                "p_subscription_id": sub_id,
                "p_event_kind": "canceled",
                "p_payload_meta": {"event": "USER_INITIATED_CANCEL"},
            },
        )
    else:
        request.app.state.credits.process_subscription_event(
            provider=adapter.provider_name,
            event_id=event_id,
            subscription_id=sub_id,
            event_kind="canceled",
        )

    log_event(
        "subscription_canceled",
        request_id,
        user_id=user.user_id,
        subscription_id=sub_id,
        plan_name=plan_name,
    )

    return SubscriptionCancelResponse(
        subscription_id=sub_id,
        status="canceled",
        plan_name=plan_name,
        message=f"Your {plan_name} subscription mandate has been cancelled on Cashfree and will not renew.",
    )


@router.post("/webhooks/payments")
async def handle_payment_webhook(request: Request) -> dict:
    settings = request.app.state.settings
    request_id = request.state.request_id
    adapter = _resolve_adapter(request)

    raw_body = await request.body()
    signature = (
        request.headers.get("x-webhook-signature")
        or request.headers.get("X-Webhook-Signature")
        or ""
    )
    timestamp = (
        request.headers.get("x-webhook-timestamp")
        or request.headers.get("X-Webhook-Timestamp")
        or ""
    )

    if not adapter.verify_webhook_signature(raw_body, signature, timestamp):
        log_event("webhook_signature_rejected", request_id, provider=adapter.provider_name)
        raise ApiServiceError(
            401,
            "INVALID_WEBHOOK_SIGNATURE",
            "Cashfree webhook signature verification failed.",
        )

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except Exception as exc:
        raise ApiServiceError(
            400, "INVALID_WEBHOOK_PAYLOAD", "Malformed JSON webhook body."
        ) from exc

    parsed = adapter.parse_webhook_event(payload)
    db = SupabaseServiceClient(settings)

    if parsed.domain == "subscription":
        if not parsed.subscription_id:
            result: dict = {"status": "ignored", "reason": "missing_subscription_id"}
        else:
            if db.configured:
                result = await db.rpc(
                    "process_subscription_event",
                    {
                        "p_provider": adapter.provider_name,
                        "p_event_id": parsed.event_id,
                        "p_subscription_id": parsed.subscription_id,
                        "p_event_kind": parsed.status,
                        "p_provider_payment_id": parsed.cf_payment_id,
                        "p_amount_paise": parsed.amount_paise,
                        "p_currency": parsed.currency,
                        "p_period_end": parsed.next_schedule_date,
                        "p_payload_meta": parsed.payload_meta,
                    },
                )
            else:
                result = request.app.state.credits.process_subscription_event(
                    provider=adapter.provider_name,
                    event_id=parsed.event_id,
                    subscription_id=parsed.subscription_id,
                    event_kind=parsed.status,
                    provider_payment_id=parsed.cf_payment_id,
                    amount_paise=parsed.amount_paise,
                    currency=parsed.currency,
                    payload_meta=parsed.payload_meta,
                )

            if isinstance(result, dict):
                for old_sub_id in result.get("superseded_subscription_ids") or []:
                    try:
                        await adapter.cancel_subscription(str(old_sub_id))
                    except Exception:
                        log_event(
                            "cashfree_old_subscription_cancel_warning",
                            request_id,
                            old_subscription_id=str(old_sub_id),
                        )
    elif parsed.domain == "order":
        if not parsed.provider_payment_id:
            result = {"status": "ignored", "reason": "missing_order_id"}
        elif db.configured:
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
                payload_meta=parsed.payload_meta,
            )
    else:
        result = {"status": "ignored", "event": parsed.event_type}

    log_event(
        "payment_webhook_processed",
        request_id,
        provider=adapter.provider_name,
        domain=parsed.domain,
        event_id=parsed.event_id,
        status=parsed.status,
        outcome=result.get("status") if isinstance(result, dict) else "ok",
    )
    return {"success": True, "result": result}
