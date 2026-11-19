import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Save, Trash2 } from 'lucide-react';
import { useAuth, type UserPreferences } from '../lib/auth/AuthContext';
import type { SupportedPhoneRegion } from '../lib/cleaner/types';
import type { AppRoute } from '../lib/router';

interface SettingsPageProps {
  onNavigate: (to: AppRoute) => void;
}

const PHONE_REGIONS: Array<{ value: SupportedPhoneRegion; label: string }> = [
  { value: 'IN', label: 'India (+91 / IN)' },
  { value: 'US', label: 'United States (+1 / US)' },
  { value: 'GB', label: 'United Kingdom (+44 / GB)' },
  { value: 'AU', label: 'Australia (+61 / AU)' },
  { value: 'SG', label: 'Singapore (+65 / SG)' },
  { value: 'AE', label: 'UAE (+971 / AE)' },
  { value: 'CA', label: 'Canada (+1 / CA)' },
  { value: 'DE', label: 'Germany (+49 / DE)' },
];

export const SettingsPage: React.FC<SettingsPageProps> = ({ onNavigate }) => {
  const {
    isConfigured,
    isLoading,
    user,
    profile,
    preferences,
    updateProfile,
    updatePreferences,
    requestAccountDeletion,
  } = useAuth();

  const [fullName, setFullName] = useState('');
  const [prefs, setPrefs] = useState<UserPreferences>(preferences);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const [prefsNotice, setPrefsNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);

  useEffect(() => {
    if (isConfigured && !isLoading && !user) {
      onNavigate('/auth');
    }
  }, [isConfigured, isLoading, user, onNavigate]);

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name ?? '');
    }
  }, [profile]);

  useEffect(() => {
    setPrefs(preferences);
  }, [preferences]);

  if (!isConfigured || isLoading || !user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="h-40 animate-pulse rounded-xl bg-slate-200" />
      </div>
    );
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setProfileNotice(null);
    setSavingProfile(true);
    try {
      const res = await updateProfile(fullName);
      if (res.error) setError(res.error);
      else setProfileNotice('Profile saved.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPrefsNotice(null);
    setSavingPrefs(true);
    try {
      const res = await updatePreferences(prefs);
      if (res.error) setError(res.error);
      else setPrefsNotice('Default cleaning preferences saved.');
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleRequestDeletion = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDeleteNotice(null);
    if (deleteConfirmText.trim() !== 'DELETE') {
      setError('Type DELETE exactly to confirm account and data deletion request.');
      return;
    }
    setDeleting(true);
    try {
      const res = await requestAccountDeletion(
        deleteReason.trim() || 'User requested account deletion from Settings.',
      );
      if (res.error) setError(res.error);
      else {
        setDeleteConfirmText('');
        setDeleteNotice(
          'Your account and personal data deletion request has been recorded.',
        );
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-950">
            Account &amp; Cleaning Preferences
          </h1>
          <p className="mt-1 text-xs text-slate-600">
            Manage profile details, default regional rules, and data retention controls.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('/dashboard')}
          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer self-start"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Back to Dashboard</span>
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-900"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Profile Section */}
      <form
        onSubmit={(e) => void handleSaveProfile(e)}
        className="rounded-xl border border-slate-200 bg-white p-6 space-y-4"
      >
        <h2 className="font-display text-base font-semibold text-slate-950">Profile</h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="settings-name" className="block text-xs font-medium text-slate-700">
              Full name
            </label>
            <input
              id="settings-name"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="settings-email" className="block text-xs font-medium text-slate-700">
              Account email
            </label>
            <input
              id="settings-email"
              type="text"
              readOnly
              value={user.email ?? ''}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {profileNotice ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{profileNotice}</span>
            </span>
          ) : (
            <span className="font-mono text-[11px] text-slate-400">ID: {user.id}</span>
          )}
          <button
            type="submit"
            disabled={savingProfile}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-800 cursor-pointer disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{savingProfile ? 'Saving...' : 'Save Profile'}</span>
          </button>
        </div>
      </form>

      {/* Default Cleaning Preferences */}
      <form
        onSubmit={(e) => void handleSavePreferences(e)}
        className="rounded-xl border border-slate-200 bg-white p-6 space-y-5"
      >
        <div>
          <h2 className="font-display text-base font-semibold text-slate-950">
            Default Cleaning Preferences
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            Automatically pre-filled whenever you open the CleanData Studio Workbench while signed
            in.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="pref-dayfirst" className="block text-xs font-medium text-slate-700">
              Ambiguous Date Order
            </label>
            <select
              id="pref-dayfirst"
              value={prefs.dayFirst ? 'dayFirst' : 'monthFirst'}
              onChange={(e) =>
                setPrefs((prev) => ({ ...prev, dayFirst: e.target.value === 'dayFirst' }))
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <option value="dayFirst">DD/MM (Day-first — India/EU)</option>
              <option value="monthFirst">MM/DD (Month-first — US)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="pref-dateformat" className="block text-xs font-medium text-slate-700">
              Target Date Format
            </label>
            <select
              id="pref-dateformat"
              value={prefs.dateFormat}
              onChange={(e) =>
                setPrefs((prev) => ({
                  ...prev,
                  dateFormat: e.target.value as UserPreferences['dateFormat'],
                }))
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <option value="YYYY-MM-DD">YYYY-MM-DD (ISO-8601)</option>
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="pref-phoneregion" className="block text-xs font-medium text-slate-700">
              Default Phone Region
            </label>
            <select
              id="pref-phoneregion"
              value={prefs.phoneRegion}
              onChange={(e) =>
                setPrefs((prev) => ({ ...prev, phoneRegion: e.target.value as SupportedPhoneRegion }))
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              {PHONE_REGIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={prefs.formulaProtection}
            onChange={(e) =>
              setPrefs((prev) => ({ ...prev, formulaProtection: e.target.checked }))
            }
            className="mt-0.5 rounded border-slate-300"
          />
          <span>
            Enable CSV formula-injection protection by default (prefix leading{' '}
            <code className="font-mono">=</code>, <code className="font-mono">+</code>,{' '}
            <code className="font-mono">-</code>, <code className="font-mono">@</code> with an
            apostrophe).
          </span>
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {prefsNotice ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{prefsNotice}</span>
            </span>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={savingPrefs}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-800 cursor-pointer disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{savingPrefs ? 'Saving...' : 'Save Preferences'}</span>
          </button>
        </div>
      </form>

      {/* Account & Data Deletion Request */}
      <form
        onSubmit={(e) => void handleRequestDeletion(e)}
        className="rounded-xl border border-red-200 bg-white p-6 space-y-4"
      >
        <div className="space-y-1">
          <h2 className="font-display text-base font-semibold text-red-900">
            Request Account &amp; Data Deletion
          </h2>
          <p className="text-xs text-slate-600 leading-relaxed">
            Uploaded inputs expire after 24 hours and cleaned outputs expire after 7 days.
            Submitting this request schedules full deletion of your profile, preferences, and job
            metadata.
          </p>
        </div>

        {profile?.deletion_requested_at && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
            Deletion already requested on{' '}
            <span className="font-mono">
              {new Date(profile.deletion_requested_at).toLocaleString()}
            </span>
            .
          </div>
        )}

        {deleteNotice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-950">
            {deleteNotice}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="delete-reason" className="block text-xs font-medium text-slate-700">
              Reason (optional)
            </label>
            <input
              id="delete-reason"
              type="text"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="Completed project"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="delete-confirm" className="block text-xs font-medium text-slate-700">
              Type <span className="font-mono font-bold">DELETE</span> to confirm
            </label>
            <input
              id="delete-confirm"
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={deleting}
          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-4 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100 cursor-pointer disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{deleting ? 'Submitting...' : 'Request Account Deletion'}</span>
        </button>
      </form>
    </div>
  );
};
