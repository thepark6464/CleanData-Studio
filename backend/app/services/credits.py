import datetime as dt
import math
import uuid
from dataclasses import dataclass, field
from typing import Any

from app.config import Settings
from app.database import SupabaseServiceClient
from app.models import (
    ActiveSubscriptionSummary,
    BillingSummaryResponse,
    CreditTransactionItem,
    CreditWalletSummary,
    PaymentRecordItem,
)
from app.utils.security import ApiServiceError

ROWS_PER_CREDIT = 1000


@dataclass(frozen=True)
class PlanSpec:
    name: str
    monthly_price_paise: int
    monthly_credits: int
    max_file_size_mb: int
    daily_job_limit: int | None
    api_access: bool
    api_rate_limit_per_min: int


@dataclass(frozen=True)
class CreditPackSpec:
    name: str
    credits: int
    price_paise: int
    currency: str = "INR"


PLAN_CATALOG: dict[str, PlanSpec] = {
    "Free": PlanSpec("Free", 0, 0, 5, 3, False, 0),
    "Starter": PlanSpec("Starter", 29900, 100, 25, None, False, 0),
    "Pro": PlanSpec("Pro", 79900, 500, 100, None, True, 60),
    "Business": PlanSpec("Business", 199900, 2000, 250, None, True, 240),
}

PACK_CATALOG: dict[str, CreditPackSpec] = {
    "10 Credits": CreditPackSpec("10 Credits", 10, 4900),
    "50 Credits": CreditPackSpec("50 Credits", 50, 14900),
    "150 Credits": CreditPackSpec("150 Credits", 150, 34900),
    "500 Credits": CreditPackSpec("500 Credits", 500, 89900),
}


def estimate_credits_for_rows(row_count: int) -> int:
    if row_count <= 0:
        return 0
    return math.ceil(row_count / ROWS_PER_CREDIT)


@dataclass
class _WalletState:
    subscription_balance: int = 0
    purchased_balance: int = 0
    subscription_expires_at: dt.datetime | None = None
    purchased_expires_at: dt.datetime | None = None
    plan_name: str = "Free"
    subscription_status: str = "free"
    subscription_provider: str = "system"
    provider_subscription_id: str | None = None
    cancel_at_period_end: bool = False
    daily_job_dates: list[dt.date] = field(default_factory=list)


@dataclass
class _JobReservation:
    user_id: str
    reserved: int
    charged: int
    sub_reserved: int
    pur_reserved: int
    refunded: bool = False


