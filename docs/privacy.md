# Privacy, Retention & Data Handling Policy

CleanData is engineered around minimal data exposure and deterministic processing.

---

## 1. Dual Execution Architecture

1. **Browser-Local Workbench (`<= 5 MB`, Studio Default)**
   * Datasets are parsed, inspected, cleaned, and exported strictly inside browser memory using JavaScript/TypeScript.
   * No rows, headers, or cell values are transmitted to CleanData servers.
2. **Server API Path (`> 5 MB` or Automated Pipelines)**
   * Used only when explicitly selected in the Workbench (`Server API` toggle) or called via `/v1/files/upload` and `/v1/clean`.
   * Files are stored under private server-generated UUID paths in a non-public storage bucket/directory rather than caller-supplied filenames.

---

## 2. Retention Windows

* **Uploaded Raw Inputs**: Automatically purged **24 hours** after upload (`INPUT_RETENTION_HOURS=24`).
* **Cleaned Output Artifacts**: Automatically expired and deleted **7 days** after job completion (`OUTPUT_RETENTION_DAYS=7`).
* **Signed Downloads**: Output download links expire after **300 seconds** (`SIGNED_URL_TTL_SECONDS=300`) and verify an HMAC signature tied to the job and expiration timestamp.
* **Retention Cleanup**: Scheduled retention sweeps delete expired files, mark affected job records `expired`, and purge stale rate-limit/usage windows.

---

## 3. Zero-Leakage Logging & Telemetry

* Structured server logs record `request_id`, HTTP method, route, duration, status code, `job_id`, and coarse `user_id` where relevant.
* Server logs **never** capture raw dataset rows, cell samples, plaintext API keys, `SUPABASE_SERVICE_ROLE_KEY`, JWT tokens, or payment secrets.
* `/health/metrics` exposes only aggregate operational counters (`uptime_seconds`, `jobs_total`, `jobs_completed`, `jobs_failed`, `active_uploads`).

---

## 4. Account Data & Deletion Requests

* Signed-in users can request account and personal data deletion from `/dashboard/settings` (`POST /v1/account/delete-request`).
* Account deletion requests record `deletion_requested_at` and reason on the user profile so all associated datasets, jobs, and credentials can be purged safely.
