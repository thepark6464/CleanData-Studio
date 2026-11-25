import React from 'react';
import { CreditCard, Globe, Settings, ShieldCheck, User } from 'lucide-react';
import { MERCHANT_INFO } from '../config/merchant';
import { AppLink, type AppRoute } from '../lib/router';

interface ContactPageProps {
  onNavigate: (to: AppRoute) => void;
}

export const ContactPage: React.FC<ContactPageProps> = ({ onNavigate }) => {
  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-10 sm:px-6 sm:py-14">
      <header className="space-y-3">
        <p className="text-xs font-medium text-blue-800">Contact Us</p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl [text-wrap:balance]">
          Contact {MERCHANT_INFO.brandName}
        </h1>
        <p className="text-sm leading-relaxed text-slate-600 sm:text-base">
          Operator information and self-service support resources for billing verification, subscription management, and account settings.
        </p>
      </header>

      <section
        aria-labelledby="contact-details-heading"
        className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 space-y-6"
      >
        <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2
              id="contact-details-heading"
              className="font-display text-lg font-semibold text-slate-950"
            >
              Merchant &amp; Operator Details
            </h2>
            <p className="text-xs text-slate-600">
              Official operator information for {MERCHANT_INFO.brandName}.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-800">
            <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Verified Service Portal</span>
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
              <User className="h-4 w-4 text-blue-800" aria-hidden="true" />
              <span>Legal Name</span>
            </div>
            <p className="font-display text-base font-semibold text-slate-950">
              {MERCHANT_INFO.legalName}
            </p>
            <p className="text-xs text-slate-600">
              Owner &amp; Operator of {MERCHANT_INFO.brandName}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
              <Globe className="h-4 w-4 text-blue-800" aria-hidden="true" />
              <span>Official Website</span>
            </div>
            <p className="font-mono text-xs sm:text-sm font-semibold text-slate-950 break-all">
              <a
                href={MERCHANT_INFO.websiteUrl}
                className="text-blue-800 hover:text-blue-950 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 rounded"
              >
                {MERCHANT_INFO.websiteUrl}
              </a>
            </p>
            <p className="text-xs text-slate-600">Web Workbench &amp; REST API</p>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="contact-support-guide-heading"
        className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 space-y-4"
      >
        <h2
          id="contact-support-guide-heading"
          className="font-display text-lg font-semibold text-slate-950"
        >
          Billing, Account &amp; Policy Resources
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 text-sm text-slate-700">
          <div className="rounded-xl border border-slate-200 p-4 space-y-2.5">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-blue-800" aria-hidden="true" />
              <h3 className="font-display text-sm font-semibold text-slate-950">
                Payment &amp; Subscription Verification
              </h3>
            </div>
            <p className="text-xs leading-relaxed text-slate-600">
              Check live Cashfree order (<code className="font-mono text-slate-800">cd_ord_...</code>) or subscription (<code className="font-mono text-slate-800">cd_sub_...</code>) status, reconcile pending credits, or cancel monthly auto-renewal directly inside{' '}
              <AppLink
                to="/dashboard/billing"
                onNavigate={onNavigate}
                className="font-medium text-blue-800 hover:underline"
              >
                Dashboard → Credits &amp; Billing
              </AppLink>
              .
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 p-4 space-y-2.5">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-blue-800" aria-hidden="true" />
              <h3 className="font-display text-sm font-semibold text-slate-950">
                Account Deletion &amp; Legal Policies
              </h3>
            </div>
            <p className="text-xs leading-relaxed text-slate-600">
              Signed-in users can submit account deletion requests under{' '}
              <AppLink
                to="/dashboard/settings"
                onNavigate={onNavigate}
                className="font-medium text-blue-800 hover:underline"
              >
                Dashboard → Settings
              </AppLink>{' '}
              or review our{' '}
              <AppLink
                to="/refund-policy"
                onNavigate={onNavigate}
                className="font-medium text-blue-800 hover:underline"
              >
                Refund &amp; Cancellation Policy
              </AppLink>
              ,{' '}
              <AppLink
                to="/privacy"
                onNavigate={onNavigate}
                className="font-medium text-blue-800 hover:underline"
              >
                Privacy Policy
              </AppLink>
              , and{' '}
              <AppLink
                to="/terms"
                onNavigate={onNavigate}
                className="font-medium text-blue-800 hover:underline"
              >
                Terms &amp; Conditions
              </AppLink>
              .
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
