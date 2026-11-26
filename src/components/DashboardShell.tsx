import React from 'react';
import {
  ArrowRight,
  CreditCard,
  FileSpreadsheet,
  KeyRound,
  LayoutDashboard,
  Settings,
} from 'lucide-react';
import { useAuth } from '../lib/auth/AuthContext';
import { AppLink, type AppRoute } from '../lib/router';

interface DashboardShellProps {
  currentRoute: AppRoute;
  onNavigate: (to: AppRoute) => void;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

const SIDEBAR_ITEMS: Array<{
  to: AppRoute;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { to: '/dashboard/billing', label: 'Billing & Credits', icon: CreditCard },
  { to: '/dashboard/api-keys', label: 'API Keys', icon: KeyRound },
  { to: '/dashboard/settings', label: 'Settings', icon: Settings },
];

export const DashboardShell: React.FC<DashboardShellProps> = ({
  currentRoute,
  onNavigate,
  title,
  subtitle,
  actions,
  children,
}) => {
  const { activePlan, wallet, profile, user } = useAuth();
  const totalCredits =
    (wallet?.subscription_balance ?? 0) + (wallet?.purchased_balance ?? 0);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
        {/* Glass Sidebar Navigation */}
        <aside
          aria-label="Account sections"
          className="lg:col-span-3 lg:sticky lg:top-24 space-y-4"
        >
          <div className="glass-surface rounded-2xl p-3 sm:p-4 space-y-4">
            <div className="hidden lg:block border-b border-slate-200/70 pb-3 px-1">
              <p className="text-xs font-medium text-blue-700">Workspace Account</p>
              <p className="mt-0.5 truncate text-sm font-semibold text-slate-950">
                {profile?.full_name || user?.email || 'Account'}
              </p>
              <p className="truncate font-mono text-[11px] text-slate-500">
                {activePlan?.name ?? 'Free'} · {totalCredits.toLocaleString()} credits
              </p>
            </div>

            <nav className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap lg:flex-col lg:gap-1">
              {SIDEBAR_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = currentRoute === item.to;
                return (
                  <AppLink
                    key={item.to}
                    to={item.to}
                    onNavigate={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={`flex min-h-[42px] items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                      active
                        ? 'bg-gradient-to-r from-blue-600/12 via-blue-500/10 to-violet-500/10 text-blue-900 border border-blue-200/80 shadow-sm'
                        : 'text-slate-600 hover:bg-white/75 hover:text-slate-950 border border-transparent'
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 ${
                        active ? 'text-blue-700' : 'text-slate-500'
                      }`}
                      aria-hidden="true"
                    />
                    <span>{item.label}</span>
                  </AppLink>
                );
              })}
            </nav>

            <div className="hidden lg:block border-t border-slate-200/70 pt-3">
              <AppLink
                to="/cleaner"
                onNavigate={onNavigate}
                className="glass-btn-primary inline-flex min-h-[40px] w-full items-center justify-between rounded-xl px-3.5 py-2 text-xs font-semibold"
              >
                <span className="inline-flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                  <span>Open Cleaner</span>
                </span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </AppLink>
            </div>
          </div>
        </aside>

        {/* Main Content Viewport */}
        <div className="lg:col-span-9 space-y-6">
          <div className="glass-surface rounded-2xl p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1 min-w-0">
                <h1 className="font-display text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
                  {title}
                </h1>
                {subtitle && (
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                    {subtitle}
                  </p>
                )}
              </div>
              {actions && (
                <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>
              )}
            </div>
          </div>

          {children}
        </div>
      </div>
    </div>
  );
};
