# Cashfree Merchant Dashboard Setup Guide

This guide covers configuring the **Cashfree Merchant Dashboard** for **CleanData Studio** across **Sandbox** and **Production**, including:

1. Generating Sandbox and Production API keys (`App ID` / `Secret Key`).
2. Enabling **Cashfree Subscriptions** and recurring mandate payment methods.
3. Configuring **webhook endpoint URLs**, API versions, events, and webhook secrets for both **Payment Gateway** (one-time credit packs) and **Subscriptions** (recurring monthly plans).
4. Setting Vercel backend environment variables and promoting from Sandbox to Production.

---

## 1. Environments & API Version

CleanData Studio integrates with Cashfree via the backend FastAPI adapter (`backend/app/services/payments.py`) and the official `@cashfreepayments/cashfree-js` SDK on the frontend.

| Setting | Sandbox (Testing) | Production (Live) |
|---|---|---|
| `CASHFREE_ENV` | `sandbox` | `production` |
| API Base URL (auto-selected by backend) | `https://sandbox.cashfree.com/pg` | `https://api.cashfree.com/pg` |
| `CASHFREE_API_VERSION` | `2025-01-01` | `2025-01-01` |
| Frontend JS SDK `mode` (passed by backend) | `sandbox` | `production` |

> **Security Rule:** All Cashfree API credentials (`CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_WEBHOOK_SECRET`) are **backend-only**. Configure them exclusively on the FastAPI backend Vercel service—never expose them in `VITE_*` frontend variables.

---

## 2. Generate API Keys (Sandbox & Production)

Sandbox and Production maintain **separate** credentials in the Cashfree Merchant Dashboard (`https://merchant.cashfree.com/`). Switch the environment toggle at the top of the dashboard before generating keys for each environment.

### Steps

1. Sign in to the **Cashfree Merchant Dashboard**.
2. Select the target environment using the **Sandbox / Test** or **Production** toggle.
3. Navigate to **Payment Gateway → Developers → API Keys** (or **Developers → API Keys**).
4. Click **Generate API Keys** (Production requires OTP / two-factor security verification).
5. Copy and store both values immediately—Cashfree displays the **Secret Key** in plaintext only once:
   * **App ID** (used in `x-client-id` header) → `CASHFREE_APP_ID`
   * **Secret Key** (used in `x-client-secret` header) → `CASHFREE_SECRET_KEY`

### Vercel Backend Environment Variable Mapping

In your Vercel **FastAPI backend** service (**Settings → Environment Variables**), configure:

```env
PAYMENT_PROVIDER="cashfree"
CASHFREE_ENV="sandbox"                 # Change to "production" when going live
CASHFREE_API_VERSION="2025-01-01"
CASHFREE_APP_ID="<App ID from dashboard>"
CASHFREE_SECRET_KEY="<Secret Key from dashboard>"
CASHFREE_WEBHOOK_SECRET="<Webhook Secret from dashboard or Secret Key>"
ALLOWED_ORIGIN="https://cleandata-studio.vercel.app"
```

* Use **Preview** / staging environment variables for **Sandbox** keys (`CASHFREE_ENV="sandbox"`).
* Use **Production** environment variables for **Production** keys (`CASHFREE_ENV="production"`).
* Trigger a fresh backend deployment after adding or rotating environment variables.

---

## 3. Enable Cashfree Subscriptions & Recurring Mandates

One-time **Payment Gateway** orders (`10`, `50`, `150`, `500` Credit Packs) and recurring **Subscriptions** (`Starter`, `Pro`, `Business`) use separate Cashfree product modules. Having standard Payment Gateway access does **not** automatically enable Subscriptions.

### Dashboard & Merchant Account Requirements

1. **Verify Subscriptions Activation:**
   * In the Cashfree Merchant Dashboard, check whether **Subscriptions** is visible and active in the left navigation.
   * If Subscriptions is locked, inactive, or returns an authorization error (`403` / feature disabled) when initializing a subscription, submit the **Subscriptions activation / KYC approval request** from the dashboard or contact Cashfree Merchant Support to enable recurring mandates on your MID.
