import React from 'react';
import { MERCHANT_INFO } from '../config/merchant';
import { AppLink, type AppRoute } from '../lib/router';

interface LegalPageProps {
  onNavigate?: (to: AppRoute) => void;
}

const PolicyMetaHeader: React.FC<{ eyebrow: string; title: string }> = ({ eyebrow, title }) => (
  <header className="space-y-2">
    <p className="text-xs font-medium text-blue-800">{eyebrow}</p>
    <h1 className="font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl [text-wrap:balance]">
      {title}
    </h1>
    <p className="text-xs text-slate-600">
      Effective / Last Updated:{' '}
      <span className="font-mono text-slate-800">{MERCHANT_INFO.policyLastUpdated}</span> ·
      Operated by <strong className="font-semibold text-slate-900">{MERCHANT_INFO.legalName}</strong>{' '}
      (<a
        href={MERCHANT_INFO.websiteUrl}
        className="font-mono text-blue-800 hover:underline"
      >
        {MERCHANT_INFO.websiteHost}
      </a>
      )
    </p>
  </header>
);

const PolicyContactBlock: React.FC<{ onNavigate?: (to: AppRoute) => void }> = ({ onNavigate }) => (
  <section className="space-y-2 border-t border-slate-100 pt-5">
    <h2 className="font-display text-base font-semibold text-slate-950">
      Operator &amp; Website Details
    </h2>
    <p>
      {MERCHANT_INFO.brandName} is operated by{' '}
      <strong className="font-semibold text-slate-900">{MERCHANT_INFO.legalName}</strong>.
    </p>
    <ul className="list-disc pl-5 space-y-1">
      <li>
        Website:{' '}
        <a href={MERCHANT_INFO.websiteUrl} className="font-mono text-xs text-blue-800 hover:underline">
          {MERCHANT_INFO.websiteUrl}
        </a>
        {onNavigate && (
          <>
            {' · '}
            <AppLink
              to="/contact"
              onNavigate={onNavigate}
              className="font-medium text-blue-800 hover:underline"
            >
              View Contact Us page
            </AppLink>
          </>
        )}
      </li>
    </ul>
  </section>
);

export const PrivacyPage: React.FC<LegalPageProps> = ({ onNavigate }) => {
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-6 sm:py-14">
      <PolicyMetaHeader eyebrow="Privacy & Data Handling" title="Privacy Policy" />

      <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 text-sm leading-relaxed text-slate-700">
        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-950">
            1. Scope &amp; Operator
          </h2>
          <p>
            This Privacy Policy explains how {MERCHANT_INFO.brandName} ({MERCHANT_INFO.websiteUrl}),
            operated by <strong className="font-semibold text-slate-900">{MERCHANT_INFO.legalName}</strong>,
            handles account, billing, and dataset information when you use the browser workbench,
            dashboard, or REST API.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-950">
            2. Browser-Only vs. Server Processing Paths
          </h2>
          <p>
            <strong>Browser-Local Cleaning (Up to 5 MB):</strong> Files processed in browser-local
            mode execute entirely inside your local browser memory. Spreadsheet bytes, cell values,
            and generated exports are not transmitted to our servers and are never logged.
          </p>
          <p>
            <strong>Server API Processing:</strong> When you submit files through the server
            cleaning path or REST API, uploaded datasets are temporarily stored under random UUID
            identifiers and made available via short-lived signed download links so the cleaning job
            can complete.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-950">
            3. Account, Payment &amp; Usage Information Collected
          </h2>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <strong>Account Data:</strong> When you create an account, we store your email address,
              optional full name, and user preferences via Supabase Authentication and PostgreSQL.
            </li>
            <li>
              <strong>Developer API Keys:</strong> Generated <code className="font-mono text-xs">cd_live_</code>{' '}
              keys are shown once at creation and persisted strictly as peppered HMAC-SHA256 hashes.
            </li>
            <li>
              <strong>Payment &amp; Billing Records:</strong> Online payments and recurring mandates
              are processed by Cashfree Payments. We store Cashfree order/subscription references,
              INR amounts, payment status, and credit ledger entries. We do not collect or store raw
              card numbers, CVV, bank credentials, or UPI PINs on our servers.
            </li>
            <li>
              <strong>Operational Telemetry:</strong> Application logs record request IDs, endpoint
              status codes, and aggregate row counts—never raw spreadsheet rows, emails inside
              datasets, API secrets, or payment secrets.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-950">
            4. No AI Model Training on Customer Files
          </h2>
          <p>
            {MERCHANT_INFO.brandName} does not use customer spreadsheets or uploaded row contents to
            train AI or machine-learning models. All data cleaning operations run through
            deterministic parsing and validation rules.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-950">
            5. Retention &amp; Deletion Schedule (Server Path)
          </h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Uploaded server input files: scheduled for deletion 24 hours after upload/job completion.</li>
            <li>Cleaned output download artifacts: scheduled for deletion 7 days after generation.</li>
            <li>
              Job metadata, quality-score summaries, and billing/credit ledger records: retained while
              your account remains active and as needed for statutory billing and reconciliation obligations.
            </li>
            <li>
              Account deletion requests can be submitted from{' '}
              {onNavigate ? (
                <AppLink
                  to="/dashboard/settings"
                  onNavigate={onNavigate}
                  className="font-medium text-blue-800 hover:underline"
                >
                  Dashboard → Settings
                </AppLink>
              ) : (
                'Dashboard → Settings'
              )}{' '}
              or by contacting us directly.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-950">
            6. Security Controls &amp; Infrastructure Providers
          </h2>
          <p>
            Traffic is encrypted in transit via HTTPS/TLS. We rely on Vercel for application hosting,
            Supabase for authentication and row-level-security-protected database storage, and
            Cashfree Payments for payment processing. Server-side workers must read uploaded bytes
            to execute Pandas/openpyxl transformations, so server-path jobs are not end-to-end
            zero-knowledge encrypted.
          </p>
        </section>

        <PolicyContactBlock onNavigate={onNavigate} />
      </div>
    </div>
  );
};

