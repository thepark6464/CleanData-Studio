import React from 'react';
import { MERCHANT_INFO } from '../config/merchant';
import { AppLink, type AppRoute } from '../lib/router';

interface FooterProps {
  onNavigate: (to: AppRoute) => void;
}

const LINK_CLASS =
  'rounded py-1 text-slate-600 transition-colors duration-300 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700';

export const Footer: React.FC<FooterProps> = ({ onNavigate }) => {
  return (
    <footer className="border-t border-slate-200 bg-white py-10 sm:py-12">
      <div className="mx-auto max-w-6xl space-y-8 px-4 sm:px-6">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-12">
          <div className="space-y-3 md:col-span-5">
            <AppLink
              to="/"
              onNavigate={onNavigate}
              className="title-4 inline-block rounded text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
            >
              {MERCHANT_INFO.brandName}
            </AppLink>
            <p className="caption-5 max-w-sm leading-relaxed text-slate-600">
              Deterministic CSV and Excel data cleaning workbench and REST API. Browser cleaning runs locally without server uploads.
            </p>
            <div className="space-y-1 pt-1 text-xs text-slate-600">
              <p>
                Operated by{' '}
                <strong className="font-semibold text-slate-900">{MERCHANT_INFO.legalName}</strong>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:col-span-7">
            <nav aria-label="Product navigation" className="flex flex-col gap-1.5 caption-4">
              <p className="caption-3 text-slate-950 pb-1">Product</p>
              <AppLink to="/cleaner" onNavigate={onNavigate} className={LINK_CLASS}>
                Cleaner
              </AppLink>
              <AppLink to="/pricing" onNavigate={onNavigate} className={LINK_CLASS}>
                Pricing
              </AppLink>
              <AppLink to="/developers" onNavigate={onNavigate} className={LINK_CLASS}>
                Developers
              </AppLink>
              <AppLink to="/dashboard" onNavigate={onNavigate} className={LINK_CLASS}>
                Dashboard
              </AppLink>
            </nav>

            <nav aria-label="Company navigation" className="flex flex-col gap-1.5 caption-4">
              <p className="caption-3 text-slate-950 pb-1">Company</p>
              <AppLink to="/about" onNavigate={onNavigate} className={LINK_CLASS}>
                About Us
              </AppLink>
              <AppLink to="/contact" onNavigate={onNavigate} className={LINK_CLASS}>
                Contact Us
              </AppLink>
            </nav>

            <nav aria-label="Legal navigation" className="flex flex-col gap-1.5 caption-4 col-span-2 sm:col-span-1">
              <p className="caption-3 text-slate-950 pb-1">Legal &amp; Policies</p>
              <AppLink to="/privacy" onNavigate={onNavigate} className={LINK_CLASS}>
                Privacy Policy
              </AppLink>
              <AppLink to="/terms" onNavigate={onNavigate} className={LINK_CLASS}>
                Terms &amp; Conditions
              </AppLink>
              <AppLink to="/refund-policy" onNavigate={onNavigate} className={LINK_CLASS}>
                Refund &amp; Cancellation Policy
              </AppLink>
            </nav>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-100 pt-5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>
            &copy; {new Date().getFullYear()} {MERCHANT_INFO.legalName}. All rights reserved.
          </p>
          <p className="font-mono text-[11px] text-slate-500">
            {MERCHANT_INFO.websiteHost}
          </p>
        </div>
      </div>
    </footer>
  );
};
