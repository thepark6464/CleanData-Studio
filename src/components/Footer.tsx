import React from 'react';
import { AppLink, type AppRoute } from '../lib/router';

interface FooterProps {
  onNavigate: (to: AppRoute) => void;
}

export const Footer: React.FC<FooterProps> = ({ onNavigate }) => {
  return (
    <footer className="border-t border-slate-200 bg-white py-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <AppLink
            to="/"
            onNavigate={onNavigate}
            className="title-4 inline-block rounded text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
          >
            CleanData Studio
          </AppLink>
          <p className="caption-5 text-slate-500">
            Messy spreadsheets in. Verified datasets out. Browser cleaning executes locally without server uploads.
          </p>
        </div>

        <nav
          aria-label="Footer navigation"
          className="flex flex-wrap items-center gap-x-6 gap-y-2 caption-4 text-slate-600"
        >
          <AppLink
            to="/cleaner"
            onNavigate={onNavigate}
            className="rounded py-1 transition-colors duration-300 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
          >
            Cleaner
          </AppLink>
          <AppLink
            to="/pricing"
            onNavigate={onNavigate}
            className="rounded py-1 transition-colors duration-300 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
          >
            Pricing
          </AppLink>
          <AppLink
            to="/developers"
            onNavigate={onNavigate}
            className="rounded py-1 transition-colors duration-300 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
          >
            Developers
          </AppLink>
          <AppLink
            to="/privacy"
            onNavigate={onNavigate}
            className="rounded py-1 transition-colors duration-300 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
          >
            Privacy policy
          </AppLink>
          <AppLink
            to="/terms"
            onNavigate={onNavigate}
            className="rounded py-1 transition-colors duration-300 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
          >
            Terms
          </AppLink>
        </nav>
      </div>
    </footer>
  );
};