export const TermsPage: React.FC<LegalPageProps> = ({ onNavigate }) => {
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-6 sm:py-14">
      <PolicyMetaHeader eyebrow="Service Terms" title="Terms & Conditions" />

      <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 text-sm leading-relaxed text-slate-700">
        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-950">
            1. Acceptance of Terms
          </h2>
          <p>
            By accessing or using {MERCHANT_INFO.brandName} ({MERCHANT_INFO.websiteUrl}), operated by{' '}
            <strong className="font-semibold text-slate-900">{MERCHANT_INFO.legalName}</strong>, you
            agree to these Terms &amp; Conditions. If you do not agree, do not use the service or
            purchase a paid plan or credit pack.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-950">
            2. Service Scope &amp; Validation Boundaries
          </h2>
          <p>
            {MERCHANT_INFO.brandName} provides deterministic spreadsheet cleaning (browser-local up
            to 5 MB and server-side processing via web or REST API). Email syntax checks and phone
            formatting validate syntactic structure only and do not verify active mailbox
            deliverability or carrier registration. You are responsible for reviewing before/after
            previews and reports before importing exported datasets into production systems.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-950">
            3. Accounts, API Keys &amp; Acceptable Use
          </h2>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              You are responsible for safeguarding your account login and any{' '}
              <code className="font-mono text-xs">cd_live_</code> API keys issued on Pro or Business
              plans.
            </li>
            <li>
              You must only upload or process datasets that you have lawful authority to handle.
            </li>
            <li>
              Automated abuse, circumventing plan/rate limits, credential sharing, or uploading
              malicious payloads (such as archive bombs or executable binaries disguised as
              spreadsheets) is prohibited and may result in immediate suspension.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-950">
            4. Pricing, Credits, Subscriptions &amp; Taxes
          </h2>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              All paid plans (Starter ₹299/month, Pro ₹799/month, Business ₹1,999/month) and
              one-time credit packs (10 Credits ₹49, 50 Credits ₹149, 150 Credits ₹349, 500 Credits
              ₹899) are billed in Indian Rupees (INR) through Cashfree Payments.
            </li>
            <li>
              <strong>Credit Metering:</strong> Server jobs consume{' '}
              <code className="font-mono text-xs">1 credit per up to 1,000 input rows</code>{' '}
              (rounded up). Monthly subscription credits are always deducted before purchased credit
              pack balances.
            </li>
            <li>
              <strong>Validity &amp; Expiry:</strong> Monthly subscription credits reset each billing
              cycle and expire at the end of the cycle. Purchased one-time credit packs remain valid
              for 12 months from the date of grant.
            </li>
            <li>
              <strong>Automatic Job-Failure Refunds:</strong> Credits reserved for a server cleaning
              job are automatically restored to your credit wallet if the job fails due to a system
              or parsing error.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-950">
            5. Cancellations &amp; Refunds
          </h2>
          <p>
            Subscription cancellations and refund eligibility are governed strictly by our{' '}
            {onNavigate ? (
              <AppLink
                to="/refund-policy"
                onNavigate={onNavigate}
                className="font-medium text-blue-800 hover:underline"
              >
                Refund &amp; Cancellation Policy
              </AppLink>
            ) : (
              'Refund & Cancellation Policy'
            )}
            .
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-950">
            6. Availability &amp; Limitation of Liability
          </h2>
          <p>
            The service is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis.
            To the maximum extent permitted by applicable law, {MERCHANT_INFO.legalName} shall not
            be liable for indirect, incidental, or consequential damages, or for data loss arising
            from improper import configuration or failure to verify exported datasets before external
            use. Aggregate liability for any paid claim is limited to the fees actually paid by you
            for the specific billing period or credit pack giving rise to the claim.
          </p>
        </section>

        <PolicyContactBlock onNavigate={onNavigate} />
      </div>
    </div>
  );
};

