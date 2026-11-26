import React from 'react';
import { ArrowLeft, FileX } from '@phosphor-icons/react';
import { AppLink, type AppRoute } from '../lib/router';

interface NotFoundPageProps {
  onNavigate: (to: AppRoute) => void;
}

export const NotFoundPage: React.FC<NotFoundPageProps> = ({ onNavigate }) => {
  return (
    <section className="mx-auto flex max-w-3xl flex-col items-start gap-6 px-4 py-20 sm:px-6">
      <div className="glass-surface-elevated rounded-3xl p-8 space-y-6 w-full">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-200/80 bg-white/80 text-blue-700">
          <FileX size={24} weight="duotone" aria-hidden="true" />
        </div>

        <div className="space-y-2 max-w-[680px]">
          <p className="caption-3 text-blue-700">Error 404</p>
          <h1 className="heading-3 text-slate-950">Page not found</h1>
          <p className="body-6 text-slate-600">
            The route you requested does not exist in CleanData Studio. Return to the main overview or open the browser cleaner directly.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <AppLink
            to="/"
            onNavigate={onNavigate}
            className="glass-btn-primary button-sm inline-flex min-h-[42px] items-center gap-2 rounded-xl px-4 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            <ArrowLeft size={16} weight="bold" aria-hidden="true" />
            <span>Back to home</span>
          </AppLink>
          <AppLink
            to="/cleaner"
            onNavigate={onNavigate}
            className="glass-btn-secondary button-sm inline-flex min-h-[42px] items-center rounded-xl px-4 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            Open browser cleaner
          </AppLink>
        </div>
      </div>
    </section>
  );
};
