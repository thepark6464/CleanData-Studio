import React from 'react';
import { ArrowLeft, FileX } from '@phosphor-icons/react';
import { AppLink, type AppRoute } from '../lib/router';

interface NotFoundPageProps {
  onNavigate: (to: AppRoute) => void;
}

export const NotFoundPage: React.FC<NotFoundPageProps> = ({ onNavigate }) => {
  return (
    <section className="mx-auto flex max-w-3xl flex-col items-start gap-6 px-4 py-20 sm:px-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-8 space-y-6 w-full">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-900">
          <FileX size={24} weight="duotone" aria-hidden="true" />
        </div>

        <div className="space-y-2 max-w-[680px]">
          <p className="caption-3 text-blue-800">Error 404</p>
          <h1 className="heading-3 text-slate-950">Page not found</h1>
          <p className="body-6 text-slate-600">
            The route you requested does not exist in CleanData Studio. Return to the main overview or open the browser cleaner directly.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <AppLink
            to="/"
            onNavigate={onNavigate}
            className="button-md inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-white transition-[background-color,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-slate-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
          >
            <ArrowLeft size={16} weight="bold" aria-hidden="true" />
            <span>Back to home</span>
          </AppLink>
          <AppLink
            to="/cleaner"
            onNavigate={onNavigate}
            className="button-sm inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 transition-[background-color,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-slate-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
          >
            Open browser cleaner
          </AppLink>
        </div>
      </div>
    </section>
  );
};