class InMemoryCreditStore:
    """
    Exact deterministic mirror of Supabase's credit/payment RPC rules
    (subscription-first deduction, atomic reserve/commit/refund, idempotent webhooks, expiry).
    Used automatically in pytest/dev when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are unset.
    """

    def __init__(self) -> None:
        self.wallets: dict[str, _WalletState] = {}
        self.transactions: list[dict[str, Any]] = []
        self.idempotency_keys: set[str] = set()
        self.reservations: dict[str, _JobReservation] = {}
        self.payments: dict[str, dict[str, Any]] = {}
        self.payment_by_provider_id: dict[str, str] = {}
        self.subscriptions: dict[str, dict[str, Any]] = {}
        self.webhook_events: set[tuple[str, str]] = set()

    def ensure_wallet(self, user_id: str) -> _WalletState:
        if user_id not in self.wallets:
            self.wallets[user_id] = _WalletState()
        return self.wallets[user_id]

    def grant_subscription_credits(
        self,
        user_id: str,
        plan_name: str,
        amount: int,
        period_end: dt.datetime,
        *,
        provider: str = "cashfree",
        provider_subscription_id: str | None = None,
    ) -> None:
        w = self.ensure_wallet(user_id)
        w.plan_name = plan_name
        w.subscription_status = "active"
        w.subscription_provider = provider
        if provider_subscription_id is not None:
            w.provider_subscription_id = provider_subscription_id
        w.cancel_at_period_end = False
        w.subscription_balance = amount
        w.subscription_expires_at = period_end
        if amount > 0:
            self.transactions.append(
                {
                    "id": str(uuid.uuid4()),
                    "user_id": user_id,
                    "amount": amount,
                    "credit_source": "subscription",
                    "transaction_type": "subscription_grant",
                    "reference_id": provider_subscription_id or plan_name,
                    "expires_at": period_end.isoformat(),
                    "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                }
            )

    def grant_purchased_credits(self, user_id: str, amount: int, payment_id: str) -> None:
        idem = f"purchase:{payment_id}"
        if idem in self.idempotency_keys:
            return
        self.idempotency_keys.add(idem)
        w = self.ensure_wallet(user_id)
        expiry = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=365)
        w.purchased_balance += amount
        if w.purchased_expires_at is None or expiry > w.purchased_expires_at:
            w.purchased_expires_at = expiry
        self.transactions.append(
            {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "amount": amount,
                "credit_source": "purchased",
                "transaction_type": "purchase",
                "reference_id": payment_id,
                "expires_at": expiry.isoformat(),
                "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            }
        )

    def expire_credits(self, now: dt.datetime | None = None) -> int:
        ref = now or dt.datetime.now(dt.timezone.utc)
        expired_count = 0
        for user_id, w in self.wallets.items():
            if (
                w.subscription_balance > 0
                and w.subscription_expires_at is not None
                and w.subscription_expires_at <= ref
            ):
                self.transactions.append(
                    {
                        "id": str(uuid.uuid4()),
                        "user_id": user_id,
                        "amount": -w.subscription_balance,
                        "credit_source": "subscription",
                        "transaction_type": "expire",
                        "reference_id": w.provider_subscription_id,
                        "expires_at": w.subscription_expires_at.isoformat(),
                        "created_at": ref.isoformat(),
                    }
                )
                w.subscription_balance = 0
                expired_count += 1
            if (
                w.purchased_balance > 0
                and w.purchased_expires_at is not None
                and w.purchased_expires_at <= ref
            ):
                self.transactions.append(
                    {
                        "id": str(uuid.uuid4()),
                        "user_id": user_id,
                        "amount": -w.purchased_balance,
                        "credit_source": "purchased",
                        "transaction_type": "expire",
                        "reference_id": None,
                        "expires_at": w.purchased_expires_at.isoformat(),
                        "created_at": ref.isoformat(),
                    }
                )
                w.purchased_balance = 0
                expired_count += 1
        return expired_count

    def reserve_for_job(
        self,
        *,
        user_id: str,
        job_id: str,
        amount: int,
        file_mb: float,
        idempotency_key: str | None,
    ) -> int:
        self.expire_credits()
        w = self.ensure_wallet(user_id)
        plan = PLAN_CATALOG.get(w.plan_name, PLAN_CATALOG["Free"])

        if file_mb > plan.max_file_size_mb:
            raise ApiServiceError(
                413,
                "FILE_TOO_LARGE_FOR_PLAN",
                f"File exceeds your {plan.name} plan upload limit ({plan.max_file_size_mb} MB).",
            )

        if amount <= 0:
            self.reservations[job_id] = _JobReservation(user_id, 0, 0, 0, 0)
            return 0

        idem_sub = f"{user_id}:{idempotency_key}:reserve" if idempotency_key else None
        if idem_sub and idem_sub in self.idempotency_keys:
            existing = self.reservations.get(job_id)
            return existing.reserved if existing else amount

        total_avail = w.subscription_balance + w.purchased_balance

        # Free plan without credits allows up to daily_job_limit (3/day) small server jobs (<=5 credits)
        if plan.name == "Free" and total_avail < amount:
            today = dt.datetime.now(dt.timezone.utc).date()
            today_count = sum(1 for d in w.daily_job_dates if d == today)
            if plan.daily_job_limit is not None and today_count >= plan.daily_job_limit:
                raise ApiServiceError(
                    429,
                    "DAILY_JOB_LIMIT_REACHED",
                    f"Free plan limit of {plan.daily_job_limit} server jobs/day reached. Upgrade or purchase a credit pack.",
                )
            if amount > 5:
                raise ApiServiceError(
                    402,
                    "INSUFFICIENT_CREDITS",
                    f"This dataset requires {amount} credits, exceeding the Free server trial. Purchase credits or upgrade.",
                )
            w.daily_job_dates.append(today)
            self.reservations[job_id] = _JobReservation(user_id, 0, 0, 0, 0)
            return 0

        if total_avail < amount:
            raise ApiServiceError(
                402,
                "INSUFFICIENT_CREDITS",
                f"Insufficient credits: {amount} required, {total_avail} available.",
            )

        sub_spend = min(w.subscription_balance, amount)
        pur_spend = amount - sub_spend
        w.subscription_balance -= sub_spend
        w.purchased_balance -= pur_spend

        now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
        if sub_spend > 0:
            self.transactions.append(
                {
                    "id": str(uuid.uuid4()),
                    "user_id": user_id,
                    "amount": -sub_spend,
                    "credit_source": "subscription",
                    "transaction_type": "reserve",
                    "reference_id": job_id,
                    "expires_at": None,
                    "created_at": now_iso,
                }
            )
        if pur_spend > 0:
            self.transactions.append(
                {
                    "id": str(uuid.uuid4()),
                    "user_id": user_id,
                    "amount": -pur_spend,
                    "credit_source": "purchased",
                    "transaction_type": "reserve",
                    "reference_id": job_id,
                    "expires_at": None,
                    "created_at": now_iso,
                }
            )

        if idem_sub:
            self.idempotency_keys.add(idem_sub)

        self.reservations[job_id] = _JobReservation(
            user_id=user_id,
            reserved=amount,
            charged=0,
            sub_reserved=sub_spend,
            pur_reserved=pur_spend,
        )
        return amount

    def commit_for_job(self, job_id: str) -> int:
        res = self.reservations.get(job_id)
        if not res or res.reserved == 0 or res.charged > 0 or res.refunded:
            return res.charged if res else 0
        res.charged = res.reserved
        commit_key = f"commit:{job_id}"
        if commit_key not in self.idempotency_keys:
            self.idempotency_keys.add(commit_key)
            self.transactions.append(
                {
                    "id": str(uuid.uuid4()),
                    "user_id": res.user_id,
                    "amount": 0,
                    "credit_source": "subscription" if res.sub_reserved >= res.pur_reserved else "purchased",
                    "transaction_type": "commit",
                    "reference_id": job_id,
                    "expires_at": None,
                    "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                }
            )
        return res.charged

    def refund_for_job(self, job_id: str) -> int:
        res = self.reservations.get(job_id)
        if not res or res.reserved == 0 or res.refunded:
            return 0
        w = self.ensure_wallet(res.user_id)
        w.subscription_balance += res.sub_reserved
        w.purchased_balance += res.pur_reserved
        now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
        if res.sub_reserved > 0:
            self.transactions.append(
                {
                    "id": str(uuid.uuid4()),
                    "user_id": res.user_id,
                    "amount": res.sub_reserved,
                    "credit_source": "subscription",
                    "transaction_type": "refund",
                    "reference_id": job_id,
                    "expires_at": None,
                    "created_at": now_iso,
                }
            )
        if res.pur_reserved > 0:
            self.transactions.append(
                {
                    "id": str(uuid.uuid4()),
                    "user_id": res.user_id,
                    "amount": res.pur_reserved,
                    "credit_source": "purchased",
                    "transaction_type": "refund",
                    "reference_id": job_id,
                    "expires_at": None,
                    "created_at": now_iso,
                }
            )
        total_refunded = res.reserved
        res.refunded = True
        res.reserved = 0
        res.charged = 0
        return total_refunded

    def create_pending_payment(
        self,
        *,
        user_id: str,
        amount_paise: int,
        currency: str,
        provider: str,
        provider_payment_id: str,
        kind: str,
        item_name: str,
    ) -> str:
        payment_id = str(uuid.uuid4())
        self.payments[payment_id] = {
            "id": payment_id,
            "user_id": user_id,
            "amount_paise": amount_paise,
            "currency": currency,
            "provider": provider,
            "provider_payment_id": provider_payment_id,
            "kind": kind,
            "item_name": item_name,
            "status": "pending",
            "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        }
        self.payment_by_provider_id[provider_payment_id] = payment_id
        return payment_id

    def create_pending_subscription(
        self,
        *,
        user_id: str,
        plan_name: str,
        provider: str,
        provider_subscription_id: str,
        provider_plan_id: str | None = None,
    ) -> None:
        self.subscriptions[provider_subscription_id] = {
            "user_id": user_id,
            "plan_name": plan_name,
            "provider": provider,
            "provider_subscription_id": provider_subscription_id,
            "provider_plan_id": provider_plan_id,
            "status": "pending",
            "cancel_at_period_end": False,
            "current_period_start": None,
            "current_period_end": None,
            "last_credited_at": None,
            "last_credited_payment_id": None,
        }

    def get_payment_for_user(
        self, user_id: str, provider_payment_id: str
    ) -> dict[str, Any] | None:
        pid = self.payment_by_provider_id.get(provider_payment_id)
        if not pid:
            return None
        row = self.payments.get(pid)
        if row and row["user_id"] == user_id:
            return row
        return None

    def get_order_owner_any_user(self, order_id: str) -> str | None:
        pid = self.payment_by_provider_id.get(order_id)
        if not pid:
            return None
        row = self.payments.get(pid)
        return str(row["user_id"]) if row else None

    def get_subscription_for_user(
        self, user_id: str, subscription_id: str
    ) -> dict[str, Any] | None:
        row = self.subscriptions.get(subscription_id)
        if row and row["user_id"] == user_id:
            return row
        return None

    def get_subscription_owner_any_user(self, subscription_id: str) -> str | None:
        row = self.subscriptions.get(subscription_id)
        if row:
            return str(row["user_id"])
        pid = self.payment_by_provider_id.get(subscription_id)
        if pid and pid in self.payments:
            return str(self.payments[pid]["user_id"])
        return None

    def list_other_active_subscriptions(
        self, user_id: str, exclude_subscription_id: str
    ) -> list[dict[str, Any]]:
        return [
            sub
            for sub_id, sub in self.subscriptions.items()
            if sub["user_id"] == user_id
            and sub_id != exclude_subscription_id
            and sub["status"] in {"active", "past_due"}
        ]

    def process_payment_event(
        self,
        *,
        provider: str,
        event_id: str,
        provider_payment_id: str,
        status: str,
        payload_meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        dedup_key = (provider, event_id)
        if dedup_key in self.webhook_events:
            return {"status": "already_processed"}

        payment_id = self.payment_by_provider_id.get(provider_payment_id)
        if not payment_id:
            return {"status": "payment_not_found"}
        self.webhook_events.add(dedup_key)
        payment = self.payments[payment_id]
        meta = payload_meta or {}

        if status == "paid":
            meta_currency = str(meta.get("currency") or "").upper()
            if meta_currency and meta_currency != str(payment["currency"]).upper():
                return {"status": "currency_mismatch"}
            meta_amount = meta.get("amount_paise")
            if meta_amount is not None and int(meta_amount) != int(payment["amount_paise"]):
                return {"status": "amount_mismatch"}

        prev_status = payment["status"]
        if prev_status in {"paid", "refunded"} and status == "failed":
            return {"status": "ignored_stale_failure", "payment_id": payment_id}

        payment["status"] = status

        if status == "paid" and prev_status != "paid":
            if payment["kind"] == "credit_pack":
                pack = PACK_CATALOG.get(payment["item_name"])
                if pack:
                    self.grant_purchased_credits(payment["user_id"], pack.credits, payment_id)
            elif payment["kind"] == "subscription":
                plan = PLAN_CATALOG.get(payment["item_name"])
                if plan:
                    period_end = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=30)
                    self.grant_subscription_credits(
                        payment["user_id"],
                        plan.name,
                        plan.monthly_credits,
                        period_end,
                        provider=provider,
                        provider_subscription_id=provider_payment_id,
                    )
        elif status == "refunded" and prev_status == "paid":
            if payment["kind"] == "credit_pack":
                pack = PACK_CATALOG.get(payment["item_name"])
                revoke_key = f"refund_revoke:{payment_id}"
                if pack and revoke_key not in self.idempotency_keys:
                    self.idempotency_keys.add(revoke_key)
                    w = self.ensure_wallet(payment["user_id"])
                    revoke_amt = min(w.purchased_balance, pack.credits)
                    if revoke_amt > 0:
                        w.purchased_balance -= revoke_amt
                        self.transactions.append(
                            {
                                "id": str(uuid.uuid4()),
                                "user_id": payment["user_id"],
                                "amount": -revoke_amt,
                                "credit_source": "purchased",
                                "transaction_type": "adjustment",
                                "reference_id": payment_id,
                                "expires_at": None,
                                "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                            }
                        )

        return {"status": "processed", "payment_id": payment_id}

    def process_subscription_event(
        self,
        *,
        provider: str,
        event_id: str,
        subscription_id: str,
        event_kind: str,
        provider_payment_id: str | None = None,
        amount_paise: int | None = None,
        currency: str = "INR",
        period_end: dt.datetime | None = None,
        payload_meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        dedup_key = (provider, event_id)
        if dedup_key in self.webhook_events:
            return {"status": "already_processed"}

        sub = self.subscriptions.get(subscription_id)
        if not sub:
            pay_id = self.payment_by_provider_id.get(subscription_id)
            if not pay_id:
                return {"status": "subscription_not_found"}
            pay = self.payments[pay_id]
            sub = {
                "user_id": pay["user_id"],
                "plan_name": pay["item_name"],
                "provider": provider,
                "provider_subscription_id": subscription_id,
                "provider_plan_id": (payload_meta or {}).get("provider_plan_id"),
                "status": "pending",
                "cancel_at_period_end": False,
                "current_period_start": None,
                "current_period_end": None,
                "last_credited_at": None,
                "last_credited_payment_id": None,
            }
            self.subscriptions[subscription_id] = sub

        self.webhook_events.add(dedup_key)

        plan = PLAN_CATALOG.get(sub["plan_name"])
        if not plan:
            return {"status": "plan_not_found"}

        user_id = sub["user_id"]
        w = self.ensure_wallet(user_id)
        now = dt.datetime.now(dt.timezone.utc)
        resolved_end = period_end or (now + dt.timedelta(days=30))

        if event_kind in {"activated", "renewal_paid"}:
            if currency and currency.upper() != "INR":
                return {"status": "currency_mismatch"}
            if amount_paise is not None and amount_paise > 0 and amount_paise != plan.monthly_price_paise:
                return {"status": "amount_mismatch"}

            should_credit = False
            last_at: dt.datetime | None = sub.get("last_credited_at")
            if last_at is None:
                should_credit = True
            elif (
                provider_payment_id
                and sub.get("last_credited_payment_id") != provider_payment_id
                and (now - last_at) > dt.timedelta(hours=12)
            ):
                should_credit = True

            # Settle initial checkout row for Cycle 1 (attach provider_reference_id without duplicating payment row)
            init_pay_id = self.payment_by_provider_id.get(subscription_id)
            if init_pay_id:
                if self.payments[init_pay_id]["status"] == "pending":
                    self.payments[init_pay_id]["status"] = "paid"
                if provider_payment_id and not self.payments[init_pay_id].get("provider_reference_id"):
                    self.payments[init_pay_id]["provider_reference_id"] = provider_payment_id

            # Add recurring charge ledger entry ONLY for Month 2+ renewals (when last_at was already set)
            if (
                should_credit
                and last_at is not None
                and provider_payment_id
                and provider_payment_id != subscription_id
                and provider_payment_id not in self.payment_by_provider_id
            ):
                new_pay_id = str(uuid.uuid4())
                self.payments[new_pay_id] = {
                    "id": new_pay_id,
                    "user_id": user_id,
                    "amount_paise": plan.monthly_price_paise,
                    "currency": "INR",
                    "provider": provider,
                    "provider_payment_id": provider_payment_id,
                    "kind": "subscription",
                    "item_name": plan.name,
                    "status": "paid",
                    "created_at": now.isoformat(),
                }
                self.payment_by_provider_id[provider_payment_id] = new_pay_id

            # Cancel any previous active subscription records for this user
            superseded_ids: list[str] = []
            for other_id, other in self.subscriptions.items():
                if other["user_id"] == user_id and other_id != subscription_id and other["status"] in {"active", "past_due"}:
                    other["status"] = "canceled"
                    other["cancel_at_period_end"] = True
                    if other.get("provider") in {"cashfree", "test_hmac"}:
                        superseded_ids.append(other_id)

            sub["status"] = "active"
            sub["cancel_at_period_end"] = False
            if should_credit or sub.get("current_period_start") is None:
                sub["current_period_start"] = now
                sub["current_period_end"] = resolved_end
            if should_credit:
                sub["last_credited_at"] = now
                if provider_payment_id:
                    sub["last_credited_payment_id"] = provider_payment_id
                self.grant_subscription_credits(
                    user_id,
                    plan.name,
                    plan.monthly_credits,
                    resolved_end,
                    provider=provider,
                    provider_subscription_id=subscription_id,
                )
            else:
                if provider_payment_id and not sub.get("last_credited_payment_id"):
                    sub["last_credited_payment_id"] = provider_payment_id
                w.plan_name = plan.name
                w.subscription_status = "active"
                w.subscription_provider = provider
                w.provider_subscription_id = subscription_id
                w.cancel_at_period_end = False

            return {
                "status": "processed",
                "subscription_id": subscription_id,
                "subscription_status": "active",
                "credited": should_credit,
                "superseded_subscription_ids": superseded_ids,
            }

        if event_kind == "payment_failed":
            init_pay_id = self.payment_by_provider_id.get(subscription_id)
            if init_pay_id and self.payments[init_pay_id]["status"] == "pending":
                self.payments[init_pay_id]["status"] = "failed"
            elif provider_payment_id and provider_payment_id not in self.payment_by_provider_id:
                new_pay_id = str(uuid.uuid4())
                self.payments[new_pay_id] = {
                    "id": new_pay_id,
                    "user_id": user_id,
                    "amount_paise": plan.monthly_price_paise,
                    "currency": "INR",
                    "provider": provider,
                    "provider_payment_id": provider_payment_id,
                    "kind": "subscription",
                    "item_name": plan.name,
                    "status": "failed",
                    "created_at": now.isoformat(),
                }
                self.payment_by_provider_id[provider_payment_id] = new_pay_id

            next_status = "canceled" if sub["status"] == "pending" else "past_due"
            sub["status"] = next_status
            if w.provider_subscription_id == subscription_id:
                w.subscription_status = next_status
            return {"status": "processed", "subscription_id": subscription_id, "subscription_status": next_status}

        if event_kind == "canceled":
            init_pay_id = self.payment_by_provider_id.get(subscription_id)
            if init_pay_id and self.payments[init_pay_id]["status"] == "pending":
                self.payments[init_pay_id]["status"] = "failed"
            sub["status"] = "canceled"
            sub["cancel_at_period_end"] = True
            if w.provider_subscription_id == subscription_id:
                w.subscription_status = "canceled"
                w.cancel_at_period_end = True
            return {"status": "processed", "subscription_id": subscription_id, "subscription_status": "canceled"}

        if event_kind == "expired":
            sub["status"] = "expired"
            if w.provider_subscription_id == subscription_id or w.plan_name == plan.name:
                w.subscription_status = "expired"
                if w.subscription_balance > 0:
                    self.transactions.append(
                        {
                            "id": str(uuid.uuid4()),
                            "user_id": user_id,
                            "amount": -w.subscription_balance,
                            "credit_source": "subscription",
                            "transaction_type": "expire",
                            "reference_id": subscription_id,
                            "expires_at": now.isoformat(),
                            "created_at": now.isoformat(),
                        }
                    )
                    w.subscription_balance = 0
                    w.subscription_expires_at = now
            return {"status": "processed", "subscription_id": subscription_id, "subscription_status": "expired"}

        return {"status": "ignored", "subscription_id": subscription_id}

    def get_summary(self, user_id: str) -> BillingSummaryResponse:
        self.expire_credits()
        w = self.ensure_wallet(user_id)
        plan = PLAN_CATALOG.get(w.plan_name, PLAN_CATALOG["Free"])
        user_txs = [
            CreditTransactionItem(
                id=t["id"],
                amount=t["amount"],
                credit_source=t["credit_source"],
                transaction_type=t["transaction_type"],
                reference_id=t["reference_id"],
                expires_at=t["expires_at"],
                created_at=t["created_at"],
            )
            for t in reversed(self.transactions)
            if t["user_id"] == user_id
        ][:50]
        user_payments = [
            PaymentRecordItem(
                id=p["id"],
                amount_paise=p["amount_paise"],
                currency=p["currency"],
                provider=p["provider"],
                provider_payment_id=p["provider_payment_id"],
                kind=p["kind"],
                item_name=p["item_name"],
                status=p["status"],
                created_at=p["created_at"],
            )
            for p in reversed(list(self.payments.values()))
            if p["user_id"] == user_id
        ][:25]

        return BillingSummaryResponse(
            wallet=CreditWalletSummary(
                subscription_balance=w.subscription_balance,
                purchased_balance=w.purchased_balance,
                total_balance=w.subscription_balance + w.purchased_balance,
                subscription_expires_at=(
                    w.subscription_expires_at.isoformat() if w.subscription_expires_at else None
                ),
                purchased_expires_at=(
                    w.purchased_expires_at.isoformat() if w.purchased_expires_at else None
                ),
            ),
            subscription=ActiveSubscriptionSummary(
                plan_name=plan.name,
                status=w.subscription_status,
                provider=w.subscription_provider,
                provider_subscription_id=w.provider_subscription_id,
                cancel_at_period_end=w.cancel_at_period_end,
                monthly_price_paise=plan.monthly_price_paise,
                monthly_credits=plan.monthly_credits,
                max_file_size_mb=plan.max_file_size_mb,
                daily_job_limit=plan.daily_job_limit,
                api_access=plan.api_access,
                api_rate_limit_per_min=plan.api_rate_limit_per_min,
                current_period_end=(
                    w.subscription_expires_at.isoformat() if w.subscription_expires_at else None
                ),
            ),
            transactions=user_txs,
            payments=user_payments,
        )


class CreditService:
    """Routes credit & billing mutations to Supabase RPCs in production or InMemoryCreditStore in tests/local mode."""

    def __init__(self, settings: Settings, memory_store: InMemoryCreditStore) -> None:
        self.settings = settings
        self.memory = memory_store
        self.db = SupabaseServiceClient(settings)

    async def reserve_for_job(
        self,
        *,
        user_id: str,
        job_id: str,
        db_job_uuid: str | None,
        amount: int,
        file_mb: float,
        idempotency_key: str | None,
    ) -> int:
        if not self.db.configured:
            return self.memory.reserve_for_job(
                user_id=user_id,
                job_id=job_id,
                amount=amount,
                file_mb=file_mb,
                idempotency_key=idempotency_key,
            )

        summary = await self.db.get_billing_summary(user_id)
        plan = summary.subscription
        if file_mb > plan.max_file_size_mb:
            raise ApiServiceError(
                413,
                "FILE_TOO_LARGE_FOR_PLAN",
                f"File exceeds your {plan.plan_name} plan upload limit ({plan.max_file_size_mb} MB).",
            )

        if amount <= 0:
            return 0

        total_avail = summary.wallet.total_balance
        if plan.plan_name == "Free" and total_avail < amount:
            today_jobs = await self.db.count_user_jobs_today(user_id)
            if plan.daily_job_limit is not None and today_jobs >= plan.daily_job_limit:
                raise ApiServiceError(
                    429,
                    "DAILY_JOB_LIMIT_REACHED",
                    f"Free plan limit of {plan.daily_job_limit} server jobs/day reached. Upgrade or purchase a credit pack.",
                )
            if amount > 5:
                raise ApiServiceError(
                    402,
                    "INSUFFICIENT_CREDITS",
                    f"This dataset requires {amount} credits, exceeding the Free server trial.",
                )
            return 0

        if total_avail < amount:
            raise ApiServiceError(
                402,
                "INSUFFICIENT_CREDITS",
                f"Insufficient credits: {amount} required, {total_avail} available.",
            )

        if db_job_uuid:
            await self.db.rpc(
                "reserve_credits",
                {
                    "p_user_id": user_id,
                    "p_amount": amount,
                    "p_job_id": db_job_uuid,
                    "p_idempotency_key": idempotency_key or job_id,
                },
            )
        return amount

    async def commit_for_job(self, *, job_id: str, db_job_uuid: str | None) -> int:
        if not self.db.configured:
            return self.memory.commit_for_job(job_id)
        if db_job_uuid:
            res = await self.db.rpc("commit_credits", {"p_job_id": db_job_uuid})
            if isinstance(res, dict):
                return int(res.get("charged", 0))
        return 0

    async def refund_for_job(self, *, job_id: str, db_job_uuid: str | None) -> int:
        if not self.db.configured:
            return self.memory.refund_for_job(job_id)
        if db_job_uuid:
            res = await self.db.rpc("refund_credits", {"p_job_id": db_job_uuid})
            if isinstance(res, dict):
                return int(res.get("subscription_refunded", 0)) + int(
                    res.get("purchased_refunded", 0)
                )
        return 0
