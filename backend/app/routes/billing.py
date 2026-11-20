import json
import uuid
import httpx
from fastapi import APIRouter, Request

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
from app.services.credits import PACK_CATALOG, PLAN_CATALOG, PlanSpec
from app.services.payments import (
    PaymentProviderAdapter,
    SubscriptionVerificationResult,
    _plan_id_for_name,
    get_payment_adapter,
)
from app.utils.security import ApiServiceError, log_event

router = APIRouter(prefix="/v1", tags=["Billing & Credits"])

_PROVIDER_PLAN_ID_MAP: dict[str, PlanSpec] = {
    _plan_id_for_name(name): spec
    for name, spec in PLAN_CATALOG.items()
    if spec.monthly_price_paise > 0
}


def _resolve_adapter(request: Request) -> PaymentProviderAdapter:
    adapter = getattr(request.app.state, "payment_adapter", None)
    if adapter is not None:
        return adapter
    return get_payment_adapter(request.app.state.settings)


def _require_billing_db(request: Request) -> SupabaseServiceClient | None:
    """
    Never allow silent in-memory billing fallback outside local development/test runs.
    In production/staging, missing Supabase configuration fails safely with HTTP 503.
    """
    settings = request.app.state.settings
    db = SupabaseServiceClient(settings)
    if db.configured:
        return db
    if settings.environment in {"test", "development"}:
        return None
    raise ApiServiceError(
        503,
        "BILLING_DATABASE_NOT_CONFIGURED",
        "Persistent billing database (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) is not configured on the backend.",
    )


def _resolve_plan_from_cashfree(
    verification: SubscriptionVerificationResult,
) -> PlanSpec | None:
    if verification.plan_id:
        by_id = _PROVIDER_PLAN_ID_MAP.get(verification.plan_id.strip().lower())
        if by_id:
            return by_id

    tags = verification.subscription_tags or {}
    tag_plan = str(tags.get("plan_name") or "").strip()
    if tag_plan and tag_plan in PLAN_CATALOG and PLAN_CATALOG[tag_plan].monthly_price_paise > 0:
        return PLAN_CATALOG[tag_plan]

    if verification.amount_paise and verification.currency.upper() == "INR":
        matches = [
            spec
            for spec in PLAN_CATALOG.values()
            if spec.monthly_price_paise > 0 and spec.monthly_price_paise == verification.amount_paise
        ]
        if len(matches) == 1:
            return matches[0]
    return None


def _assert_cashfree_subscription_ownership(
    *,
    verification: SubscriptionVerificationResult,
    user_id: str,
    user_email: str | None,
) -> None:
    tags = verification.subscription_tags or {}
    tag_user_id = str(tags.get("user_id") or "").strip()
    if tag_user_id:
        if tag_user_id != user_id:
            raise ApiServiceError(
                403,
                "SUBSCRIPTION_OWNERSHIP_MISMATCH",
                "This Cashfree subscription is linked to a different user account.",
            )
        return

    cf_email = (verification.customer_email or "").strip().lower()
    auth_email = (user_email or "").strip().lower()
    if cf_email and auth_email and cf_email == auth_email:
        return

    raise ApiServiceError(
        403,
        "SUBSCRIPTION_OWNERSHIP_UNVERIFIED",
        "Ownership of this Cashfree subscription could not be verified for your signed-in account.",
    )


async def _reconcile_subscription_record(
    *,
    db: SupabaseServiceClient | None,
    request: Request,
    adapter: PaymentProviderAdapter,
    user_id: str,
    user_email: str | None,
    sub_id: str,
    verification: SubscriptionVerificationResult,
) -> str:
    plan_spec = _resolve_plan_from_cashfree(verification)
    if not plan_spec:
        raise ApiServiceError(
            409,
            "UNRECOGNIZED_SUBSCRIPTION_PLAN",
            "Cashfree subscription plan does not match any active CleanData Studio plan.",
        )

    if verification.currency and verification.currency.upper() != "INR":
        raise ApiServiceError(
            409,
            "PAYMENT_CURRENCY_MISMATCH",
            "Cashfree subscription currency did not match INR.",
        )

    if (
        verification.amount_paise is not None
        and verification.amount_paise > 0
        and verification.amount_paise != plan_spec.monthly_price_paise
    ):
        raise ApiServiceError(
            409,
            "PAYMENT_AMOUNT_MISMATCH",
            "Cashfree subscription amount did not match our catalog plan price.",
        )

    provider_plan_id = verification.plan_id or _plan_id_for_name(plan_spec.name)

    if db is not None:
        await db.ensure_user_billing_profile(user_id, user_email)
        row = await db.get_catalog_plan(plan_spec.name)
        if not row:
            raise ApiServiceError(
                503,
                "CATALOG_PLAN_MISSING",
                f"Plan '{plan_spec.name}' is not seeded in the database.",
            )
        plan_id = str(row["id"])
        await db.create_pending_payment(
            user_id=user_id,
            amount_paise=plan_spec.monthly_price_paise,
            currency="INR",
            provider=adapter.provider_name,
            provider_payment_id=sub_id,
            provider_order_id=sub_id,
            kind="subscription",
            package_id=None,
            plan_id=plan_id,
        )
        await db.create_pending_subscription(
            user_id=user_id,
            plan_id=plan_id,
            provider=adapter.provider_name,
            provider_subscription_id=sub_id,
            cf_subscription_id=verification.cf_subscription_id,
            provider_plan_id=provider_plan_id,
        )
    else:
        request.app.state.credits.create_pending_payment(
            user_id=user_id,
            amount_paise=plan_spec.monthly_price_paise,
            currency="INR",
            provider=adapter.provider_name,
            provider_payment_id=sub_id,
            kind="subscription",
            item_name=plan_spec.name,
        )
        request.app.state.credits.create_pending_subscription(
            user_id=user_id,
            plan_name=plan_spec.name,
            provider=adapter.provider_name,
            provider_subscription_id=sub_id,
            provider_plan_id=provider_plan_id,
        )

    return plan_spec.name


