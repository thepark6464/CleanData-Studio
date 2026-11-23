import datetime as dt
import re
from typing import Any
import httpx
from app.config import Settings

_MISSING_MIGRATION_CODES = {"PGRST205", "PGRST202", "PGRST204", "42P01", "42703", "42883", "3F000"}
_URL_IN_ERR_RE = re.compile(r"https?://\S+", re.I)


def _safe_int(value: Any, default: int = 0) -> int:
    if value is None or isinstance(value, bool):
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        try:
            return int(float(str(value).strip()))
        except (TypeError, ValueError):
            return default


def _parse_iso_utc(value: Any) -> dt.datetime | None:
    if not value or not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None
    try:
        parsed = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(dt.timezone.utc)
    except ValueError:
        return None


def _sanitize_db_error_message(raw: str) -> str:
    cleaned = _URL_IN_ERR_RE.sub("[redacted-url]", raw or "").strip()
    return cleaned[:240] if cleaned else "Database request failed."


def _extract_postgrest_error(resp: Any) -> tuple[str | None, str]:
    db_code: str | None = None
    msg = ""
    try:
        body = resp.json()
        if isinstance(body, dict):
            raw_code = body.get("code")
            if raw_code is not None and str(raw_code).strip():
                db_code = str(raw_code).strip()
            parts = [
                str(body.get(k)).strip()
                for k in ("message", "details", "hint")
                if body.get(k)
            ]
            msg = " — ".join(parts)
    except Exception:
        msg = str(getattr(resp, "text", "") or "").strip()
    return db_code, _sanitize_db_error_message(msg)


def _is_missing_migration_error(
    http_status: int | None, db_error_code: str | None, error_message: str
) -> bool:
    if db_error_code and db_error_code.upper() in _MISSING_MIGRATION_CODES:
        return True
    lower_msg = (error_message or "").lower()
    if (
        "could not find the table" in lower_msg
        or "could not find the function" in lower_msg
        or "schema cache" in lower_msg
        or ("relation" in lower_msg and "does not exist" in lower_msg)
        or ("function" in lower_msg and "does not exist" in lower_msg)
        or ("column" in lower_msg and "does not exist" in lower_msg)
    ):
        return True
    return http_status == 404 and not db_error_code


