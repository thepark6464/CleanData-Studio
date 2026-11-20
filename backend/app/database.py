from typing import Any
import httpx
from app.config import Settings


class SupabaseServiceClient:
    """Server-side Supabase PostgREST + RPC client using service_role key (never exposed to browser)."""

    def __init__(self, settings: Settings):
        self.base_url = settings.resolved_supabase_url
        self.service_key = settings.resolved_supabase_service_role_key

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.service_key)

    def _headers(self) -> dict[str, str]:
        return {
            "apikey": self.service_key,
            "Authorization": f"Bearer {self.service_key}",
            "Content-Type": "application/json",
        }

    async def rpc(self, function_name: str, params: dict[str, Any]) -> Any:
        if not self.configured:
            return None
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{self.base_url}/rest/v1/rpc/{function_name}",
                headers=self._headers(),
                json=params,
            )
            resp.raise_for_status()
            return resp.json() if resp.content else None

    async def update_profile_deletion(self, user_id: str, reason: str) -> None:
        if not self.configured:
            return
        import datetime as dt

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.patch(
                f"{self.base_url}/rest/v1/profiles?id=eq.{user_id}",
                headers=self._headers(),
                json={
                    "deletion_requested_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                    "deletion_reason": reason[:500],
                },
            )
            resp.raise_for_status()

    async def record_cleaning_job(
        self,
        *,
        user_id: str,
        status: str,
        input_name: str,
        input_format: str,
        output_format: str,
        input_path: str | None,
        output_path: str | None,
        operations: list[dict[str, Any]],
        rows_processed: int,
        idempotency_key: str | None,
        error_code: str | None = None,
        error_message: str | None = None,
        completed_at: str | None = None,
        input_expires_at: str | None = None,
        output_expires_at: str | None = None,
        quality_score: float | None = None,
        report_json: dict[str, Any] | None = None,
    ) -> str | None:
        if not self.configured:
            return None

        headers = {**self._headers(), "Prefer": "return=representation"}
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{self.base_url}/rest/v1/cleaning_jobs",
                headers=headers,
                json={
                    "user_id": user_id,
                    "status": status,
                    "input_name": input_name,
                    "input_format": input_format,
                    "output_format": output_format,
                    "input_path": input_path,
                    "output_path": output_path,
                    "operations": operations,
                    "rows_processed": rows_processed,
                    "idempotency_key": idempotency_key,
                    "error_code": error_code,
                    "error_message": error_message,
                    "completed_at": completed_at,
                    "input_expires_at": input_expires_at,
                    "output_expires_at": output_expires_at,
                },
            )
            resp.raise_for_status()
            rows = resp.json() if resp.content else []
            db_job_id = rows[0]["id"] if rows else None

            if db_job_id and report_json is not None:
                rep = await client.post(
                    f"{self.base_url}/rest/v1/cleaning_reports",
                    headers=self._headers(),
                    json={
                        "job_id": db_job_id,
                        "quality_score": quality_score,
                        "report_json": report_json,
                    },
                )
                rep.raise_for_status()

            return db_job_id

    async def update_cleaning_job_result(
        self,
        *,
        db_job_id: str,
        status: str,
        output_path: str | None = None,
        rows_processed: int = 0,
        error_code: str | None = None,
        error_message: str | None = None,
        completed_at: str | None = None,
        output_expires_at: str | None = None,
        quality_score: float | None = None,
        report_json: dict[str, Any] | None = None,
    ) -> None:
        if not self.configured:
            return
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.patch(
                f"{self.base_url}/rest/v1/cleaning_jobs?id=eq.{db_job_id}",
                headers=self._headers(),
                json={
                    "status": status,
                    "output_path": output_path,
                    "rows_processed": rows_processed,
                    "error_code": error_code,
                    "error_message": error_message,
                    "completed_at": completed_at,
                    "output_expires_at": output_expires_at,
                },
            )
            resp.raise_for_status()

            if report_json is not None:
                rep = await client.post(
                    f"{self.base_url}/rest/v1/cleaning_reports",
                    headers={**self._headers(), "Prefer": "resolution=merge-duplicates"},
                    json={
                        "job_id": db_job_id,
                        "quality_score": quality_score,
                        "report_json": report_json,
                    },
                )
                rep.raise_for_status()

    async def count_user_jobs_today(self, user_id: str) -> int:
        if not self.configured:
            return 0
        import datetime as dt

        start_of_day = dt.datetime.now(dt.timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        ).isoformat()
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{self.base_url}/rest/v1/cleaning_jobs",
                headers={**self._headers(), "Prefer": "count=exact"},
                params={
                    "select": "id",
                    "user_id": f"eq.{user_id}",
                    "created_at": f"gte.{start_of_day}",
                },
            )
            resp.raise_for_status()
            return len(resp.json() if resp.content else [])

    async def get_catalog_plan(self, name: str) -> dict[str, Any] | None:
        if not self.configured:
            return None
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{self.base_url}/rest/v1/plans",
                headers=self._headers(),
                params={"name": f"eq.{name}", "active": "eq.true", "limit": "1"},
            )
            resp.raise_for_status()
            rows = resp.json()
            return rows[0] if rows else None

    async def get_catalog_package(self, name: str) -> dict[str, Any] | None:
        if not self.configured:
            return None
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{self.base_url}/rest/v1/credit_packages",
                headers=self._headers(),
                params={"name": f"eq.{name}", "active": "eq.true", "limit": "1"},
            )
            resp.raise_for_status()
            rows = resp.json()
            return rows[0] if rows else None

    async def ensure_user_billing_profile(self, user_id: str, email: str | None = None) -> None:
        if not self.configured or not user_id:
            return
        headers = {**self._headers(), "Prefer": "resolution=ignore-duplicates"}
        profile_payload: dict[str, Any] = {"id": user_id}
        if email:
            profile_payload["email"] = email.strip()
        async with httpx.AsyncClient(timeout=15.0) as client:
            prof_resp = await client.post(
                f"{self.base_url}/rest/v1/profiles",
                headers=headers,
                params={"on_conflict": "id"},
                json=profile_payload,
            )
            prof_resp.raise_for_status()
            wallet_resp = await client.post(
                f"{self.base_url}/rest/v1/credit_wallets",
                headers=headers,
                params={"on_conflict": "user_id"},
                json={
                    "user_id": user_id,
                    "subscription_balance": 0,
                    "purchased_balance": 0,
                },
            )
            wallet_resp.raise_for_status()

    async def find_user_id_by_email(self, email: str | None) -> str | None:
        cleaned = (email or "").strip().lower()
        if not self.configured or not cleaned:
            return None
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{self.base_url}/rest/v1/profiles",
                headers=self._headers(),
                params={
                    "select": "id,email",
                    "email": f"ilike.{cleaned}",
                    "limit": "2",
                },
            )
            resp.raise_for_status()
            rows = resp.json()
            exact = [r for r in rows if str(r.get("email") or "").strip().lower() == cleaned]
            if len(exact) == 1:
                return str(exact[0]["id"])
            return None

    async def create_pending_payment(
        self,
        *,
        user_id: str,
        amount_paise: int,
        currency: str,
        provider: str,
        provider_payment_id: str,
        kind: str,
        package_id: str | None = None,
        plan_id: str | None = None,
        provider_order_id: str | None = None,
    ) -> str:
        headers = {**self._headers(), "Prefer": "resolution=merge-duplicates,return=representation"}
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{self.base_url}/rest/v1/payments",
                headers=headers,
                params={"on_conflict": "provider_payment_id"},
                json={
                    "user_id": user_id,
                    "amount": amount_paise,
                    "currency": currency,
                    "provider": provider,
                    "provider_payment_id": provider_payment_id,
                    "provider_order_id": provider_order_id or provider_payment_id,
                    "kind": kind,
                    "package_id": package_id,
                    "plan_id": plan_id,
                    "status": "pending",
                },
            )
            resp.raise_for_status()
            rows = resp.json()
            return str(rows[0]["id"])

    async def create_pending_subscription(
        self,
        *,
        user_id: str,
        plan_id: str,
        provider: str,
        provider_subscription_id: str,
        cf_subscription_id: str | None = None,
        provider_plan_id: str | None = None,
    ) -> str:
        headers = {**self._headers(), "Prefer": "resolution=merge-duplicates,return=representation"}
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{self.base_url}/rest/v1/subscriptions",
                headers=headers,
                params={"on_conflict": "provider_subscription_id"},
                json={
                    "user_id": user_id,
                    "plan_id": plan_id,
                    "status": "pending",
                    "provider": provider,
                    "provider_subscription_id": provider_subscription_id,
                    "cf_subscription_id": cf_subscription_id,
                    "provider_plan_id": provider_plan_id,
                },
            )
            resp.raise_for_status()
            rows = resp.json()
            return str(rows[0]["id"])

    async def get_payment_for_user(
        self, user_id: str, provider_payment_id: str
    ) -> dict[str, Any] | None:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{self.base_url}/rest/v1/payments",
                headers=self._headers(),
                params={
                    "select": "id,user_id,amount,currency,provider,provider_payment_id,provider_order_id,kind,package_id,plan_id,status,credit_packages(name),plans(name)",
                    "user_id": f"eq.{user_id}",
                    "or": f"(provider_payment_id.eq.{provider_payment_id},provider_order_id.eq.{provider_payment_id})",
                    "limit": "1",
                },
            )
            resp.raise_for_status()
            rows = resp.json()
            return rows[0] if rows else None

    async def get_order_owner_any_user(self, order_id: str) -> str | None:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{self.base_url}/rest/v1/payments",
                headers=self._headers(),
                params={
                    "select": "user_id",
                    "or": f"(provider_payment_id.eq.{order_id},provider_order_id.eq.{order_id})",
                    "limit": "1",
                },
            )
            resp.raise_for_status()
            rows = resp.json()
            return str(rows[0]["user_id"]) if rows and rows[0].get("user_id") else None

    async def get_subscription_for_user(
        self, user_id: str, subscription_id: str
    ) -> dict[str, Any] | None:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{self.base_url}/rest/v1/subscriptions",
                headers=self._headers(),
                params={
                    "select": "id,user_id,plan_id,status,provider,provider_subscription_id,plans(name,monthly_price,monthly_credits)",
                    "user_id": f"eq.{user_id}",
                    "provider_subscription_id": f"eq.{subscription_id}",
                    "limit": "1",
                },
            )
            resp.raise_for_status()
            rows = resp.json()
            return rows[0] if rows else None

    async def get_subscription_owner_any_user(self, subscription_id: str) -> str | None:
        async with httpx.AsyncClient(timeout=15.0) as client:
            sub_resp = await client.get(
                f"{self.base_url}/rest/v1/subscriptions",
                headers=self._headers(),
                params={
                    "select": "user_id",
                    "provider_subscription_id": f"eq.{subscription_id}",
                    "limit": "1",
                },
            )
            sub_resp.raise_for_status()
            sub_rows = sub_resp.json()
            if sub_rows and sub_rows[0].get("user_id"):
                return str(sub_rows[0]["user_id"])

            pay_resp = await client.get(
                f"{self.base_url}/rest/v1/payments",
                headers=self._headers(),
                params={
                    "select": "user_id",
                    "or": f"(provider_payment_id.eq.{subscription_id},provider_order_id.eq.{subscription_id})",
                    "limit": "1",
                },
            )
            pay_resp.raise_for_status()
            pay_rows = pay_resp.json()
            if pay_rows and pay_rows[0].get("user_id"):
                return str(pay_rows[0]["user_id"])
            return None

    async def list_other_active_cashfree_subscriptions(
        self, user_id: str, exclude_subscription_id: str
    ) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{self.base_url}/rest/v1/subscriptions",
                headers=self._headers(),
                params={
                    "select": "id,provider,provider_subscription_id,status",
                    "user_id": f"eq.{user_id}",
                    "provider": "eq.cashfree",
                    "status": "in.(active,past_due)",
                    "provider_subscription_id": f"neq.{exclude_subscription_id}",
                },
            )
            resp.raise_for_status()
            return [r for r in resp.json() if r.get("provider_subscription_id")]

    async def get_latest_active_cashfree_subscription(
        self, user_id: str
    ) -> dict[str, Any] | None:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{self.base_url}/rest/v1/subscriptions",
                headers=self._headers(),
                params={
                    "select": "id,provider,provider_subscription_id,status,plans(name)",
                    "user_id": f"eq.{user_id}",
                    "provider": "eq.cashfree",
                    "status": "in.(active,past_due)",
                    "order": "created_at.desc",
                    "limit": "1",
                },
            )
            resp.raise_for_status()
            rows = resp.json()
            return rows[0] if rows else None

    async def get_billing_summary(self, user_id: str):
        from app.models import (
            ActiveSubscriptionSummary,
            BillingSummaryResponse,
            CreditTransactionItem,
            CreditWalletSummary,
            PaymentRecordItem,
        )

        async with httpx.AsyncClient(timeout=15.0) as client:
            wallet_resp = await client.get(
                f"{self.base_url}/rest/v1/credit_wallets",
                headers=self._headers(),
                params={"user_id": f"eq.{user_id}", "limit": "1"},
            )
            wallet_resp.raise_for_status()
            wallet_rows = wallet_resp.json()
            w = wallet_rows[0] if isinstance(wallet_rows, list) and wallet_rows and isinstance(wallet_rows[0], dict) else {}

            sub_resp = await client.get(
                f"{self.base_url}/rest/v1/subscriptions",
                headers=self._headers(),
                params={
                    "select": "status,provider,provider_subscription_id,cancel_at_period_end,current_period_end,plans(name,monthly_price,monthly_credits,max_file_size_mb,daily_job_limit,api_access,api_rate_limit_per_min)",
                    "user_id": f"eq.{user_id}",
                    "status": "in.(active,past_due,canceled,expired)",
                    "order": "created_at.desc",
                    "limit": "5",
                },
            )
            sub_resp.raise_for_status()
            sub_rows_raw = sub_resp.json()
            sub_rows = [r for r in sub_rows_raw if isinstance(r, dict)] if isinstance(sub_rows_raw, list) else []
            # Prefer active paid/system row; fall back to latest past_due/canceled/expired if no active row exists
            sub_row = next((r for r in sub_rows if r.get("status") == "active"), None) or (
                sub_rows[0] if sub_rows else {}
            )
            plan_rel = sub_row.get("plans") or {}
            if isinstance(plan_rel, list):
                plan_rel = plan_rel[0] if plan_rel and isinstance(plan_rel[0], dict) else {}
            if not isinstance(plan_rel, dict):
                plan_rel = {}

            tx_resp = await client.get(
                f"{self.base_url}/rest/v1/credit_transactions",
                headers=self._headers(),
                params={
                    "user_id": f"eq.{user_id}",
                    "order": "created_at.desc",
                    "limit": "50",
                },
            )
            tx_resp.raise_for_status()
            tx_rows_raw = tx_resp.json()
            tx_rows = [r for r in tx_rows_raw if isinstance(r, dict)] if isinstance(tx_rows_raw, list) else []

            pay_resp = await client.get(
                f"{self.base_url}/rest/v1/payments",
                headers=self._headers(),
                params={
                    "select": "id,amount,currency,provider,provider_payment_id,kind,status,created_at,credit_packages(name),plans(name)",
                    "user_id": f"eq.{user_id}",
                    "order": "created_at.desc",
                    "limit": "25",
                },
            )
            pay_resp.raise_for_status()
            pay_rows_raw = pay_resp.json()
            pay_rows = [r for r in pay_rows_raw if isinstance(r, dict)] if isinstance(pay_rows_raw, list) else []

        sub_bal = int(w.get("subscription_balance") or 0)
        pur_bal = int(w.get("purchased_balance") or 0)

        def _first_dict(val: Any) -> dict[str, Any]:
            if isinstance(val, dict):
                return val
            if isinstance(val, list) and val and isinstance(val[0], dict):
                return val[0]
            return {}

        def _extract_item_name(pay_row: dict[str, Any]) -> str | None:
            pkg = _first_dict(pay_row.get("credit_packages"))
            if pkg.get("name"):
                return str(pkg["name"])
            pln = _first_dict(pay_row.get("plans"))
            if pln.get("name"):
                return str(pln["name"])
            return None

        def _normalize_credit_source(raw: Any) -> str:
            val = str(raw or "").strip().lower()
            return val if val in {"subscription", "purchased"} else "purchased"

        def _normalize_tx_type(raw: Any) -> str:
            val = str(raw or "").strip().lower()
            allowed = {
                "subscription_grant",
                "purchase",
                "reserve",
                "commit",
                "refund",
                "expire",
                "adjustment",
            }
            return val if val in allowed else "adjustment"

        def _normalize_payment_kind(pay_row: dict[str, Any]) -> str | None:
            val = str(pay_row.get("kind") or "").strip().lower()
            if val in {"credit_pack", "subscription"}:
                return val
            if _first_dict(pay_row.get("credit_packages")).get("name"):
                return "credit_pack"
            if _first_dict(pay_row.get("plans")).get("name"):
                return "subscription"
            return None

        def _normalize_payment_status(raw: Any) -> str:
            val = str(raw or "").strip().lower()
            if val in {"pending", "paid", "failed", "refunded"}:
                return val
            if val in {"captured", "succeeded", "success", "completed"}:
                return "paid"
            if val in {"cancelled", "canceled", "error", "expired"}:
                return "failed"
            return "pending"

        raw_daily_limit = plan_rel.get("daily_job_limit")

        return BillingSummaryResponse(
            wallet=CreditWalletSummary(
                subscription_balance=sub_bal,
                purchased_balance=pur_bal,
                total_balance=sub_bal + pur_bal,
                subscription_expires_at=w.get("subscription_expires_at"),
                purchased_expires_at=w.get("purchased_expires_at"),
            ),
            subscription=ActiveSubscriptionSummary(
                plan_name=str(plan_rel.get("name") or "Free"),
                status=str(sub_row.get("status") or "active"),
                provider=str(sub_row.get("provider") or "system"),
                provider_subscription_id=sub_row.get("provider_subscription_id"),
                cancel_at_period_end=bool(sub_row.get("cancel_at_period_end", False)),
                monthly_price_paise=int(plan_rel.get("monthly_price") or 0),
                monthly_credits=int(plan_rel.get("monthly_credits") or 0),
                max_file_size_mb=int(plan_rel.get("max_file_size_mb") or 5),
                daily_job_limit=int(raw_daily_limit) if raw_daily_limit is not None else None,
                api_access=bool(plan_rel.get("api_access", False)),
                api_rate_limit_per_min=int(plan_rel.get("api_rate_limit_per_min") or 0),
                current_period_end=sub_row.get("current_period_end"),
            ),
            transactions=[
                CreditTransactionItem(
                    id=str(t.get("id") or ""),
                    amount=int(t.get("amount") or 0),
                    credit_source=_normalize_credit_source(t.get("credit_source")),  # type: ignore[arg-type]
                    transaction_type=_normalize_tx_type(t.get("transaction_type")),  # type: ignore[arg-type]
                    reference_id=t.get("reference_id"),
                    expires_at=t.get("expires_at"),
                    created_at=str(t.get("created_at") or ""),
                )
                for t in tx_rows
            ],
            payments=[
                PaymentRecordItem(
                    id=str(p.get("id") or ""),
                    amount_paise=int(p.get("amount") or 0),
                    currency=str(p.get("currency") or "INR"),
                    provider=str(p.get("provider") or "cashfree"),
                    provider_payment_id=p.get("provider_payment_id"),
                    kind=_normalize_payment_kind(p),  # type: ignore[arg-type]
                    item_name=_extract_item_name(p),
                    status=_normalize_payment_status(p.get("status")),  # type: ignore[arg-type]
                    created_at=str(p.get("created_at") or ""),
                )
                for p in pay_rows
            ],
        )

    async def create_api_key(
        self, *, user_id: str, name: str, key_hash: str, prefix: str
    ) -> dict[str, Any]:
        headers = {**self._headers(), "Prefer": "return=representation"}
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{self.base_url}/rest/v1/api_keys",
                headers=headers,
                json={
                    "user_id": user_id,
                    "name": name,
                    "key_hash": key_hash,
                    "prefix": prefix,
                },
            )
            resp.raise_for_status()
            row = resp.json()[0]
            row.pop("key_hash", None)
            return row

    async def list_api_keys(self, user_id: str) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{self.base_url}/rest/v1/api_keys",
                headers=self._headers(),
                params={
                    "select": "id,user_id,name,prefix,last_used_at,revoked_at,created_at",
                    "user_id": f"eq.{user_id}",
                    "order": "created_at.desc",
                },
            )
            resp.raise_for_status()
            return list(resp.json())

    async def revoke_api_key(self, user_id: str, key_id: str) -> bool:
        import datetime as dt

        headers = {**self._headers(), "Prefer": "return=representation"}
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.patch(
                f"{self.base_url}/rest/v1/api_keys",
                headers=headers,
                params={"id": f"eq.{key_id}", "user_id": f"eq.{user_id}"},
                json={"revoked_at": dt.datetime.now(dt.timezone.utc).isoformat()},
            )
            resp.raise_for_status()
            return len(resp.json()) > 0

    async def lookup_api_key_by_hash(self, key_hash: str) -> dict[str, Any] | None:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{self.base_url}/rest/v1/api_keys",
                headers=self._headers(),
                params={
                    "select": "id,user_id,prefix,revoked_at",
                    "key_hash": f"eq.{key_hash}",
                    "limit": "1",
                },
            )
            resp.raise_for_status()
            rows = resp.json()
            return rows[0] if rows else None

    async def touch_api_key_last_used(self, key_id: str) -> None:
        import datetime as dt

        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.patch(
                f"{self.base_url}/rest/v1/api_keys?id=eq.{key_id}",
                headers=self._headers(),
                json={"last_used_at": dt.datetime.now(dt.timezone.utc).isoformat()},
            )

    async def record_api_usage(
        self,
        *,
        user_id: str,
        api_key_id: str | None,
        endpoint: str,
        credits_used: int,
        status_code: int,
    ) -> None:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"{self.base_url}/rest/v1/api_usage",
                headers=self._headers(),
                json={
                    "user_id": user_id,
                    "api_key_id": api_key_id,
                    "endpoint": endpoint,
                    "credits_used": credits_used,
                    "status_code": status_code,
                },
            )

    async def list_api_usage(self, user_id: str, limit: int = 50) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{self.base_url}/rest/v1/api_usage",
                headers=self._headers(),
                params={
                    "select": "id,api_key_id,endpoint,credits_used,status_code,created_at",
                    "user_id": f"eq.{user_id}",
                    "order": "created_at.desc",
                    "limit": str(limit),
                },
            )
            resp.raise_for_status()
            return list(resp.json())