async def _cancel_superseded_cashfree_subscriptions(
    *,
    db: SupabaseServiceClient | None,
    request: Request,
    adapter: PaymentProviderAdapter,
    user_id: str,
    keep_subscription_id: str,
    request_id: str,
) -> None:
    if db is not None:
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
    request_id = request.state.request_id
    db = _require_billing_db(request)
    if db is not None:
        try:
            return await db.get_billing_summary(user.user_id)
        except httpx.HTTPError as exc:
            log_event("billing_summary_db_error", request_id, user_id=user.user_id)
            raise ApiServiceError(
                503,
                "BILLING_DATABASE_UNAVAILABLE",
                "Unable to load billing summary from database. Please retry.",
            ) from exc
    return request.app.state.credits.get_summary(user.user_id)


@router.post("/billing/checkout", response_model=CheckoutCreateResponse)
async def create_checkout(
    request: Request, payload: CheckoutCreateRequest
) -> CheckoutCreateResponse:
    user = require_jwt_user(request)
    request_id = request.state.request_id
    adapter = _resolve_adapter(request)
    db = _require_billing_db(request)

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
        if db is not None:
            try:
                await db.ensure_user_billing_profile(user.user_id, user.email)
                row = await db.get_catalog_package(payload.item_name)
            except httpx.HTTPError as exc:
                log_event("checkout_db_lookup_error", request_id, user_id=user.user_id)
                raise ApiServiceError(
                    503,
                    "BILLING_DATABASE_UNAVAILABLE",
                    "Unable to access billing database to initialize checkout.",
                ) from exc
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

        if db is not None:
            try:
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
            except httpx.HTTPError as exc:
                log_event("checkout_db_persist_error", request_id, user_id=user.user_id, kind="credit_pack")
                raise ApiServiceError(
                    503,
                    "BILLING_DATABASE_UNAVAILABLE",
                    "Cashfree order created, but failed to persist pending payment record. Please retry.",
                ) from exc
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
    if db is not None:
        try:
            await db.ensure_user_billing_profile(user.user_id, user.email)
            row = await db.get_catalog_plan(payload.item_name)
        except httpx.HTTPError as exc:
            log_event("checkout_db_lookup_error", request_id, user_id=user.user_id, kind="subscription")
            raise ApiServiceError(
                503,
                "BILLING_DATABASE_UNAVAILABLE",
                "Unable to access billing database to initialize subscription checkout.",
            ) from exc
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

    if db is not None:
        try:
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
        except httpx.HTTPError as exc:
            log_event("checkout_db_persist_error", request_id, user_id=user.user_id, kind="subscription")
            raise ApiServiceError(
                503,
                "BILLING_DATABASE_UNAVAILABLE",
                "Unable to persist subscription checkout record in Supabase. Please retry.",
            ) from exc
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
    Authoritative server-side verification invoked when returning from Cashfree checkout
    or when reconciling an existing Cashfree subscription.
    Never trusts URL parameters alone — queries Cashfree directly and enforces user ownership,
    plan, amount, and currency integrity before persisting state or granting credits.
    """
    user = require_jwt_user(request)
    request_id = request.state.request_id
    adapter = _resolve_adapter(request)
    db = _require_billing_db(request)

    if payload.kind == "credit_pack":
        order_id = (payload.order_id or "").strip()
        if not order_id:
            raise ApiServiceError(
                422, "MISSING_ORDER_ID", "order_id is required to verify a credit pack payment."
            )

        if db is not None:
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
            expected_paise = int(owned["amount"] if db is not None else owned["amount_paise"])
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
            if db is not None:
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
            if db is not None:
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
            if db is not None
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

    # Subscription verification & secure missing-record reconciliation
    sub_id = (payload.subscription_id or payload.order_id or "").strip()
    if not sub_id:
        raise ApiServiceError(
            422,
            "MISSING_SUBSCRIPTION_ID",
            "subscription_id is required to verify a subscription checkout.",
        )

    if db is not None:
        owned_sub = await db.get_subscription_for_user(user.user_id, sub_id)
        owner_any = (
            user.user_id
            if owned_sub
            else await db.get_subscription_owner_any_user(sub_id)
        )
        item_name = ((owned_sub or {}).get("plans") or {}).get("name")
    else:
        owned_sub = request.app.state.credits.get_subscription_for_user(user.user_id, sub_id)
        owner_any = (
            user.user_id
            if owned_sub
            else request.app.state.credits.get_subscription_owner_any_user(sub_id)
        )
        item_name = (owned_sub or {}).get("plan_name")

    if owner_any and owner_any != user.user_id:
        raise ApiServiceError(
            403,
            "SUBSCRIPTION_OWNERSHIP_MISMATCH",
            "This subscription belongs to a different CleanData Studio account.",
        )

    verification = await adapter.fetch_subscription_status(sub_id)

    # Reconcile missing local subscription/payment rows ONLY if Cashfree ownership is proven
    if not owned_sub:
        _assert_cashfree_subscription_ownership(
            verification=verification,
            user_id=user.user_id,
            user_email=user.email,
        )
        item_name = await _reconcile_subscription_record(
            db=db,
            request=request,
            adapter=adapter,
            user_id=user.user_id,
            user_email=user.email,
            sub_id=sub_id,
            verification=verification,
        )
        log_event(
            "subscription_record_reconciled",
            request_id,
            user_id=user.user_id,
            subscription_id=sub_id,
            plan_name=item_name,
        )

    cf_status = verification.subscription_status.upper()

    if cf_status == "ACTIVE":
        expected_plan = PLAN_CATALOG.get(item_name or "") or _resolve_plan_from_cashfree(verification)
        if expected_plan:
            if verification.currency and verification.currency.upper() != "INR":
                raise ApiServiceError(
                    409,
                    "PAYMENT_CURRENCY_MISMATCH",
                    "Cashfree subscription currency did not match INR.",
                )
            if (
                verification.amount_paise is not None
                and verification.amount_paise > 0
                and verification.amount_paise != expected_plan.monthly_price_paise
            ):
                raise ApiServiceError(
                    409,
                    "PAYMENT_AMOUNT_MISMATCH",
                    "Cashfree subscription amount did not match our catalog plan price.",
                )

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
        if db is not None:
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
        if db is not None:
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
        if db is not None
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


@router.post("/billing/subscription/cancel", response_model=SubscriptionCancelResponse)
async def cancel_active_subscription(request: Request) -> SubscriptionCancelResponse:
    user = require_jwt_user(request)
    request_id = request.state.request_id
    adapter = _resolve_adapter(request)
    db = _require_billing_db(request)

    if db is not None:
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

    if db is not None:
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
    request_id = request.state.request_id
    adapter = _resolve_adapter(request)
    db = _require_billing_db(request)

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

    if parsed.domain == "subscription":
        if not parsed.subscription_id:
            result: dict = {"status": "ignored", "reason": "missing_subscription_id"}
        else:
            if db is not None:
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

            # Secure webhook reconciliation if pending DB records were lost before Cashfree delivered the event
            if isinstance(result, dict) and result.get("status") == "subscription_not_found":
                try:
                    cf_sub = await adapter.fetch_subscription_status(parsed.subscription_id)
                    tags = cf_sub.subscription_tags or {}
                    resolved_uid = str(tags.get("user_id") or "").strip() or None
                    if not resolved_uid and db is not None and cf_sub.customer_email:
                        resolved_uid = await db.find_user_id_by_email(cf_sub.customer_email)

                    if resolved_uid:
                        await _reconcile_subscription_record(
                            db=db,
                            request=request,
                            adapter=adapter,
                            user_id=resolved_uid,
                            user_email=cf_sub.customer_email,
                            sub_id=parsed.subscription_id,
                            verification=cf_sub,
                        )
                        if db is not None:
                            result = await db.rpc(
                                "process_subscription_event",
                                {
                                    "p_provider": adapter.provider_name,
                                    "p_event_id": parsed.event_id,
                                    "p_subscription_id": parsed.subscription_id,
                                    "p_event_kind": parsed.status,
                                    "p_provider_payment_id": parsed.cf_payment_id or cf_sub.cf_payment_id,
                                    "p_amount_paise": parsed.amount_paise or cf_sub.amount_paise,
                                    "p_currency": parsed.currency,
                                    "p_period_end": parsed.next_schedule_date or cf_sub.next_schedule_date,
                                    "p_payload_meta": parsed.payload_meta,
                                },
                            )
                        else:
                            result = request.app.state.credits.process_subscription_event(
                                provider=adapter.provider_name,
                                event_id=parsed.event_id,
                                subscription_id=parsed.subscription_id,
                                event_kind=parsed.status,
                                provider_payment_id=parsed.cf_payment_id or cf_sub.cf_payment_id,
                                amount_paise=parsed.amount_paise or cf_sub.amount_paise,
                                currency=parsed.currency,
                                payload_meta=parsed.payload_meta,
                            )
                except ApiServiceError:
                    log_event(
                        "webhook_subscription_reconcile_rejected",
                        request_id,
                        subscription_id=parsed.subscription_id,
                    )
                except Exception:
                    log_event(
                        "webhook_subscription_reconcile_error",
                        request_id,
                        subscription_id=parsed.subscription_id,
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
        elif db is not None:
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
