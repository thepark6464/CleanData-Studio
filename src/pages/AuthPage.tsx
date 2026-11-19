import React, { useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, KeyRound, MailCheck, ShieldCheck } from 'lucide-react';
import { useAuth } from '../lib/auth/AuthContext';
import type { AppRoute } from '../lib/router';

interface AuthPageProps {
  onNavigate: (to: AppRoute) => void;
}

type AuthMode = 'signin' | 'signup' | 'reset';

export const AuthPage: React.FC<AuthPageProps> = ({ onNavigate }) => {
  const {
    isConfigured,
    isLoading,
    user,
    signIn,
    signUp,
    resendVerificationEmail,
    resetPassword,
  } = useAuth();

  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verificationEmailPending, setVerificationEmailPending] = useState<string | null>(null);

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

    setSubmitting(true);
    try {
      if (mode === 'signin') {
        const res = await signIn(trimmedEmail, password);
        if (res.error) {
          setError(res.error);
        } else {
          onNavigate('/dashboard');
        }
      } else if (mode === 'signup') {
        if (!fullName.trim()) {
          setError('Enter your full name to create an account.');
          return;
        }
        const res = await signUp(trimmedEmail, password, fullName);
        if (res.error) {
          setError(res.error);
        } else if (res.requiresEmailVerification) {
          setVerificationEmailPending(trimmedEmail);
          setNotice(
            `Verification link sent to ${trimmedEmail}. Confirm your email address before signing in.`,
          );
        } else {
          onNavigate('/dashboard');
        }
      } else {
        const res = await resetPassword(trimmedEmail);
        if (res.error) {
          setError(res.error);
        } else {
          setNotice(
            `If an account exists for ${trimmedEmail}, a password reset link has been sent.`,
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
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
            <div className="space-y-1.5">
              <h1 className="font-display text-xl font-bold text-slate-950">
                Supabase Authentication Setup Required
              </h1>
              <p className="text-sm text-slate-600 leading-relaxed">
                Browser cleaning works immediately without an account. To enable user sign-in,
                server job history, and saved cleaning preferences, configure{' '}
                <code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">
                  VITE_SUPABASE_URL
                </code>{' '}
                and{' '}
                <code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">
                  VITE_SUPABASE_ANON_KEY
                </code>{' '}
                in your environment and apply the SQL migrations in{' '}
                <code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">
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
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800 cursor-pointer"
            >
              <span>Use Browser Local Cleaner</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!isLoading && user) {
    return (
      <div className="mx-auto max-w-xl px-4 py-14 sm:px-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
            <div>
              <h1 className="font-display text-xl font-bold text-slate-950">
                Signed in to CleanData Studio
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Active session for <span className="font-mono text-slate-900">{user.email}</span>.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => onNavigate('/dashboard')}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800 cursor-pointer"
            >
              <span>Go to Dashboard</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/cleaner')}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <span>Open Cleaner Workbench</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6 sm:py-16">
      <div className="space-y-6 rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-950">
            {mode === 'signin'
              ? 'Sign in to CleanData'
              : mode === 'signup'
              ? 'Create your account'
              : 'Reset your password'}
          </h1>
          <p className="text-xs text-slate-600">
            Access server job history, saved cleaning defaults, and private download links.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Authentication mode"
          className="grid grid-cols-3 rounded-lg bg-slate-100 p-1 text-xs font-medium"
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
            className={`rounded-md py-1.5 transition-colors cursor-pointer ${
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
            className={`rounded-md py-1.5 transition-colors cursor-pointer ${
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
            className={`rounded-md py-1.5 transition-colors cursor-pointer ${
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
            className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {notice && (
          <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-950">
            <div className="flex items-start gap-2">
              <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
              <span>{notice}</span>
            </div>
            {verificationEmailPending && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleResendVerification()}
                className="font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 cursor-pointer disabled:opacity-50"
              >
                Resend verification email
              </button>
            )}
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {mode === 'signup' && (
            <div className="space-y-1.5">
              <label htmlFor="auth-fullname" className="block text-xs font-medium text-slate-700">
                Full name
              </label>
              <input
                id="auth-fullname"
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Aarav Sharma"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="auth-email" className="block text-xs font-medium text-slate-700">
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
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            />
          </div>

          {mode !== 'reset' && (
            <div className="space-y-1.5">
              <label htmlFor="auth-password" className="block text-xs font-medium text-slate-700">
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-60 cursor-pointer"
          >
            <KeyRound className="h-4 w-4" aria-hidden="true" />
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

        <p className="flex items-start gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
          <span>
            Files ≤ 5 MB can always be cleaned locally in your browser without signing in.
          </span>
        </p>
      </div>
    </div>
  );
};
