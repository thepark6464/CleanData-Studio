import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  CheckCircle,
  Envelope,
  Eye,
  EyeSlash,
  Key,
  ShieldCheck,
  SignOut,
  WarningCircle,
} from '@phosphor-icons/react';
import { useAuth } from '../lib/auth/AuthContext';
import { consumeIntendedRoute, type AppRoute } from '../lib/router';

interface AuthPageProps {
  onNavigate: (to: AppRoute) => void;
}

type AuthMode = 'signin' | 'signup' | 'reset';

function getInitialAuthMode(): AuthMode {
  if (typeof window === 'undefined') return 'signin';
  const path = window.location.pathname.replace(/\/+$/, '').toLowerCase();
  if (path === '/signup' || path === '/register') return 'signup';
  if (path === '/forgot-password' || path === '/reset-password') return 'reset';
  return 'signin';
}

export const AuthPage: React.FC<AuthPageProps> = ({ onNavigate }) => {
  const {
    isConfigured,
    isLoading,
    isPasswordRecovery,
    authCallbackError,
    clearAuthCallbackError,
    user,
    signIn,
    signUp,
    resendVerificationEmail,
    resetPassword,
    updatePassword,
    signOut,
  } = useAuth();

  const [mode, setMode] = useState<AuthMode>(() => getInitialAuthMode());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verificationEmailPending, setVerificationEmailPending] = useState<string | null>(null);

  useEffect(() => {
    if (authCallbackError) {
      setError(authCallbackError);
      clearAuthCallbackError();
    }
  }, [authCallbackError, clearAuthCallbackError]);

  const handlePasswordRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError('New passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await updatePassword(newPassword);
      if (res.error) {
        setError(res.error);
      } else {
        setNewPassword('');
        setConfirmNewPassword('');
        setNotice('Your password has been updated cleanly.');
        onNavigate('/dashboard');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }

    if (mode !== 'reset' && password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    if (mode === 'signup') {
      if (!fullName.trim()) {
        setError('Enter your full name to create an account.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (mode === 'signin') {
        const res = await signIn(trimmedEmail, password);
        if (res.error) {
          setError(res.error);
          if (res.error.toLowerCase().includes('confirm')) {
            setVerificationEmailPending(trimmedEmail);
          }
        } else {
          onNavigate(consumeIntendedRoute('/dashboard'));
        }
      } else if (mode === 'signup') {
        const res = await signUp(trimmedEmail, password, fullName);
        if (res.error) {
          setError(res.error);
        } else if (res.requiresEmailVerification) {
          setVerificationEmailPending(trimmedEmail);
          setNotice(
            `Verification link sent to ${trimmedEmail}. Confirm your email address before signing in.`,
          );
        } else {
          onNavigate(consumeIntendedRoute('/dashboard'));
        }
      } else {
        const res = await resetPassword(trimmedEmail);
        if (res.error) {
          setError(res.error);
        } else {
          setNotice(
            `If an account exists for ${trimmedEmail}, a password reset link has been sent to your inbox.`,
          );
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    if (!verificationEmailPending) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await resendVerificationEmail(verificationEmailPending);
      if (res.error) {
        setError(res.error);
      } else {
        setNotice(`Verification email re-sent to ${verificationEmailPending}.`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!isConfigured) {
    return (
      <div className="mx-auto max-w-xl px-4 py-14 sm:px-6">
        <div className="glass-surface-elevated rounded-3xl p-6 sm:p-8 space-y-4">
          <div className="flex items-start gap-3">
            <WarningCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
            <div className="space-y-1.5">
              <h1 className="heading-6 text-slate-950">
                Supabase Authentication Setup Required
              </h1>
              <p className="body-6 text-slate-600">
                Browser cleaning works immediately without an account. To enable user sign-in,
                server job history, and saved cleaning preferences, configure{' '}
                <code className="font-mono text-xs bg-white/80 px-1.5 py-0.5 rounded border border-slate-200/80">
                  VITE_SUPABASE_URL
                </code>{' '}
                and{' '}
                <code className="font-mono text-xs bg-white/80 px-1.5 py-0.5 rounded border border-slate-200/80">
                  VITE_SUPABASE_ANON_KEY
                </code>{' '}
                in your environment and apply the SQL migrations in{' '}
                <code className="font-mono text-xs bg-white/80 px-1.5 py-0.5 rounded border border-slate-200/80">
                  supabase/migrations/
                </code>
                .
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => onNavigate('/cleaner')}
              className="glass-btn-primary button-sm inline-flex min-h-[42px] items-center gap-2 rounded-xl px-4 py-2 cursor-pointer"
            >
              <span>Use Browser Local Cleaner</span>
              <ArrowRight size={16} weight="bold" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Password recovery completion view after clicking Supabase reset link
  if (isPasswordRecovery) {
    return (
      <div className="mx-auto max-w-md px-4 py-12 sm:px-6 sm:py-16">
        <div className="glass-surface-elevated space-y-6 rounded-3xl p-6 sm:p-8">
          <div className="space-y-1">
            <p className="caption-3 text-blue-700">Password recovery</p>
            <h1 className="heading-5 text-slate-950">Set a new password</h1>
            <p className="caption-5 text-slate-600">
              Enter and confirm your new password for{' '}
              <span className="font-mono text-slate-900">{user?.email || 'your account'}</span>.
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50/90 p-3 text-xs text-red-900"
            >
              <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-red-700" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {notice && (
            <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/90 p-3 text-xs text-emerald-950">
              <CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-emerald-700" aria-hidden="true" />
              <span>{notice}</span>
            </div>
          )}

          <form onSubmit={(e) => void handlePasswordRecoverySubmit(e)} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="recovery-password" className="block caption-4 text-slate-700">
                New password
              </label>
              <div className="relative">
                <input
                  id="recovery-password"
                  type={showNewPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className="glass-input w-full rounded-xl py-2.5 pl-3.5 pr-10 text-sm placeholder:text-slate-400"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword((prev) => !prev)}
                  aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 hover:text-slate-800 cursor-pointer"
                >
                  {showNewPassword ? <EyeSlash size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="recovery-confirm-password" className="block caption-4 text-slate-700">
                Confirm new password
              </label>
              <input
                id="recovery-confirm-password"
                type={showNewPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={8}
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                placeholder="Re-enter your new password"
                className="glass-input w-full rounded-xl px-3.5 py-2.5 text-sm placeholder:text-slate-400"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="glass-btn-primary button-sm inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl px-4 py-2 disabled:opacity-60 cursor-pointer"
            >
              <Key size={16} weight="bold" aria-hidden="true" />
              <span>{submitting ? 'Updating password...' : 'Update Password'}</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (!isLoading && user) {
    return (
      <div className="mx-auto max-w-xl px-4 py-14 sm:px-6">
        <div className="glass-surface-elevated rounded-3xl p-6 sm:p-8 space-y-5">
          <div className="flex items-start gap-3">
            <CheckCircle size={22} weight="fill" className="mt-0.5 shrink-0 text-emerald-700" aria-hidden="true" />
            <div className="space-y-1">
              <p className="caption-3 text-emerald-800">Authentication Status: Signed In</p>
              <h1 className="heading-6 text-slate-950">
                Signed in to CleanData Studio
              </h1>
              <p className="body-6 text-slate-600">
                Active session for <span className="font-mono text-slate-900">{user.email}</span>
                {user.email_confirmed_at ? ' · Email verified' : ' · Verification pending'}.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => onNavigate('/dashboard')}
              className="glass-btn-primary button-sm inline-flex min-h-[42px] items-center gap-2 rounded-xl px-4 py-2 cursor-pointer"
            >
              <span>Go to Dashboard</span>
              <ArrowRight size={16} weight="bold" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/dashboard/settings')}
              className="glass-btn-secondary button-sm inline-flex min-h-[42px] items-center gap-2 rounded-xl px-3.5 py-2 cursor-pointer"
            >
              <span>Account Settings</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/cleaner')}
              className="glass-btn-secondary button-sm inline-flex min-h-[42px] items-center gap-2 rounded-xl px-3.5 py-2 cursor-pointer"
            >
              <span>Open Cleaner Workbench</span>
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="button-sm inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-red-200 bg-red-50/90 px-3.5 py-2 text-red-800 hover:bg-red-100 cursor-pointer"
            >
              <SignOut size={15} weight="bold" aria-hidden="true" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6 sm:py-16">
      <div className="glass-surface-elevated space-y-6 rounded-3xl p-6 sm:p-8">
        <div className="space-y-1">
          <p className="caption-3 text-blue-700">CleanData Account</p>
          <h1 className="heading-5 text-slate-950">
            {mode === 'signin'
              ? 'Sign in to CleanData'
              : mode === 'signup'
              ? 'Create your account'
              : 'Reset your password'}
          </h1>
          <p className="caption-5 text-slate-600">
            Access server job history, saved cleaning defaults, and private download links.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Authentication mode"
          className="glass-segmented grid grid-cols-3 rounded-xl p-1 caption-4"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signin'}
            onClick={() => {
              setMode('signin');
              setError(null);
              setNotice(null);
            }}
            className={`rounded-lg py-2 transition-all cursor-pointer ${
              mode === 'signin'
                ? 'bg-white text-slate-950 shadow-sm'
                : 'text-slate-600 hover:text-slate-950'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signup'}
            onClick={() => {
              setMode('signup');
              setError(null);
              setNotice(null);
            }}
            className={`rounded-lg py-2 transition-all cursor-pointer ${
              mode === 'signup'
                ? 'bg-white text-slate-950 shadow-sm'
                : 'text-slate-600 hover:text-slate-950'
            }`}
          >
            Sign Up
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'reset'}
            onClick={() => {
              setMode('reset');
              setError(null);
              setNotice(null);
            }}
            className={`rounded-lg py-2 transition-all cursor-pointer ${
              mode === 'reset'
                ? 'bg-white text-slate-950 shadow-sm'
                : 'text-slate-600 hover:text-slate-950'
            }`}
          >
            Reset
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="space-y-2 rounded-xl border border-red-200 bg-red-50/90 p-3 text-xs text-red-900"
          >
            <div className="flex items-start gap-2.5">
              <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-red-700" aria-hidden="true" />
              <span>{error}</span>
            </div>
            {verificationEmailPending && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleResendVerification()}
                className="font-semibold text-red-800 underline underline-offset-2 hover:text-red-950 cursor-pointer disabled:opacity-50"
              >
                Resend verification email
              </button>
            )}
          </div>
        )}

        {notice && (
          <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/90 p-3 text-xs text-emerald-950">
            <div className="flex items-start gap-2">
              <Envelope size={16} weight="fill" className="mt-0.5 shrink-0 text-emerald-700" aria-hidden="true" />
              <span>{notice}</span>
            </div>
            {verificationEmailPending && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleResendVerification()}
                className="font-semibold text-emerald-800 underline underline-offset-2 hover:text-emerald-950 cursor-pointer disabled:opacity-50"
              >
                Resend verification email
              </button>
            )}
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {mode === 'signup' && (
            <div className="space-y-1.5">
              <label htmlFor="auth-fullname" className="block caption-4 text-slate-700">
                Full name
              </label>
              <input
                id="auth-fullname"
                type="text"
                autoComplete="name"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Aarav Sharma"
                className="glass-input w-full rounded-xl px-3.5 py-2.5 text-sm placeholder:text-slate-400"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="auth-email" className="block caption-4 text-slate-700">
              Email address
            </label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.in"
              className="glass-input w-full rounded-xl px-3.5 py-2.5 text-sm placeholder:text-slate-400"
            />
          </div>

          {mode !== 'reset' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="auth-password" className="block caption-4 text-slate-700">
                  Password
                </label>
                {mode === 'signin' && (
                  <button
                    type="button"
                    onClick={() => {
                      setMode('reset');
                      setError(null);
                      setNotice(null);
                    }}
                    className="caption-4 text-blue-700 hover:underline cursor-pointer"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className="glass-input w-full rounded-xl py-2.5 pl-3.5 pr-10 text-sm placeholder:text-slate-400"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 hover:text-slate-800 cursor-pointer"
                >
                  {showPassword ? <EyeSlash size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </div>
            </div>
          )}

          {mode === 'signup' && (
            <div className="space-y-1.5">
              <label htmlFor="auth-confirm-password" className="block caption-4 text-slate-700">
                Confirm password
              </label>
              <div className="relative">
                <input
                  id="auth-confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className="glass-input w-full rounded-xl py-2.5 pl-3.5 pr-10 text-sm placeholder:text-slate-400"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                  aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 hover:text-slate-800 cursor-pointer"
                >
                  {showConfirmPassword ? <EyeSlash size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="glass-btn-primary button-sm inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl px-4 py-2 disabled:opacity-60 cursor-pointer"
          >
            <Key size={16} weight="bold" aria-hidden="true" />
            <span>
              {submitting
                ? 'Please wait...'
                : mode === 'signin'
                ? 'Sign In'
                : mode === 'signup'
                ? 'Create Free Account'
                : 'Send Password Reset Email'}
            </span>
          </button>
        </form>

        <p className="flex items-start gap-2 border-t border-slate-200/70 pt-4 caption-5 text-slate-500">
          <ShieldCheck size={16} weight="fill" className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
          <span>
            Files up to 5 MB can always be cleaned locally in your browser without signing in.
          </span>
        </p>
      </div>
    </div>
  );
};
