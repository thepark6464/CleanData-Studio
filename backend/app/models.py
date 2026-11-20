from typing import Any, Literal
from pydantic import BaseModel, Field


OperationId = Literal[
    "remove_empty_rows",
    "remove_duplicates",
    "trim_whitespace",
    "normalize_text",
    "standardize_dates",
    "normalize_emails",
    "normalize_phone_numbers",
    "handle_missing_values",
    "rename_columns",
]

OutputFormat = Literal["csv", "xlsx"]
InputFormat = Literal["csv", "xlsx"]
JobStatus = Literal["queued", "processing", "completed", "failed", "canceled", "expired"]


class OperationRequest(BaseModel):
    id: OperationId
    enabled: bool = True
    params: dict[str, Any] = Field(default_factory=dict)


class ApiErrorDetail(BaseModel):
    code: str
    message: str
    request_id: str


class ApiErrorResponse(BaseModel):
    success: Literal[False] = False
    error: ApiErrorDetail


class FileUploadResponse(BaseModel):
    success: Literal[True] = True
    file_id: str
    filename: str
    input_format: InputFormat
    byte_size: int
    encoding: str
    delimiter: str
    row_count: int
    column_count: int
    headers: list[str]
    expires_at: str


class CleanJobCreateResponse(BaseModel):
    success: Literal[True] = True
    job_id: str
    status: JobStatus
    message: str


class QualityScoreBreakdown(BaseModel):
    score: float
    missingRate: float
    invalidRate: float
    duplicateRate: float
    typeInconsistencyRate: float
    missingCount: int
    invalidCount: int
    duplicateRowCount: int
    typeInconsistentCount: int
    totalCells: int
    totalRows: int
    formulaDescription: str


class CleaningWarning(BaseModel):
    code: str
    severity: Literal["info", "warning", "error"]
    message: str
    column: str | None = None
    count: int | None = None


class OperationSummary(BaseModel):
    id: OperationId
    label: str
    applied: bool
    recordsAffected: int
    details: str
    parameters: dict[str, Any]


class CleaningReport(BaseModel):
    jobId: str
    createdAt: str
    processingPath: Literal["server"] = "server"
    sourceFilename: str
    inputFormat: InputFormat
    encoding: str
    delimiter: str
    rowsBefore: int
    rowsAfter: int
    columnsBefore: int
    columnsAfter: int
    headersBefore: list[str]
    headersAfter: list[str]
    operationsApplied: list[OperationSummary]
    recordsChanged: int
    recordsRemoved: int
    duplicatesRemoved: int
    emptyRowsRemoved: int
    missingValuesFound: int
    missingValuesHandled: int
    formulaInjectionProtected: bool
    formulaCellsEscaped: int
    warnings: list[CleaningWarning]
    qualityBefore: QualityScoreBreakdown
    qualityAfter: QualityScoreBreakdown


class JobStatusResponse(BaseModel):
    success: Literal[True] = True
    job_id: str
    status: JobStatus
    input_name: str
    input_format: InputFormat
    output_format: OutputFormat
    rows_processed: int
    duplicates_removed: int
    missing_values_found: int
    quality_score: float | None = None
    credits_reserved: int = 0
    credits_charged: int = 0
    download_url: str | None = None
    created_at: str
    completed_at: str | None = None
    error_code: str | None = None
    error_message: str | None = None


class JobListResponse(BaseModel):
    success: Literal[True] = True
    items: list[JobStatusResponse]
    total: int
    limit: int
    offset: int


class JobReportResponse(BaseModel):
    success: Literal[True] = True
    job_id: str
    report: CleaningReport


class SignedDownloadResponse(BaseModel):
    success: Literal[True] = True
    job_id: str
    download_url: str
    expires_in_seconds: int
    output_format: OutputFormat


class CreditWalletSummary(BaseModel):
    subscription_balance: int
    purchased_balance: int
    total_balance: int
    subscription_expires_at: str | None = None
    purchased_expires_at: str | None = None


class ActiveSubscriptionSummary(BaseModel):
    plan_name: str
    status: str
    provider: str = "system"
    provider_subscription_id: str | None = None
    cancel_at_period_end: bool = False
    monthly_price_paise: int
    monthly_credits: int
    max_file_size_mb: int
    daily_job_limit: int | None = None
    api_access: bool
    api_rate_limit_per_min: int
    current_period_end: str | None = None


class CreditTransactionItem(BaseModel):
    id: str
    amount: int
    credit_source: Literal["subscription", "purchased"]
    transaction_type: Literal[
        "subscription_grant",
        "purchase",
        "reserve",
        "commit",
        "refund",
        "expire",
        "adjustment",
    ]
    reference_id: str | None = None
    expires_at: str | None = None
    created_at: str


class PaymentRecordItem(BaseModel):
    id: str
    amount_paise: int
    currency: str
    provider: str
    provider_payment_id: str | None = None
    kind: Literal["credit_pack", "subscription"]
    item_name: str | None = None
    status: Literal["pending", "paid", "failed", "refunded"]
    created_at: str


class BillingSummaryResponse(BaseModel):
    success: Literal[True] = True
    wallet: CreditWalletSummary
    subscription: ActiveSubscriptionSummary
    transactions: list[CreditTransactionItem]
    payments: list[PaymentRecordItem]


class CheckoutCreateRequest(BaseModel):
    kind: Literal["subscription", "credit_pack"]
    item_name: str = Field(..., min_length=1, max_length=64)
    customer_phone: str | None = Field(default=None, max_length=20)


class CheckoutCreateResponse(BaseModel):
    success: Literal[True] = True
    payment_id: str
    provider: str
    order_id: str
    subscription_id: str | None = None
    payment_session_id: str | None = None
    subscription_session_id: str | None = None
    cashfree_mode: Literal["sandbox", "production"] = "sandbox"
    amount_paise: int
    currency: str
    kind: Literal["subscription", "credit_pack"]
    item_name: str
    message: str


class CheckoutVerifyRequest(BaseModel):
    kind: Literal["subscription", "credit_pack"]
    order_id: str | None = Field(default=None, max_length=128)
    subscription_id: str | None = Field(default=None, max_length=128)


class CheckoutVerifyResponse(BaseModel):
    success: Literal[True] = True
    kind: Literal["subscription", "credit_pack"]
    status: Literal["paid", "active", "pending", "failed", "canceled", "expired"]
    item_name: str | None = None
    wallet: CreditWalletSummary
    subscription: ActiveSubscriptionSummary
    message: str


class SubscriptionCancelResponse(BaseModel):
    success: Literal[True] = True
    subscription_id: str | None = None
    status: str
    plan_name: str
    message: str

