import type {
  AccountDeletionResponse,
  ApiErrorEnvelope,
  ApiKeyMetadata,
  ApiUsageResponse,
  BillingSummaryResponse,
  CheckoutCreateRequest,
  CheckoutCreateResponse,
  CheckoutVerifyRequest,
  CheckoutVerifyResponse,
  CleanJobCreateResponse,
  CleanJobSubmitParams,
  CreateApiKeyResponse,
  CreditsBalanceResponse,
  FileUploadResponse,
  JobListResponse,
  JobReportResponse,
  JobStatusResponse,
  SignedDownloadResponse,
  SubscriptionCancelResponse,
} from './types';

export class CleanDataApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly requestId?: string;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = 'CleanDataApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL as string | undefined;
  const cleaned = (configured ?? '/api').trim().replace(/\/+$/, '');
  return cleaned || '/api';
}

async function handleJsonResponse<T>(resp: Response): Promise<T> {
  const headerReqId = resp.headers?.get?.('x-request-id') || undefined;
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    const envelope = data as ApiErrorEnvelope | null;
    if (envelope && envelope.error) {
      throw new CleanDataApiError(
        resp.status,
        envelope.error.code,
        envelope.error.message,
        envelope.error.request_id || headerReqId,
      );
    }
    const detail =
      data && typeof data === 'object' && 'detail' in data && typeof (data as { detail?: unknown }).detail === 'string'
        ? (data as { detail: string }).detail
        : null;
    throw new CleanDataApiError(
      resp.status,
      resp.status >= 500 ? `HTTP_${resp.status}` : 'HTTP_ERROR',
      detail ? `Server returned HTTP ${resp.status}: ${detail}` : `Server returned HTTP ${resp.status}.`,
      headerReqId,
    );
  }
  return data as T;
}

