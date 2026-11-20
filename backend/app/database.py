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
    ) -> str:
        headers = {**self._headers(), "Prefer": "return=representation"}
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{self.base_url}/rest/v1/payments",
                headers=headers,
                json={
                    "user_id": user_id,
                    "amount": amount_paise,
                    "currency": currency,
                    "provider": provider,
                    "provider_payment_id": provider_payment_id,
                    "kind": kind,
                    "package_id": package_id,
                    "plan_id": plan_id,
                    "status": "pending",
                },
            )
            resp.raise_for_status()
            rows = resp.json()
            return str(rows[0]["id"])

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
            w = wallet_rows[0] if wallet_rows else {}

            sub_resp = await client.get(
                f"{self.base_url}/rest/v1/subscriptions",
                headers=self._headers(),
                params={
                    "select": "status,current_period_end,plans(name,monthly_price,monthly_credits,max_file_size_mb,daily_job_limit,api_access,api_rate_limit_per_min)",
                    "user_id": f"eq.{user_id}",
                    "status": "eq.active",
                    "order": "created_at.desc",
                    "limit": "1",
                },
            )
            sub_resp.raise_for_status()
            sub_rows = sub_resp.json()
            sub_row = sub_rows[0] if sub_rows else {}
            plan_rel = sub_row.get("plans") or {}
            if isinstance(plan_rel, list):
                plan_rel = plan_rel[0] if plan_rel else {}

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
            tx_rows = tx_resp.json()

            pay_resp = await client.get(
                f"{self.base_url}/rest/v1/payments",
                headers=self._headers(),
                params={
                    "user_id": f"eq.{user_id}",
                    "order": "created_at.desc",
                    "limit": "25",
                },
            )
            pay_resp.raise_for_status()
            pay_rows = pay_resp.json()

        sub_bal = int(w.get("subscription_balance", 0))
        pur_bal = int(w.get("purchased_balance", 0))

        return BillingSummaryResponse(
            wallet=CreditWalletSummary(
                subscription_balance=sub_bal,
                purchased_balance=pur_bal,
                total_balance=sub_bal + pur_bal,
                subscription_expires_at=w.get("subscription_expires_at"),
                purchased_expires_at=w.get("purchased_expires_at"),
            ),
            subscription=ActiveSubscriptionSummary(
                plan_name=str(plan_rel.get("name", "Free")),
                status=str(sub_row.get("status", "active")),
                monthly_price_paise=int(plan_rel.get("monthly_price", 0)),
                monthly_credits=int(plan_rel.get("monthly_credits", 0)),
                max_file_size_mb=int(plan_rel.get("max_file_size_mb", 5)),
                daily_job_limit=plan_rel.get("daily_job_limit"),
                api_access=bool(plan_rel.get("api_access", False)),
                api_rate_limit_per_min=int(plan_rel.get("api_rate_limit_per_min", 0)),
                current_period_end=sub_row.get("current_period_end"),
            ),
            transactions=[
                CreditTransactionItem(
                    id=str(t["id"]),
                    amount=int(t["amount"]),
                    credit_source=t["credit_source"],
                    transaction_type=t["transaction_type"],
                    reference_id=t.get("reference_id"),
                    expires_at=t.get("expires_at"),
                    created_at=str(t["created_at"]),
                )
                for t in tx_rows
            ],
            payments=[
                PaymentRecordItem(
                    id=str(p["id"]),
                    amount_paise=int(p["amount"]),
                    currency=str(p.get("currency", "INR")),
                    provider=str(p.get("provider", "razorpay")),
                    provider_payment_id=p.get("provider_payment_id"),
                    kind=p["kind"],
                    item_name=None,
                    status=p["status"],
                    created_at=str(p["created_at"]),
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