2. **Verify Supported Mandate Payment Methods:**
   * CleanData Studio requests the following mandate methods when creating a subscription (`authorization_details.payment_methods`):
     * **UPI AutoPay** (`upi`)
     * **Credit / Debit Cards** (`card`)
     * **eNACH / NetBanking Mandate** (`enach`)
   * Confirm in your Cashfree dashboard (for both Sandbox and Production) that **UPI AutoPay**, **Cards (SI)**, and **eNACH** are enabled for recurring billing on your account.
3. **Plan Provisioning (Automatic):**
   * You do **not** need to pre-create plans manually in the dashboard. On the first checkout for a paid plan, CleanData's backend checks `GET /pg/plans/{plan_id}` and automatically creates the monthly `PERIODIC` plan via `POST /pg/plans` if missing:

| Plan | Cashfree `plan_id` (auto-created) | Monthly Price | Monthly Credits |
|---|---|---:|---:|
| **Free** | *(No Cashfree plan — free tier)* | ₹0 | 0 |
| **Starter** | `cleandata_starter_monthly` | ₹299 (`299.00 INR`) | 100 |
| **Pro** | `cleandata_pro_monthly` | ₹799 (`799.00 INR`) | 500 |
| **Business** | `cleandata_business_monthly` | ₹1,999 (`1,999.00 INR`) | 2,000 |

---

## 4. Webhook Endpoint URL Requirements & Setup

CleanData Studio exposes a single unified webhook receiver that handles both one-time credit pack events and recurring subscription events:

* **Route in FastAPI:** `POST /api/v1/webhooks/payments`
* **Vercel Multi-Service Routing:** `vercel.json` rewrites `/api/(.*)` directly to the `backend` FastAPI service, so the public URL hits FastAPI with no frontend interception.

### Required Webhook URLs

| Environment | Webhook Endpoint URL | Requirements |
|---|---|---|
| **Production** | `https://cleandata-studio.vercel.app/api/v1/webhooks/payments` | **HTTPS required**, publicly reachable, returns HTTP `200 OK`, no Bearer auth required (authenticated via HMAC signature headers). |
| **Sandbox (Deployed Preview)** | `https://<your-vercel-preview-domain>/api/v1/webhooks/payments` | Publicly reachable HTTPS URL pointing to the Sandbox-configured deployment. |
| **Sandbox (Local Dev)** | `https://<your-ngrok-or-tunnel-host>/api/v1/webhooks/payments` | Cashfree cannot deliver webhooks to `localhost` or `127.0.0.1`; expose local port `8000` (or `3000` proxy) via an HTTPS tunnel such as `ngrok`. |

### Configure Both Webhook Tabs in Cashfree

Cashfree separates webhook configuration between **Payment Gateway** and **Subscriptions**. You must register the endpoint URL in **both** places:

#### A. Payment Gateway Webhooks (One-Time Credit Packs & Refunds)
1. Go to **Payment Gateway → Developers → Webhooks**.
2. Click **Add Webhook URL** and enter:
   `https://cleandata-studio.vercel.app/api/v1/webhooks/payments`
3. Set the Webhook / API Version to **`2025-01-01`** (matches `CASHFREE_API_VERSION`).
4. Enable these events:
   * `PAYMENT_SUCCESS_WEBHOOK`
   * `PAYMENT_FAILED_WEBHOOK`
   * `PAYMENT_USER_DROPPED_WEBHOOK`
   * `REFUND_STATUS_WEBHOOK`
5. Click **Test** and confirm Cashfree receives an HTTP `200` response (or verify delivery logs), then click **Save**.

#### B. Subscriptions Webhooks (Mandates, Renewals, Cancellations)
1. Navigate to **Subscriptions → Developers → Webhooks** (or the **Subscriptions** tab under **Developers → Webhooks**).
2. Add the **same endpoint URL**:
   `https://cleandata-studio.vercel.app/api/v1/webhooks/payments`
