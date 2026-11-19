# Security Architecture & Controls

CleanData treats every uploaded spreadsheet and caller credential as untrusted input.

---

## 1. Spreadsheet & Parser Hardening

* **Formula / CSV Injection Protection**: Enabled by default (`formula_protection=true`). Any cell starting with `=`, `+`, `-`, `@`, `\t`, or `\r` is neutralized with a leading single quote (`'`) on both browser CSV/XLSX exports and server outputs.
* **No Remote URL Ingestion (SSRF Elimination)**: `/v1/files/upload` and `/v1/clean` accept multipart file uploads only. Remote URL fetching is deliberately disabled.
* **XLSX ZIP-Bomb & Entry Limits**: Server-side XLSX validation enforces `XLSX_MAX_UNCOMPRESSED_MB` (default `50 MB`) and `XLSX_MAX_ENTRIES` (default `200` archive entries) before loading with `openpyxl`.
* **Path Traversal & MIME Checks**: Uploaded bytes are inspected for binary/NUL content and mapped to private UUID paths inside `STORAGE_DIR`; original client filenames are never used as filesystem paths.

---

## 2. Credential, Key & Secret Handling

* **Peppered API Key Hashing**: Keys generated for **Pro** and **Business** plans use the `cd_live_` prefix. The plaintext token is returned strictly once upon creation and persisted exclusively as an HMAC-SHA256 digest keyed with `API_KEY_PEPPER`.
* **Webhook Signature Verification**: `/v1/webhooks/payments` validates the provider HMAC signature over the exact raw request body using constant-time comparison (`hmac.compare_digest`) before parsing or updating credits.
* **Short-Lived Signed Downloads**: Download URLs sign `(job_id, expires_at)` with `DOWNLOAD_SIGNING_SECRET` using HMAC-SHA256 (`SIGNED_URL_TTL_SECONDS=300`).
* **Frontend Secret Boundary**: CI verifies that `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `API_KEY_PEPPER`, and payment secrets do not appear in `/src` or `index.html`.

---

## 3. HTTP Security Headers & Rate Limiting

FastAPI middleware injects defensive headers on responses:

* `X-Content-Type-Options: nosniff`
* `X-Frame-Options: DENY`
* `Referrer-Policy: strict-origin-when-cross-origin`
* `Permissions-Policy: camera=(), microphone=(), geolocation=()`
* `Content-Security-Policy` restricting script/frame/object origins
* `Strict-Transport-Security: max-age=31536000; includeSubDomains` when `ENVIRONMENT=production`

Rate limiting uses hashed caller tokens (never raw bearer secrets in memory keys or headers) and sets `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `Retry-After` on `429` responses.

---

## 4. Database Row Level Security (RLS)

All user-owned tables enforce `auth.uid() = user_id` in PostgreSQL RLS. Sensitive state transitions—credit reservation/commit/refund and payment webhook idempotency—run inside `SECURITY DEFINER` PostgreSQL functions callable only by `service_role`.
