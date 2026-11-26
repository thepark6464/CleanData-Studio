import React, { useEffect, useRef, useState } from 'react';
import {
  CaretDown,
  CreditCard,
  Gauge,
  GearSix,
  Key,
  SignOut,
  UserCircle,
} from '@phosphor-icons/react';
import { AppLink, type AppRoute } from '../lib/router';

interface TopBarProps {
  currentRoute: AppRoute;
  onNavigate: (to: AppRoute) => void;
  onPrimaryAction: () => void;
  hasDataset: boolean;
  isSignedIn: boolean;
  userEmail?: string | null;
  onSignOut?: () => Promise<void> | void;
}

const NAV_LINKS: Array<{ to: AppRoute; label: string }> = [
  { to: '/cleaner', label: 'Cleaner' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/developers', label: 'Developers' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/contact', label: 'Contact' },
];

const MOBILE_POLICY_LINKS: Array<{ to: AppRoute; label: string }> = [
  { to: '/about', label: 'About Us' },
  { to: '/privacy', label: 'Privacy Policy' },
  { to: '/terms', label: 'Terms & Conditions' },
  { to: '/refund-policy', label: 'Refund Policy' },
];

export const TopBar: React.FC<TopBarProps> = ({
  currentRoute,
  onNavigate,
  onPrimaryAction,
  hasDataset,
  isSignedIn,
  userEmail,
  onSignOut,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileOpen(false);
        setMenuOpen(false);
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    window.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const ctaLabel =
    currentRoute === '/cleaner'
      ? hasDataset
        ? 'Upload new file'
        : 'Upload file'
      : isSignedIn || currentRoute === '/auth'
      ? 'Open cleaner'
      : 'Sign in';

  const handleMenuNavigate = (to: AppRoute) => {
    setMenuOpen(false);
    setMobileOpen(false);
    onNavigate(to);
  };

  const handleSignOutClick = async () => {
    setMenuOpen(false);
    setMobileOpen(false);
    if (onSignOut) {
      await onSignOut();
    }
  };

  return (
    <>
      <header className="sticky top-0 z-40 px-3 pt-3 sm:px-4 sm:pt-4">
        <div className="glass-nav mx-auto flex w-full max-w-6xl items-center justify-between gap-3 rounded-2xl p-2">
          <AppLink
            to="/"
            onNavigate={(to) => {
              setMobileOpen(false);
              setMenuOpen(false);
              onNavigate(to);
            }}
            className="title-4 inline-flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-slate-950 whitespace-nowrap shrink-0 transition-colors duration-200 hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            <svg
              className="h-6 w-6 shrink-0"
              viewBox="0 0 32 32"
              fill="none"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="cdLogoGrad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#1D4ED8" />
                  <stop offset="55%" stopColor="#2563EB" />
                  <stop offset="100%" stopColor="#7C3AED" />
                </linearGradient>
              </defs>
              <rect width="32" height="32" rx="9" fill="url(#cdLogoGrad)" />
              <rect x="7" y="8.5" width="18" height="3.5" rx="1.5" fill="#FFFFFF" />
              <rect x="7" y="14.25" width="12" height="3.5" rx="1.5" fill="#67E8F9" />
              <rect x="7" y="20" width="18" height="3.5" rx="1.5" fill="#FFFFFF" />
            </svg>
            <span className="font-semibold tracking-tight">CleanData Studio</span>
          </AppLink>

          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-1"
          >
            {NAV_LINKS.map((link) => {
              const active =
                currentRoute === link.to ||
                (link.to === '/dashboard' && currentRoute.startsWith('/dashboard'));
              return (
                <AppLink
                  key={link.to}
                  to={link.to}
                  onNavigate={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={`title-4 rounded-xl px-3 py-2 whitespace-nowrap shrink-0 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
                    active
                      ? 'bg-blue-600/10 text-blue-900 font-semibold shadow-[inset_0_0_0_1px_rgba(37,99,235,0.18)]'
                      : 'text-slate-600 hover:bg-white/75 hover:text-slate-950'
                  }`}
                >
                  {link.label}
                </AppLink>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            {isSignedIn && userEmail && (
              <div ref={menuRef} className="relative hidden sm:block">
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="Account menu"
                  onClick={() => setMenuOpen((prev) => !prev)}
                  className="caption-4 inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-200/80 bg-white/80 px-2.5 py-1.5 text-slate-900 transition-colors duration-200 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 cursor-pointer"
                >
                  <UserCircle size={17} weight="fill" className="text-blue-600 shrink-0" aria-hidden="true" />
                  <span className="max-w-[136px] truncate font-mono text-xs">{userEmail}</span>
                  <CaretDown
                    size={12}
                    weight="bold"
                    className={`text-slate-500 transition-transform duration-200 ${
                      menuOpen ? 'rotate-180' : ''
                    }`}
                    aria-hidden="true"
                  />
                </button>

                {menuOpen && (
                  <div
                    role="menu"
                    aria-label="Account options"
                    className="glass-surface-elevated absolute right-0 mt-2 w-64 rounded-2xl p-2 z-50"
                  >
                    <div className="border-b border-slate-200/70 px-3 py-2 mb-1">
                      <p className="caption-5 text-emerald-700 font-medium">Signed in</p>
                      <p className="truncate font-mono text-xs font-semibold text-slate-950">
                        {userEmail}
                      </p>
                    </div>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => handleMenuNavigate('/dashboard')}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-blue-50/70 hover:text-slate-950 cursor-pointer"
                    >
                      <Gauge size={15} aria-hidden="true" />
                      <span>Dashboard</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => handleMenuNavigate('/dashboard/settings')}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-blue-50/70 hover:text-slate-950 cursor-pointer"
                    >
                      <GearSix size={15} aria-hidden="true" />
                      <span>Account Settings</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => handleMenuNavigate('/dashboard/billing')}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-blue-50/70 hover:text-slate-950 cursor-pointer"
                    >
                      <CreditCard size={15} aria-hidden="true" />
                      <span>Billing &amp; Credits</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => handleMenuNavigate('/dashboard/api-keys')}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-blue-50/70 hover:text-slate-950 cursor-pointer"
                    >
                      <Key size={15} aria-hidden="true" />
                      <span>API Keys</span>
                    </button>

                    <div className="my-1 border-t border-slate-200/70" />

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void handleSignOutClick()}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium text-rose-700 hover:bg-rose-50/80 cursor-pointer"
                    >
                      <SignOut size={15} aria-hidden="true" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setMobileOpen(false);
                setMenuOpen(false);
                onPrimaryAction();
              }}
              className="glass-btn-primary button-sm inline-flex min-h-[38px] items-center justify-center rounded-xl px-3.5 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {ctaLabel}
            </button>

            <button
              type="button"
              aria-expanded={mobileOpen}
              aria-controls="mobile-navigation-drawer"
              aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
              onClick={() => setMobileOpen((prev) => !prev)}
              className="relative inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200/90 bg-white/85 text-slate-900 transition-colors duration-200 hover:bg-white active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 md:hidden cursor-pointer"
            >
              <span className="sr-only">Toggle navigation</span>
              <span
                aria-hidden="true"
                className={`absolute h-0.5 w-4 rounded bg-slate-900 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  mobileOpen ? 'translate-y-0 rotate-45' : '-translate-y-1.5 rotate-0'
                }`}
              />
              <span
                aria-hidden="true"
                className={`absolute h-0.5 w-4 rounded bg-slate-900 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  mobileOpen ? 'translate-y-0 -rotate-45' : 'translate-y-1.5 rotate-0'
                }`}
              />
            </button>
          </div>
        </div>
      </header>

      {/* Full height frosted mobile drawer */}
      <div
        id="mobile-navigation-drawer"
        aria-hidden={!mobileOpen}
        className={`fixed inset-0 z-30 bg-[#f6f8ff]/90 backdrop-blur-2xl transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] md:hidden ${
          mobileOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <nav
          aria-label="Mobile navigation"
          className="mx-auto flex h-full max-w-4xl flex-col justify-center gap-2.5 px-5 pt-24 pb-10 overflow-y-auto"
        >
          {isSignedIn && userEmail && (
            <div className="glass-surface rounded-2xl px-4 py-3 mb-1">
              <p className="caption-5 text-emerald-700 font-medium">Signed in</p>
              <p className="truncate font-mono text-xs font-semibold text-slate-950">{userEmail}</p>
            </div>
          )}

          {NAV_LINKS.map((link, idx) => {
            const active =
              currentRoute === link.to ||
              (link.to === '/dashboard' && currentRoute.startsWith('/dashboard'));
            const delayMs = Math.min(idx * 45, 250);
            return (
              <AppLink
                key={link.to}
                to={link.to}
                tabIndex={mobileOpen ? 0 : -1}
                aria-current={active ? 'page' : undefined}
                onNavigate={(to) => {
                  setMobileOpen(false);
                  onNavigate(to);
                }}
                style={{ transitionDelay: mobileOpen ? `${delayMs}ms` : '0ms' }}
                className={`heading-6 flex min-h-[48px] items-center rounded-2xl border px-4 py-3 transition-[transform,opacity,background-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  mobileOpen ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
                } ${
                  active
                    ? 'border-blue-400/60 bg-blue-600/10 text-blue-950'
                    : 'glass-surface text-slate-900 hover:bg-white'
                }`}
              >
                {link.label}
              </AppLink>
            );
          })}

          <div className="mt-2 grid grid-cols-2 gap-2">
            {MOBILE_POLICY_LINKS.map((link) => (
              <AppLink
                key={link.to}
                to={link.to}
                tabIndex={mobileOpen ? 0 : -1}
                onNavigate={(to) => {
                  setMobileOpen(false);
                  onNavigate(to);
                }}
                className="caption-4 flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 text-center text-slate-700 hover:bg-white"
              >
                {link.label}
              </AppLink>
            ))}
          </div>

          {isSignedIn ? (
            <div className="mt-2 grid grid-cols-2 gap-3">
              <button
                type="button"
                tabIndex={mobileOpen ? 0 : -1}
                onClick={() => handleMenuNavigate('/dashboard/settings')}
                className="glass-btn-secondary button-sm min-h-[44px] rounded-xl px-4 py-3 cursor-pointer"
              >
                Account Settings
              </button>
              <button
                type="button"
                tabIndex={mobileOpen ? 0 : -1}
                onClick={() => void handleSignOutClick()}
                className="button-sm min-h-[44px] rounded-xl border border-rose-200 bg-rose-50/90 px-4 py-3 text-rose-800 cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <button
              type="button"
              tabIndex={mobileOpen ? 0 : -1}
              onClick={() => handleMenuNavigate('/auth')}
              className="glass-btn-primary button-md mt-2 min-h-[48px] rounded-xl px-4 py-3 cursor-pointer"
            >
              Sign in or Create account
            </button>
          )}
        </nav>
      </div>
    </>
  );
};