class SupabaseOperationError(Exception):
    """Structured Supabase PostgREST / RPC failure with sanitized diagnostics."""

    def __init__(
        self,
        *,
        operation: str,
        http_status: int | None = None,
        db_error_code: str | None = None,
        error_message: str = "Supabase database operation failed.",
    ) -> None:
        self.operation = operation
        self.http_status = http_status
        self.db_error_code = db_error_code
        self.error_message = _sanitize_db_error_message(error_message)
        self.is_missing_migration = _is_missing_migration_error(
            http_status, db_error_code, self.error_message
        )
        self.is_auth_error = http_status in {401, 403}
        super().__init__(f"{operation}: {self.error_message}")


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

    def _parse_response_json(self, operation: str, resp: Any, *, allow_empty: bool = False) -> Any:
        try:
            status_code = getattr(resp, "status_code", None)
            if isinstance(status_code, int) and status_code >= 400:
                db_code, msg = _extract_postgrest_error(resp)
                raise SupabaseOperationError(
                    operation=operation,
                    http_status=status_code,
                    db_error_code=db_code,
                    error_message=msg or f"Supabase returned HTTP {status_code}.",
                )
            resp.raise_for_status()
        except SupabaseOperationError:
            raise
        except httpx.HTTPStatusError as exc:
            err_resp = exc.response
            db_code, msg = _extract_postgrest_error(err_resp)
            raise SupabaseOperationError(
                operation=operation,
                http_status=err_resp.status_code,
                db_error_code=db_code,
                error_message=msg or f"Supabase returned HTTP {err_resp.status_code}.",
            ) from exc
        except httpx.HTTPError as exc:
            raise SupabaseOperationError(
                operation=operation,
                http_status=None,
                db_error_code=type(exc).__name__,
                error_message=str(exc) or "Supabase network error.",
            ) from exc

        if allow_empty and getattr(resp, "content", b"x") == b"":
            return None
        try:
            return resp.json()
        except (ValueError, TypeError) as exc:
            raise SupabaseOperationError(
                operation=operation,
                http_status=getattr(resp, "status_code", None),
                db_error_code="INVALID_DB_JSON",
                error_message=f"Invalid JSON payload returned by Supabase ({type(exc).__name__}).",
            ) from exc

    async def rpc(self, function_name: str, params: dict[str, Any]) -> Any:
        if not self.configured:
            return None
        operation = f"rpc_{function_name}"
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    f"{self.base_url}/rest/v1/rpc/{function_name}",
                    headers=self._headers(),
                    json=params,
                )
        except httpx.HTTPError as exc:
            raise SupabaseOperationError(
                operation=operation,
                http_status=None,
                db_error_code=type(exc).__name__,
                error_message=str(exc) or "Unable to reach Supabase RPC endpoint.",
            ) from exc
        return self._parse_response_json(operation, resp, allow_empty=True)

    async def update_profile_deletion(self, user_id: str, reason: str) -> None:
        if not self.configured:
            return

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
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(
                    f"{self.base_url}/rest/v1/plans",
                    headers=self._headers(),
                    params={"name": f"eq.{name}", "active": "eq.true", "limit": "1"},
                )
        except httpx.HTTPError as exc:
            raise SupabaseOperationError(
                operation="select_plans",
                db_error_code=type(exc).__name__,
                error_message=str(exc) or "Unable to query plans table.",
            ) from exc
        rows = self._parse_response_json("select_plans", resp)
        return rows[0] if isinstance(rows, list) and rows else None

    async def get_catalog_package(self, name: str) -> dict[str, Any] | None:
        if not self.configured:
            return None
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(
                    f"{self.base_url}/rest/v1/credit_packages",
                    headers=self._headers(),
                    params={"name": f"eq.{name}", "active": "eq.true", "limit": "1"},
                )
        except httpx.HTTPError as exc:
            raise SupabaseOperationError(
                operation="select_credit_packages",
                db_error_code=type(exc).__name__,
                error_message=str(exc) or "Unable to query credit_packages table.",
            ) from exc
        rows = self._parse_response_json("select_credit_packages", resp)
        return rows[0] if isinstance(rows, list) and rows else None

    async def ensure_user_billing_profile(self, user_id: str, email: str | None = None) -> None:
        if not self.configured or not user_id:
            return
        headers = {**self._headers(), "Prefer": "resolution=ignore-duplicates"}
        profile_payload: dict[str, Any] = {"id": user_id}
        if email:
            profile_payload["email"] = email.strip()
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                prof_resp = await client.post(
                    f"{self.base_url}/rest/v1/profiles",
                    headers=headers,
                    params={"on_conflict": "id"},
                    json=profile_payload,
                )
                self._parse_response_json("upsert_profiles", prof_resp, allow_empty=True)
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
                self._parse_response_json("upsert_credit_wallets", wallet_resp, allow_empty=True)
        except SupabaseOperationError:
            raise
        except httpx.HTTPError as exc:
            raise SupabaseOperationError(
                operation="ensure_user_billing_profile",
                db_error_code=type(exc).__name__,
                error_message=str(exc) or "Unable to ensure user profile and wallet.",
            ) from exc

    async def find_user_id_by_email(self, email: str | None) -> str | None:
        cleaned = (email or "").strip().lower()
        if not self.configured or not cleaned:
            return None
        try:
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
        except httpx.HTTPError as exc:
            raise SupabaseOperationError(
                operation="select_profiles_by_email",
                db_error_code=type(exc).__name__,
                error_message=str(exc) or "Unable to look up profile by email.",
            ) from exc
        rows = self._parse_response_json("select_profiles_by_email", resp)
        if not isinstance(rows, list):
            return None
        exact = [r for r in rows if isinstance(r, dict) and str(r.get("email") or "").strip().lower() == cleaned]
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
        try:
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
        except httpx.HTTPError as exc:
            raise SupabaseOperationError(
                operation="upsert_payments",
                db_error_code=type(exc).__name__,
                error_message=str(exc) or "Unable to persist payment record.",
            ) from exc
        rows = self._parse_response_json("upsert_payments", resp)
        if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
            raise SupabaseOperationError(
                operation="upsert_payments",
                db_error_code="EMPTY_UPSERT_RESULT",
                error_message="Supabase did not return created payment row.",
            )
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
        try:
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
        except httpx.HTTPError as exc:
            raise SupabaseOperationError(
                operation="upsert_subscriptions",
                db_error_code=type(exc).__name__,
                error_message=str(exc) or "Unable to persist subscription record.",
            ) from exc
        rows = self._parse_response_json("upsert_subscriptions", resp)
        if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
            raise SupabaseOperationError(
                operation="upsert_subscriptions",
                db_error_code="EMPTY_UPSERT_RESULT",
                error_message="Supabase did not return created subscription row.",
            )
        return str(rows[0]["id"])

    async def get_payment_for_user(
        self, user_id: str, provider_payment_id: str
    ) -> dict[str, Any] | None:
        try:
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
        except httpx.HTTPError as exc:
            raise SupabaseOperationError(
                operation="select_payments_for_user",
                db_error_code=type(exc).__name__,
                error_message=str(exc) or "Unable to fetch payment record.",
            ) from exc
        rows = self._parse_response_json("select_payments_for_user", resp)
        return rows[0] if isinstance(rows, list) and rows else None

    async def get_order_owner_any_user(self, order_id: str) -> str | None:
        try:
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
        except httpx.HTTPError as exc:
            raise SupabaseOperationError(
                operation="select_payment_owner",
                db_error_code=type(exc).__name__,
                error_message=str(exc) or "Unable to look up payment owner.",
            ) from exc
        rows = self._parse_response_json("select_payment_owner", resp)
        return str(rows[0]["user_id"]) if isinstance(rows, list) and rows and rows[0].get("user_id") else None

    async def get_subscription_for_user(
        self, user_id: str, subscription_id: str
    ) -> dict[str, Any] | None:
        try:
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
        except httpx.HTTPError as exc:
            raise SupabaseOperationError(
                operation="select_subscription_for_user",
                db_error_code=type(exc).__name__,
                error_message=str(exc) or "Unable to fetch subscription record.",
            ) from exc
        rows = self._parse_response_json("select_subscription_for_user", resp)
        return rows[0] if isinstance(rows, list) and rows else None

    async def get_subscription_owner_any_user(self, subscription_id: str) -> str | None:
        try:
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
                sub_rows = self._parse_response_json("select_subscription_owner", sub_resp)
                if isinstance(sub_rows, list) and sub_rows and sub_rows[0].get("user_id"):
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
                pay_rows = self._parse_response_json("select_subscription_payment_owner", pay_resp)
                if isinstance(pay_rows, list) and pay_rows and pay_rows[0].get("user_id"):
                    return str(pay_rows[0]["user_id"])
                return None
        except SupabaseOperationError:
            raise
        except httpx.HTTPError as exc:
            raise SupabaseOperationError(
                operation="select_subscription_owner",
                db_error_code=type(exc).__name__,
                error_message=str(exc) or "Unable to look up subscription owner.",
            ) from exc

    async def list_other_active_cashfree_subscriptions(
        self, user_id: str, exclude_subscription_id: str
    ) -> list[dict[str, Any]]:
        try:
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
        except httpx.HTTPError as exc:
            raise SupabaseOperationError(
                operation="select_other_subscriptions",
                db_error_code=type(exc).__name__,
                error_message=str(exc) or "Unable to list prior active subscriptions.",
            ) from exc
        rows = self._parse_response_json("select_other_subscriptions", resp)
        return [r for r in rows if isinstance(r, dict) and r.get("provider_subscription_id")] if isinstance(rows, list) else []

    async def get_latest_active_cashfree_subscription(
        self, user_id: str
    ) -> dict[str, Any] | None:
        try:
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
        except httpx.HTTPError as exc:
            raise SupabaseOperationError(
                operation="select_latest_active_subscription",
                db_error_code=type(exc).__name__,
                error_message=str(exc) or "Unable to query active subscription.",
            ) from exc
        rows = self._parse_response_json("select_latest_active_subscription", resp)
        return rows[0] if isinstance(rows, list) and rows else None

    async def get_billing_summary(self, user_id: str):
        from app.models import (
            ActiveSubscriptionSummary,
            BillingSummaryResponse,
            CreditTransactionItem,
            CreditWalletSummary,
            PaymentRecordItem,
        )

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                wallet_resp = await client.get(
                    f"{self.base_url}/rest/v1/credit_wallets",
                    headers=self._headers(),
                    params={"user_id": f"eq.{user_id}", "limit": "1"},
                )
                wallet_rows = self._parse_response_json("select_credit_wallets", wallet_resp)
                w = (
                    wallet_rows[0]
                    if isinstance(wallet_rows, list) and wallet_rows and isinstance(wallet_rows[0], dict)
                    else {}
                )

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
                sub_rows_raw = self._parse_response_json("select_subscriptions", sub_resp)
                sub_rows = (
                    [r for r in sub_rows_raw if isinstance(r, dict)]
                    if isinstance(sub_rows_raw, list)
                    else []
                )
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
                tx_rows_raw = self._parse_response_json("select_credit_transactions", tx_resp)
                tx_rows = (
                    [r for r in tx_rows_raw if isinstance(r, dict)]
                    if isinstance(tx_rows_raw, list)
                    else []
                )

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
                pay_rows_raw = self._parse_response_json("select_payments", pay_resp)
                pay_rows = (
                    [r for r in pay_rows_raw if isinstance(r, dict)]
                    if isinstance(pay_rows_raw, list)
                    else []
                )
        except SupabaseOperationError:
            raise
        except httpx.HTTPError as exc:
            raise SupabaseOperationError(
                operation="get_billing_summary",
                db_error_code=type(exc).__name__,
                error_message=str(exc) or "Unable to reach Supabase billing tables.",
            ) from exc

        sub_bal = max(0, _safe_int(w.get("subscription_balance"), 0))
        pur_bal = max(0, _safe_int(w.get("purchased_balance"), 0))
        now_utc = dt.datetime.now(dt.timezone.utc)
        sub_exp_dt = _parse_iso_utc(w.get("subscription_expires_at"))
        pur_exp_dt = _parse_iso_utc(w.get("purchased_expires_at"))
        sub_expired = sub_bal > 0 and sub_exp_dt is not None and sub_exp_dt <= now_utc
        pur_expired = pur_bal > 0 and pur_exp_dt is not None and pur_exp_dt <= now_utc

        if sub_expired or pur_expired:
            try:
                await self.rpc("expire_credits", {})
            except Exception:
                pass
            if sub_expired:
                sub_bal = 0
            if pur_expired:
                pur_bal = 0

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
        daily_limit: int | None = None
        if raw_daily_limit is not None:
            parsed_limit = _safe_int(raw_daily_limit, -1)
            daily_limit = parsed_limit if parsed_limit >= 0 else None

        has_sub_row = bool(sub_row)
        resolved_plan_name = str(plan_rel.get("name") or "Free")
        resolved_sub_status = (
            str(sub_row.get("status") or "free")
            if has_sub_row
            else "free"
        )

        return BillingSummaryResponse(
            wallet=CreditWalletSummary(
                subscription_balance=sub_bal,
                purchased_balance=pur_bal,
                total_balance=sub_bal + pur_bal,
                subscription_expires_at=w.get("subscription_expires_at"),
                purchased_expires_at=w.get("purchased_expires_at"),
            ),
            subscription=ActiveSubscriptionSummary(
                plan_name=resolved_plan_name,
                status=resolved_sub_status,
                provider=str(sub_row.get("provider") or "system"),
                provider_subscription_id=sub_row.get("provider_subscription_id"),
                cancel_at_period_end=bool(sub_row.get("cancel_at_period_end", False)),
                monthly_price_paise=_safe_int(plan_rel.get("monthly_price"), 0),
                monthly_credits=_safe_int(plan_rel.get("monthly_credits"), 0),
                max_file_size_mb=_safe_int(plan_rel.get("max_file_size_mb"), 5),
                daily_job_limit=daily_limit,
                api_access=bool(plan_rel.get("api_access", False)),
                api_rate_limit_per_min=_safe_int(plan_rel.get("api_rate_limit_per_min"), 0),
                current_period_end=sub_row.get("current_period_end"),
            ),
            transactions=[
                CreditTransactionItem(
                    id=str(t.get("id") or ""),
                    amount=_safe_int(t.get("amount"), 0),
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
                    amount_paise=_safe_int(p.get("amount"), 0),
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
        try:
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
        except httpx.HTTPError as exc:
            raise SupabaseOperationError(
                operation="insert_api_keys",
                db_error_code=type(exc).__name__,
                error_message=str(exc) or "Unable to create API key.",
            ) from exc
        rows = self._parse_response_json("insert_api_keys", resp)
        row = rows[0] if isinstance(rows, list) and rows else {}
        row.pop("key_hash", None)
        return row

    async def list_api_keys(self, user_id: str) -> list[dict[str, Any]]:
        try:
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
        except httpx.HTTPError as exc:
            raise SupabaseOperationError(
                operation="select_api_keys",
                db_error_code=type(exc).__name__,
                error_message=str(exc) or "Unable to fetch API keys.",
            ) from exc
        rows = self._parse_response_json("select_api_keys", resp)
        return list(rows) if isinstance(rows, list) else []

    async def revoke_api_key(self, user_id: str, key_id: str) -> bool:
        headers = {**self._headers(), "Prefer": "return=representation"}
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.patch(
                    f"{self.base_url}/rest/v1/api_keys",
                    headers=headers,
                    params={"id": f"eq.{key_id}", "user_id": f"eq.{user_id}"},
                    json={"revoked_at": dt.datetime.now(dt.timezone.utc).isoformat()},
                )
        except httpx.HTTPError as exc:
            raise SupabaseOperationError(
                operation="revoke_api_keys",
                db_error_code=type(exc).__name__,
                error_message=str(exc) or "Unable to revoke API key.",
            ) from exc
        rows = self._parse_response_json("revoke_api_keys", resp)
        return isinstance(rows, list) and len(rows) > 0

    async def lookup_api_key_by_hash(self, key_hash: str) -> dict[str, Any] | None:
        try:
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
        except httpx.HTTPError as exc:
            raise SupabaseOperationError(
                operation="lookup_api_key",
                db_error_code=type(exc).__name__,
                error_message=str(exc) or "Unable to look up API key.",
            ) from exc
        rows = self._parse_response_json("lookup_api_key", resp)
        return rows[0] if isinstance(rows, list) and rows else None

    async def touch_api_key_last_used(self, key_id: str) -> None:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.patch(
                    f"{self.base_url}/rest/v1/api_keys?id=eq.{key_id}",
                    headers=self._headers(),
                    json={"last_used_at": dt.datetime.now(dt.timezone.utc).isoformat()},
                )
        except httpx.HTTPError:
            pass

    async def record_api_usage(
        self,
        *,
        user_id: str,
        api_key_id: str | None,
        endpoint: str,
        credits_used: int,
        status_code: int,
    ) -> None:
        try:
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
        except httpx.HTTPError:
            pass

    async def list_api_usage(self, user_id: str, limit: int = 50) -> list[dict[str, Any]]:
        try:
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
        except httpx.HTTPError as exc:
            raise SupabaseOperationError(
                operation="select_api_usage",
                db_error_code=type(exc).__name__,
                error_message=str(exc) or "Unable to fetch API usage.",
            ) from exc
        rows = self._parse_response_json("select_api_usage", resp)
        return list(rows) if isinstance(rows, list) else []


def map_billing_db_error(
    exc: Exception,
    *,
    endpoint: str,
    request_id: str,
    user_id: str | None = None,
    default_operation: str = "billing_db_query",
):
    from app.utils.security import ApiServiceError, log_event

    if isinstance(exc, SupabaseOperationError):
        operation = exc.operation
        db_error_code = exc.db_error_code
        http_status = exc.http_status
        error_message = exc.error_message
        is_missing_migration = exc.is_missing_migration
        is_auth_error = exc.is_auth_error
    elif isinstance(exc, httpx.HTTPStatusError):
        operation = default_operation
        http_status = exc.response.status_code
        db_error_code, error_message = _extract_postgrest_error(exc.response)
        is_missing_migration = _is_missing_migration_error(
            http_status, db_error_code, error_message
        )
        is_auth_error = http_status in {401, 403}
    else:
        operation = default_operation
        http_status = None
        db_error_code = type(exc).__name__
        error_message = _sanitize_db_error_message(str(exc))
        is_missing_migration = _is_missing_migration_error(
            None, db_error_code, error_message
        )
        is_auth_error = False

    log_event(
        "billing_db_error",
        request_id,
        endpoint=endpoint,
        user_id=user_id,
        operation=operation,
        db_error_code=db_error_code,
        http_status=http_status,
        error_type=type(exc).__name__,
        error_message=error_message,
    )

    if is_missing_migration:
        return ApiServiceError(
            503,
            "BILLING_MIGRATION_MISSING",
            "Billing database tables or RPC functions are missing or outdated. Verify Supabase migrations 0001-0006 and retry.",
        )
    if is_auth_error:
        return ApiServiceError(
            503,
            "BILLING_DATABASE_AUTH_ERROR",
            "Backend Supabase credentials were rejected. Verify SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
        )
    return ApiServiceError(
        503,
        "BILLING_DATABASE_UNAVAILABLE",
        "Unable to load or persist billing data in Supabase. Please retry.",
    )