export const RefundPolicyPage: React.FC<LegalPageProps> = ({ onNavigate }) => {
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-6 sm:py-14">
      <PolicyMetaHeader
        eyebrow="Billing & Payment Policies"
        title="Refund & Cancellation Policy"
      />

      <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 text-sm leading-relaxed text-slate-700">
        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-950">
            1. Overview
          </h2>
          <p>
            This Refund &amp; Cancellation Policy applies to all paid subscriptions and one-time
            credit packs purchased on {MERCHANT_INFO.brandName} ({MERCHANT_INFO.websiteUrl}),
            operated by <strong className="font-semibold text-slate-900">{MERCHANT_INFO.legalName}</strong>{' '}
            and processed via Cashfree Payments.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-950">
            2. Monthly Subscriptions (Starter, Pro, Business)
          </h2>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <strong>Cancellation at Any Time:</strong> You can cancel monthly auto-renewal at any
              time from{' '}
              {onNavigate ? (
                <AppLink
                  to="/dashboard/billing"
                  onNavigate={onNavigate}
                  className="font-medium text-blue-800 hover:underline"
                >
                  Dashboard → Credits &amp; Billing
                </AppLink>
              ) : (
                'Dashboard → Credits & Billing'
              )}{' '}
              using the <em>Cancel monthly auto-renewal</em> action. Cancelling stops all future
              recurring charges on your Cashfree mandate (UPI AutoPay, Card, or eNACH) immediately.
            </li>
            <li>
              <strong>Switching Plans:</strong> Upgrading or downgrading creates a new subscription
              mandate and automatically cancels your previous active recurring mandate once the new
              mandate activates.
            </li>
            <li>
              <strong>Non-Refundable Active Cycles:</strong> Once a monthly subscription cycle has
              been billed and monthly credits have been provisioned to your wallet, subscription fees
              for that current billing period are non-refundable and unused monthly credits expire at
              the end of the cycle.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-950">
            3. One-Time Credit Packs (10, 50, 150, 500 Credits)
          </h2>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              One-time credit packs are digital service credits valid for 12 months from the date of
              purchase and are granted to your account immediately upon Cashfree payment verification.
            </li>
            <li>
              Because digital credits are provisioned immediately upon successful payment, completed
              credit-pack purchases are <strong>non-refundable once credits are granted or used</strong>,
              except for the verified billing exceptions listed in Section 5 below.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-950">
            4. Automatic Service Credit Refunds for Failed Cleaning Jobs
          </h2>
          <p>
            When you run a server cleaning job, credits (<code className="font-mono text-xs">1 credit per up to 1,000 rows</code>)
            are reserved upfront and committed only upon completion. If a server job fails due to a
            system or parsing error, the reserved credits are <strong>automatically refunded back to
            your CleanData credit wallet</strong> (credit balance restoration, not a cash/bank refund).
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-950">
            5. Eligible Monetary Refund Exceptions &amp; Request Process
          </h2>
          <p>
            Monetary refunds to your original payment method are supported strictly in the following
            verified cases:
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <strong>Duplicate Charge:</strong> You were charged more than once for the same
              order or same monthly billing cycle due to a payment gateway or network retry issue.
            </li>
            <li>
              <strong>Non-Delivery After Capture:</strong> Your payment was debited and confirmed by
              Cashfree, but the corresponding credits or subscription activation could not be
              delivered or reconciled to your account.
            </li>
            <li>
              <strong>Verified Unauthorized or Erroneous Billing:</strong> An erroneous charge
              verified against Cashfree transaction logs.
            </li>
          </ul>
          <p>
            To initiate a billing reconciliation or refund review, use the server verification tool
            under{' '}
            {onNavigate ? (
              <AppLink
                to="/dashboard/billing"
                onNavigate={onNavigate}
                className="font-medium text-blue-800 hover:underline"
              >
                Dashboard → Credits &amp; Billing
              </AppLink>
            ) : (
              'Dashboard → Credits & Billing'
            )}{' '}
            with your Cashfree Order ID (<code className="font-mono text-xs">cd_ord_...</code>) or
            Subscription ID (<code className="font-mono text-xs">cd_sub_...</code>) within 7 days
            of the transaction.
          </p>
          <p>
            When an approved monetary refund is processed via Cashfree, any unspent credits
            associated with that payment are revoked from your CleanData wallet, and the refunded
            amount is returned to your original payment method within 5–7 business days depending on
            your bank, card issuer, or UPI provider.
          </p>
        </section>

        <PolicyContactBlock onNavigate={onNavigate} />
      </div>
    </div>
  );
};
