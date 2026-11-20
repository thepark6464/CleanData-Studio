import type { CleaningOperationConfig, QualityScoreBreakdown } from '../cleaner/types';

export interface ApiErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    request_id: string;
  };
}

export interface FileUploadResponse {
  success: true;
  file_id: string;
  filename: string;
  input_format: 'csv' | 'xlsx';
  byte_size: number;
  encoding: string;
  delimiter: string;
  row_count: number;
  column_count: number;
  headers: string[];
  expires_at: string;
}

export interface CleanJobCreateResponse {
  success: true;
  job_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'canceled' | 'expired';
  message: string;
}

export interface JobStatusResponse {
  success: true;
  job_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'canceled' | 'expired';
  input_name: string;
  input_format: 'csv' | 'xlsx';
  output_format: 'csv' | 'xlsx';
  rows_processed: number;
  duplicates_removed: number;
  missing_values_found: number;
  quality_score: number | null;
  credits_reserved?: number;
  credits_charged?: number;
  download_url: string | null;
  created_at: string;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
}

export interface ServerCleaningReport {
  jobId: string;
  createdAt: string;
  processingPath: 'server';
  sourceFilename: string;
  inputFormat: 'csv' | 'xlsx';
  encoding: string;
  delimiter: string;
  rowsBefore: number;
  rowsAfter: number;
  columnsBefore: number;
  columnsAfter: number;
  headersBefore: string[];
  headersAfter: string[];
  operationsApplied: Array<{
    id: string;
    label: string;
    applied: boolean;
    recordsAffected: number;
    details: string;
    parameters: Record<string, unknown>;
  }>;
  recordsChanged: number;
  recordsRemoved: number;
  duplicatesRemoved: number;
  emptyRowsRemoved: number;
  missingValuesFound: number;
  missingValuesHandled: number;
  formulaInjectionProtected: boolean;
  formulaCellsEscaped: number;
  warnings: Array<{
    code: string;
    severity: 'info' | 'warning' | 'error';
    message: string;
    column?: string;
    count?: number;
  }>;
  qualityBefore: QualityScoreBreakdown;
  qualityAfter: QualityScoreBreakdown;
}

export interface JobReportResponse {
  success: true;
  job_id: string;
  report: ServerCleaningReport;
}

export interface SignedDownloadResponse {
  success: true;
  job_id: string;
  download_url: string;
  expires_in_seconds: number;
  output_format: 'csv' | 'xlsx';
}

export interface CleanJobSubmitParams {
  file?: File;
  fileId?: string;
  operations: CleaningOperationConfig[];
  outputFormat: 'csv' | 'xlsx';
  formulaProtection: boolean;
  delimiterOverride?: string;
  idempotencyKey?: string;
}

export interface JobListResponse {
  success: true;
  items: JobStatusResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface AccountDeletionResponse {
  success: true;
  user_id: string;
  deletion_requested_at: string;
  message: string;
}

export interface ApiCreditTransaction {
  id: string;
  amount: number;
  credit_source: 'subscription' | 'purchased';
  transaction_type:
    | 'subscription_grant'
    | 'purchase'
    | 'reserve'
    | 'commit'
    | 'refund'
    | 'expire'
    | 'adjustment';
  reference_id: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface ApiPaymentRecord {
  id: string;
  amount_paise: number;
  currency: string;
  provider: string;
  provider_payment_id: string | null;
  kind: 'credit_pack' | 'subscription' | null;
  item_name: string | null;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  created_at: string;
}

export interface BillingSummaryResponse {
  success: true;
  wallet: {
    subscription_balance: number;
    purchased_balance: number;
    total_balance: number;
    subscription_expires_at: string | null;
    purchased_expires_at: string | null;
  };
  subscription: {
    plan_name: string;
    status: string;
    provider?: string;
    provider_subscription_id?: string | null;
    cancel_at_period_end?: boolean;
    monthly_price_paise: number;
    monthly_credits: number;
    max_file_size_mb: number;
    daily_job_limit: number | null;
    api_access: boolean;
    api_rate_limit_per_min: number;
    current_period_end: string | null;
  };
  transactions: ApiCreditTransaction[];
  payments: ApiPaymentRecord[];
}

export interface CheckoutCreateRequest {
  kind: 'subscription' | 'credit_pack';
  item_name: string;
  customer_phone?: string;
}

export interface CheckoutCreateResponse {
  success: true;
  payment_id: string;
  provider: string;
  order_id: string;
  subscription_id: string | null;
  payment_session_id: string | null;
  subscription_session_id: string | null;
  cashfree_mode: 'sandbox' | 'production';
  amount_paise: number;
  currency: string;
  kind: 'subscription' | 'credit_pack';
  item_name: string;
  message: string;
}

export interface CheckoutVerifyRequest {
  kind: 'subscription' | 'credit_pack';
  order_id?: string;
  subscription_id?: string;
}

export interface CheckoutVerifyResponse {
  success: true;
  kind: 'subscription' | 'credit_pack';
  status: 'paid' | 'active' | 'pending' | 'failed' | 'canceled' | 'expired';
  item_name: string | null;
  wallet: BillingSummaryResponse['wallet'];
  subscription: BillingSummaryResponse['subscription'];
  message: string;
}

export interface SubscriptionCancelResponse {
  success: true;
  subscription_id: string | null;
  status: string;
  plan_name: string;
  message: string;
}

export interface ApiKeyMetadata {
  id: string;
  user_id?: string;
  name: string | null;
  prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface CreateApiKeyResponse {
  success: true;
  plaintext_key: string;
  key: ApiKeyMetadata;
  message: string;
}

export interface ApiUsageItem {
  id: string;
  api_key_id: string | null;
  endpoint: string;
  credits_used: number;
  status_code: number;
  created_at: string;
}

export interface RateLimitInfo {
  limit_per_min: number;
  used: number;
  remaining: number;
  window_seconds: number;
  reset_in_seconds: number;
}

export interface ApiUsageResponse {
  success: true;
  plan_name: string;
  api_access: boolean;
  rate_limit_per_min: number;
  remaining_rate_limit?: number;
  requests_used_current_window?: number;
  rate_limit_window_seconds?: number;
  rate_limit_reset_in_seconds?: number;
  rate_limit?: RateLimitInfo;
  total_requests_logged: number;
  total_credits_used?: number;
  items: ApiUsageItem[];
}

export interface CreditsBalanceResponse {
  success: true;
  plan_name: string;
  wallet: BillingSummaryResponse['wallet'];
}