3. Set the Webhook / API Version to **`2025-01-01`**.
4. Enable all subscription lifecycle & charge events:
   * `SUBSCRIPTION_STATUS_CHANGED`
   * `SUBSCRIPTION_AUTH_STATUS`
   * `SUBSCRIPTION_PAYMENT_SUCCESS`
   * `SUBSCRIPTION_PAYMENT_FAILED`
   * `SUBSCRIPTION_PAYMENT_CANCELLED`
   * `SUBSCRIPTION_PAYMENT_NOTIFICATION_INITIATED`
   * `SUBSCRIPTION_ACTIVATED` / `SUBSCRIPTION_CANCELLED` / `SUBSCRIPTION_PAUSED` / `SUBSCRIPTION_EXPIRED` *(if listed separately in your dashboard version)*
5. Save and test webhook delivery.

### Webhook Signature Verification & `CASHFREE_WEBHOOK_SECRET`

CleanData's `/api/v1/webhooks/payments` handler strictly rejects unsigned or tampered requests with HTTP `401 INVALID_WEBHOOK_SIGNATURE`:

* **Required Headers:** `x-webhook-signature` and `x-webhook-timestamp`
* **Signature Formula:** `base64(HMAC_SHA256(secret, x-webhook-timestamp + raw_body))`
* **Secret Resolution Order (`backend/app/config.py`):**
  1. `CASHFREE_WEBHOOK_SECRET` *(recommended)*
  2. Falls back to `CASHFREE_SECRET_KEY` if `CASHFREE_WEBHOOK_SECRET` is omitted.
* If your Cashfree dashboard displays a separate Webhook Secret (or uses your API Secret Key for webhook signing), set that exact value in `CASHFREE_WEBHOOK_SECRET` for the matching Sandbox/Production environment.

> **Note on "Test" Ping Payloads:** Cashfree's dashboard **Test** button verifies reachability and signature headers. Ensure the endpoint uses the same `CASHFREE_WEBHOOK_SECRET` / `CASHFREE_SECRET_KEY` as the environment where you click Test; otherwise signature checks will return `401`.

---

## 5. Return URLs & Redirect Behavior

CleanData's backend sets redirect URLs dynamically from `ALLOWED_ORIGIN` (`https://cleandata-studio.vercel.app` in production):

* **Credit Pack Return URL (`order_meta.return_url`):**
  `https://cleandata-studio.vercel.app/dashboard/billing?kind=credit_pack&order_id={order_id}`
* **Subscription Return URL (`subscription_meta.return_url`):**
  `https://cleandata-studio.vercel.app/dashboard/billing?kind=subscription&subscription_id={subscription_id}`

When a user returns from Cashfree hosted checkout, the billing page calls `POST /api/v1/billing/verify`, which queries Cashfree directly from the backend (`GET /pg/orders/{order_id}` or `GET /pg/subscriptions/{subscription_id}`)—URL query parameters alone never grant credits or activate plans.

If your Cashfree Production account enforces a **Domain / Return URL Whitelist**, whitelist:
* `https://cleandata-studio.vercel.app`

---

## 6. Sandbox-to-Production Cutover Checklist

- [ ] Supabase migrations `0001` through `0006_billing_reconciliation_and_wallets.sql` applied to production database.
- [ ] Cashfree **Production** API Keys generated (`CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`) and set in Vercel **backend** Production environment variables.
- [ ] `CASHFREE_ENV="production"` and `CASHFREE_API_VERSION="2025-01-01"` set on Vercel **backend** Production service.
- [ ] `ALLOWED_ORIGIN="https://cleandata-studio.vercel.app"` verified on Vercel **backend**.
- [ ] **Cashfree Subscriptions** + **UPI AutoPay / Cards / eNACH** mandates confirmed active on Production MID.
- [ ] `https://cleandata-studio.vercel.app/api/v1/webhooks/payments` registered and tested under **both** Payment Gateway Webhooks and Subscriptions Webhooks (`2025-01-01`).
- [ ] Fresh Vercel deployment triggered and verified with one small live credit pack purchase and one subscription authorization/cancellation cycle.
