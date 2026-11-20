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
  { to: '/privacy', label: 'Privacy' },
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
      <header className="sticky top-0 z-40 px-4 pt-4">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white/85 p-2 backdrop-blur-md">
          <AppLink
            to="/"
            onNavigate={(to) => {
              setMobileOpen(false);
              setMenuOpen(false);
              onNavigate(to);
            }}
            className="title-4 inline-flex items-center gap-2 rounded-lg px-2 py-2 text-slate-950 whitespace-nowrap shrink-0 transition-colors duration-300 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
          >
            <svg
              className="h-5 w-5 shrink-0"
              viewBox="0 0 32 32"
              fill="none"
              aria-hidden="true"
            >
              <rect width="32" height="32" rx="8" fill="#0F172A" />
              <rect x="7" y="8" width="18" height="4" rx="1.5" fill="#FFFFFF" />
              <rect x="7" y="14" width="12" height="4" rx="1.5" fill="#3B82F6" />
              <rect x="7" y="20" width="18" height="4" rx="1.5" fill="#FFFFFF" />
            </svg>
            <span>CleanData Studio</span>
          </AppLink>

          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-2"
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
                  className={`title-4 rounded-lg px-3 py-2 whitespace-nowrap shrink-0 transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 ${
                    active
                      ? 'bg-slate-100 text-slate-950'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
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
                  className="caption-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-slate-900 transition-colors duration-300 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 cursor-pointer"
                >
                  <UserCircle size={16} weight="fill" className="text-blue-700 shrink-0" aria-hidden="true" />
                  <span className="max-w-[140px] truncate font-mono text-xs">{userEmail}</span>
                  <CaretDown
                    size={12}
                    weight="bold"
                    className={`text-slate-500 transition-transform duration-300 ${
                      menuOpen ? 'rotate-180' : ''
                    }`}
                    aria-hidden="true"
                  />
                </button>

                {menuOpen && (
                  <div
                    role="menu"
                    aria-label="Account options"
                    className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg z-50"
                  >
                    <div className="border-b border-slate-100 px-3 py-2 mb-1">
                      <p className="caption-5 text-emerald-700 font-medium">Signed in</p>
                      <p className="truncate font-mono text-xs font-semibold text-slate-950">
                        {userEmail}
                      </p>
                    </div>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => handleMenuNavigate('/dashboard')}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-950 cursor-pointer"
                    >
                      <Gauge size={15} aria-hidden="true" />
                      <span>Dashboard</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => handleMenuNavigate('/dashboard/settings')}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-950 cursor-pointer"
                    >
                      <GearSix size={15} aria-hidden="true" />
                      <span>Account Settings</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => handleMenuNavigate('/dashboard/billing')}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-950 cursor-pointer"
                    >
                      <CreditCard size={15} aria-hidden="true" />
                      <span>Billing &amp; Credits</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => handleMenuNavigate('/dashboard/api-keys')}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-950 cursor-pointer"
                    >
                      <Key size={15} aria-hidden="true" />
                      <span>API Keys</span>
                    </button>

                    <div className="my-1 border-t border-slate-100" />

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void handleSignOutClick()}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-red-700 hover:bg-red-50 cursor-pointer"
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
              className="button-sm inline-flex items-center justify-center rounded-lg bg-slate-950 px-3 py-2 text-white transition-[background-color,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-slate-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {ctaLabel}
            </button>

            <button
              type="button"
              aria-expanded={mobileOpen}
              aria-controls="mobile-navigation-drawer"
              aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
              onClick={() => setMobileOpen((prev) => !prev)}
              className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-900 transition-colors duration-300 hover:bg-slate-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 md:hidden cursor-pointer"
            >
              <span className="sr-only">Toggle navigation</span>
              <span
                aria-hidden="true"
                className={`absolute h-0.5 w-4 rounded bg-slate-900 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  mobileOpen ? 'translate-y-0 rotate-45' : '-translate-y-1.5 rotate-0'
                }`}
              />
              <span
                aria-hidden="true"
                className={`absolute h-0.5 w-4 rounded bg-slate-900 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  mobileOpen ? 'translate-y-0 -rotate-45' : 'translate-y-1.5 rotate-0'
                }`}
              />
            </button>
          </div>
        </div>
      </header>

      {/* Full height mobile panel */}
      <div
        id="mobile-navigation-drawer"
        aria-hidden={!mobileOpen}
        className={`fixed inset-0 z-30 bg-white/95 backdrop-blur-xl transition-opacity duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] md:hidden ${
          mobileOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <nav
          aria-label="Mobile navigation"
          className="mx-auto flex h-full max-w-4xl flex-col justify-center gap-3 px-6 pt-24 pb-12 overflow-y-auto"
        >
          {isSignedIn && userEmail && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 mb-2">
              <p className="caption-5 text-emerald-700 font-medium">Signed in</p>
              <p className="truncate font-mono text-xs font-semibold text-slate-950">{userEmail}</p>
            </div>
          )}

          {NAV_LINKS.map((link, idx) => {
            const active =
              currentRoute === link.to ||
              (link.to === '/dashboard' && currentRoute.startsWith('/dashboard'));
            const delayMs = Math.min(idx * 60, 360);
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
                className={`heading-5 rounded-xl border px-4 py-3.5 transition-[transform,opacity,background-color] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  mobileOpen ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
                } ${
                  active
                    ? 'border-blue-700 bg-blue-50 text-blue-900'
                    : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50'
                }`}
              >
                {link.label}
              </AppLink>
            );
          })}

          {isSignedIn ? (
            <div className="mt-2 grid grid-cols-2 gap-3">
              <button
                type="button"
                tabIndex={mobileOpen ? 0 : -1}
                onClick={() => handleMenuNavigate('/dashboard/settings')}
                className="button-sm rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 cursor-pointer"
              >
                Account Settings
              </button>
              <button
                type="button"
                tabIndex={mobileOpen ? 0 : -1}
                onClick={() => void handleSignOutClick()}
                className="button-sm rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-800 cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <button
              type="button"
              tabIndex={mobileOpen ? 0 : -1}
              onClick={() => handleMenuNavigate('/auth')}
              className="button-md mt-2 rounded-xl bg-slate-950 px-4 py-3 text-white cursor-pointer"
            >
              Sign in or Create account
            </button>
          )}
        </nav>
      </div>
    </>
  );
};