export class CleanDataApiClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(baseUrl: string = getApiBaseUrl(), apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  private assertConfigured() {
    if (!this.baseUrl) {
      throw new CleanDataApiError(
        0,
        'API_NOT_CONFIGURED',
        'API base URL is not configured. Set VITE_API_BASE_URL to your local backend URL for local development, or use /api for the deployed same-domain backend.',
      );
    }
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...(extra ?? {}) };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  async checkHealth(): Promise<{ status: string; service: string }> {
    this.assertConfigured();
    const resp = await fetch(`${this.baseUrl}/health`);
    return handleJsonResponse(resp);
  }

  async uploadFile(file: File): Promise<FileUploadResponse> {
    this.assertConfigured();
    const form = new FormData();
    form.append('file', file);
    const resp = await fetch(`${this.baseUrl}/v1/files/upload`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: form,
    });
    return handleJsonResponse(resp);
  }

  async createCleanJob(params: CleanJobSubmitParams): Promise<CleanJobCreateResponse> {
    this.assertConfigured();
    const form = new FormData();
    if (params.file) form.append('file', params.file);
    if (params.fileId) form.append('file_id', params.fileId);
    form.append('operations', JSON.stringify(params.operations));
    form.append('output_format', params.outputFormat);
    form.append('formula_protection', String(params.formulaProtection));
    if (params.includeCleaningFlags !== undefined) {
      form.append('include_cleaning_flags', String(params.includeCleaningFlags));
    }
    if (params.delimiterOverride) {
      form.append('delimiter_override', params.delimiterOverride);
    }

    const extraHeaders: Record<string, string> = {};
    if (params.idempotencyKey) {
      extraHeaders['Idempotency-Key'] = params.idempotencyKey;
    }

    const resp = await fetch(`${this.baseUrl}/v1/clean`, {
      method: 'POST',
      headers: this.authHeaders(extraHeaders),
      body: form,
    });
    return handleJsonResponse(resp);
  }

  async listJobs(limit = 20, offset = 0): Promise<JobListResponse> {
    this.assertConfigured();
    const resp = await fetch(
      `${this.baseUrl}/v1/jobs?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`,
      { headers: this.authHeaders() },
    );
    return handleJsonResponse(resp);
  }

  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    this.assertConfigured();
    const resp = await fetch(`${this.baseUrl}/v1/jobs/${encodeURIComponent(jobId)}`, {
      headers: this.authHeaders(),
    });
    return handleJsonResponse(resp);
  }

  async getJobReport(jobId: string): Promise<JobReportResponse> {
    this.assertConfigured();
    const resp = await fetch(`${this.baseUrl}/v1/jobs/${encodeURIComponent(jobId)}/report`, {
      headers: this.authHeaders(),
    });
    return handleJsonResponse(resp);
  }

  async getSignedDownload(jobId: string): Promise<SignedDownloadResponse> {
    this.assertConfigured();
    const resp = await fetch(`${this.baseUrl}/v1/jobs/${encodeURIComponent(jobId)}/download`, {
      headers: this.authHeaders(),
    });
    return handleJsonResponse(resp);
  }

  async getAccountMe(): Promise<{
    success: true;
    user: { id: string; email?: string | null; role: string; auth_method?: string };
  }> {
    this.assertConfigured();
    const resp = await fetch(`${this.baseUrl}/v1/account/me`, {
      headers: this.authHeaders(),
    });
    return handleJsonResponse(resp);
  }

  async requestAccountDeletion(reason: string): Promise<AccountDeletionResponse> {
    this.assertConfigured();
    const resp = await fetch(`${this.baseUrl}/v1/account/delete-request`, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ reason }),
    });
    return handleJsonResponse(resp);
  }

  async getBillingSummary(): Promise<BillingSummaryResponse> {
    this.assertConfigured();
    const resp = await fetch(`${this.baseUrl}/v1/billing/summary`, {
      headers: this.authHeaders(),
    });
    return handleJsonResponse(resp);
  }

  async createCheckout(payload: CheckoutCreateRequest): Promise<CheckoutCreateResponse> {
    this.assertConfigured();
    const resp = await fetch(`${this.baseUrl}/v1/billing/checkout`, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    return handleJsonResponse(resp);
  }

  async verifyCheckout(payload: CheckoutVerifyRequest): Promise<CheckoutVerifyResponse> {
    this.assertConfigured();
    const resp = await fetch(`${this.baseUrl}/v1/billing/verify`, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    return handleJsonResponse(resp);
  }

  async cancelSubscription(): Promise<SubscriptionCancelResponse> {
    this.assertConfigured();
    const resp = await fetch(`${this.baseUrl}/v1/billing/subscription/cancel`, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
    });
    return handleJsonResponse(resp);
  }

  async listApiKeys(): Promise<{ success: true; items: ApiKeyMetadata[] }> {
    this.assertConfigured();
    const resp = await fetch(`${this.baseUrl}/v1/api-keys`, {
      headers: this.authHeaders(),
    });
    return handleJsonResponse(resp);
  }

  async createApiKey(name: string): Promise<CreateApiKeyResponse> {
    this.assertConfigured();
    const resp = await fetch(`${this.baseUrl}/v1/api-keys`, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name }),
    });
    return handleJsonResponse(resp);
  }

  async revokeApiKey(keyId: string): Promise<{ success: true; key: ApiKeyMetadata }> {
    this.assertConfigured();
    const resp = await fetch(`${this.baseUrl}/v1/api-keys/${encodeURIComponent(keyId)}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
    return handleJsonResponse(resp);
  }

  async getUsage(): Promise<ApiUsageResponse> {
    this.assertConfigured();
    const resp = await fetch(`${this.baseUrl}/v1/usage`, {
      headers: this.authHeaders(),
    });
    return handleJsonResponse(resp);
  }

  async getDashboardUsage(): Promise<ApiUsageResponse> {
    const endpoint =
      !this.baseUrl || this.baseUrl === '/api'
        ? '/api/usage'
        : this.baseUrl.endsWith('/api')
        ? `${this.baseUrl}/usage`
        : `${this.baseUrl}/api/usage`;
    const resp = await fetch(endpoint, {
      headers: this.authHeaders(),
    });
    return handleJsonResponse(resp);
  }

  async getCredits(): Promise<CreditsBalanceResponse> {
    this.assertConfigured();
    const resp = await fetch(`${this.baseUrl}/v1/credits`, {
      headers: this.authHeaders(),
    });
    return handleJsonResponse(resp);
  }
}
