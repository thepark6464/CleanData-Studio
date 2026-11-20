import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured } from '../supabase/client';
import { CleanDataApiClient, getApiBaseUrl } from '../api/client';
import type { SupportedPhoneRegion } from '../cleaner/types';

export interface UserPreferences {
  dayFirst: boolean;
  dateFormat: 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY';
  phoneRegion: SupportedPhoneRegion;
  formulaProtection: boolean;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  dayFirst: true,
  dateFormat: 'YYYY-MM-DD',
  phoneRegion: 'IN',
  formulaProtection: true,
};

export interface UserProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  deletion_requested_at: string | null;
  deletion_reason: string | null;
  created_at: string;
}

export interface CreditWallet {
  user_id: string;
  subscription_balance: number;
  purchased_balance: number;
  subscription_expires_at: string | null;
  purchased_expires_at: string | null;
  updated_at: string;
}

export interface ActivePlanInfo {
  name: string;
  monthly_price: number;
  monthly_credits: number;
  max_file_size_mb: number;
  daily_job_limit: number | null;
  api_access: boolean;
  api_rate_limit_per_min: number;
  status: string;
  provider?: string | null;
  provider_subscription_id?: string | null;
  cancel_at_period_end?: boolean;
  current_period_end: string | null;
}

export interface CleaningJobRecord {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'canceled' | 'expired';
  input_name: string | null;
  input_format: string | null;
  output_format: string;
  rows_processed: number;
  credits_charged: number;
  created_at: string;
  completed_at: string | null;
  input_expires_at: string | null;
  output_expires_at: string | null;
  quality_score: number | null;
}

export interface CreditTransactionRecord {
  id: string;
  amount: number;
  credit_source: 'subscription' | 'purchased';
  transaction_type:
    | 'subscription_grant'
    | 'purchase'
    | 'reserve'
    | 'commit'
    | 'refund'
    | 'expire'
    | 'adjustment';
  reference_id: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface PaymentRecord {
  id: string;
  amount: number;
  currency: string;
  provider: string | null;
  provider_payment_id: string | null;
  kind: 'credit_pack' | 'subscription' | null;
  item_name?: string | null;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  created_at: string;
}

interface AuthContextValue {
  isConfigured: boolean;
  isLoading: boolean;
  isPasswordRecovery: boolean;
  authCallbackError: string | null;
  clearAuthCallbackError: () => void;
  billingError: string | null;
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  wallet: CreditWallet | null;
  activePlan: ActivePlanInfo | null;
  preferences: UserPreferences;
  jobs: CleaningJobRecord[];
  transactions: CreditTransactionRecord[];
  payments: PaymentRecord[];
  isDataLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
  ) => Promise<{ error: string | null; requiresEmailVerification: boolean }>;
  resendVerificationEmail: (email: string) => Promise<{ error: string | null }>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  updateProfile: (fullName: string) => Promise<{ error: string | null }>;
  updatePreferences: (prefs: UserPreferences) => Promise<{ error: string | null }>;
  requestAccountDeletion: (reason: string) => Promise<{ error: string | null }>;
  refreshAccountData: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function detectRecoveryFromUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash.toLowerCase();
  const search = window.location.search.toLowerCase();
  return hash.includes('type=recovery') || search.includes('type=recovery');
}

function extractAuthErrorFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const searchParams = new URLSearchParams(window.location.search);
  const hashRaw = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams = new URLSearchParams(hashRaw);

  const rawDesc =
    searchParams.get('error_description') ||
    hashParams.get('error_description') ||
    searchParams.get('error') ||
    hashParams.get('error');

  if (!rawDesc) return null;
  return rawDesc.replace(/\+/g, ' ');
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isConfigured = isSupabaseConfigured();
  const [isLoading, setIsLoading] = useState<boolean>(isConfigured);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState<boolean>(() =>
    detectRecoveryFromUrl(),
  );
  const [authCallbackError, setAuthCallbackError] = useState<string | null>(() =>
    extractAuthErrorFromUrl(),
  );
  const [isDataLoading, setIsDataLoading] = useState<boolean>(false);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [wallet, setWallet] = useState<CreditWallet | null>(null);
  const [activePlan, setActivePlan] = useState<ActivePlanInfo | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_USER_PREFERENCES);
  const [jobs, setJobs] = useState<CleaningJobRecord[]>([]);
  const [transactions, setTransactions] = useState<CreditTransactionRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [billingError, setBillingError] = useState<string | null>(null);

  const clearAuthCallbackError = useCallback(() => {
    setAuthCallbackError(null);
  }, []);

  const clearAccountData = useCallback(() => {
    setProfile(null);
    setWallet(null);
    setActivePlan(null);
    setPreferences(DEFAULT_USER_PREFERENCES);
    setJobs([]);
    setTransactions([]);
    setPayments([]);
    setBillingError(null);
  }, []);

  const refreshAccountData = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !user) {
      clearAccountData();
      return;
    }

    setIsDataLoading(true);
    try {
      const apiBase = getApiBaseUrl();
      const accessToken = session?.access_token;

      const billingSummaryPromise =
        apiBase && accessToken
          ? new CleanDataApiClient(apiBase, accessToken)
              .getBillingSummary()
              .then((data) => ({ ok: true as const, data }))
              .catch((err: unknown) => ({
                ok: false as const,
                message:
                  err instanceof Error
                    ? err.message
                    : 'Unable to load billing summary from backend.',
              }))
          : Promise.resolve(null);

      const [profileRes, walletRes, prefsRes, subRes, jobsRes, txRes, payRes, backendBilling] =
        await Promise.all([
          supabase
            .from('profiles')
            .select('id, email, full_name, deletion_requested_at, deletion_reason, created_at')
            .eq('id', user.id)
            .maybeSingle(),
          supabase
            .from('credit_wallets')
            .select(
              'user_id, subscription_balance, purchased_balance, subscription_expires_at, purchased_expires_at, updated_at',
            )
            .eq('user_id', user.id)
            .maybeSingle(),
          supabase
            .from('user_preferences')
            .select('preferences_json')
            .eq('user_id', user.id)
            .maybeSingle(),
          supabase
            .from('subscriptions')
            .select(
              'status, provider, provider_subscription_id, cancel_at_period_end, current_period_end, plans(name, monthly_price, monthly_credits, max_file_size_mb, daily_job_limit, api_access, api_rate_limit_per_min)',
            )
            .eq('user_id', user.id)
            .in('status', ['active', 'past_due', 'canceled', 'expired'])
            .order('created_at', { ascending: false })
            .limit(5),
          supabase
            .from('cleaning_jobs')
            .select(
              'id, status, input_name, input_format, output_format, rows_processed, credits_charged, created_at, completed_at, input_expires_at, output_expires_at, cleaning_reports(quality_score)',
            )
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(50),
          supabase
            .from('credit_transactions')
            .select('id, amount, credit_source, transaction_type, reference_id, expires_at, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(50),
          supabase
            .from('payments')
            .select('id, amount, currency, provider, provider_payment_id, kind, status, created_at, credit_packages(name), plans(name)')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(25),
          billingSummaryPromise,
        ]);

      if (profileRes.data) {
        setProfile(profileRes.data as UserProfile);
      } else {
        setProfile({
          id: user.id,
          email: user.email ?? null,
          full_name: (user.user_metadata?.full_name as string | undefined) ?? null,
          deletion_requested_at: null,
          deletion_reason: null,
          created_at: user.created_at,
        });
      }
      if (backendBilling && backendBilling.ok) {
        const b = backendBilling.data;
        setBillingError(null);
        setWallet({
          user_id: user.id,
          subscription_balance: b.wallet.subscription_balance,
          purchased_balance: b.wallet.purchased_balance,
          subscription_expires_at: b.wallet.subscription_expires_at,
          purchased_expires_at: b.wallet.purchased_expires_at,
          updated_at: new Date().toISOString(),
        });
        setActivePlan({
          name: b.subscription.plan_name,
          monthly_price: b.subscription.monthly_price_paise,
          monthly_credits: b.subscription.monthly_credits,
          max_file_size_mb: b.subscription.max_file_size_mb,
          daily_job_limit: b.subscription.daily_job_limit,
          api_access: b.subscription.api_access,
          api_rate_limit_per_min: b.subscription.api_rate_limit_per_min,
          status: b.subscription.status,
          provider: b.subscription.provider ?? 'system',
          provider_subscription_id: b.subscription.provider_subscription_id ?? null,
          cancel_at_period_end: Boolean(b.subscription.cancel_at_period_end),
          current_period_end: b.subscription.current_period_end,
        });
        setTransactions(b.transactions as CreditTransactionRecord[]);
        setPayments(
          b.payments.map((p) => ({
            id: p.id,
            amount: p.amount_paise,
            currency: p.currency,
            provider: p.provider,
            provider_payment_id: p.provider_payment_id,
            kind: p.kind,
            item_name: p.item_name,
            status: p.status,
            created_at: p.created_at,
          })),
        );
      } else {
        if (backendBilling && !backendBilling.ok) {
          setBillingError(backendBilling.message);
        }
        if (walletRes.data) {
          setWallet(walletRes.data as CreditWallet);
        }
        const subRows = Array.isArray(subRes.data) ? subRes.data : [];
        const chosenSub =
          subRows.find((r) => r.status === 'active') ?? (subRows.length > 0 ? subRows[0] : null);
        if (chosenSub && chosenSub.plans) {
          const planRow = Array.isArray(chosenSub.plans) ? chosenSub.plans[0] : chosenSub.plans;
          if (planRow) {
            setActivePlan({
              ...(planRow as Omit<ActivePlanInfo, 'status' | 'current_period_end'>),
              status: chosenSub.status,
              provider: chosenSub.provider ?? 'system',
              provider_subscription_id: chosenSub.provider_subscription_id ?? null,
              cancel_at_period_end: Boolean(chosenSub.cancel_at_period_end),
              current_period_end: chosenSub.current_period_end,
            });
          }
        } else {
          setActivePlan({
            name: 'Free',
            monthly_price: 0,
            monthly_credits: 0,
            max_file_size_mb: 5,
            daily_job_limit: 3,
            api_access: false,
            api_rate_limit_per_min: 0,
            status: 'active',
            provider: 'system',
            provider_subscription_id: null,
            cancel_at_period_end: false,
            current_period_end: null,
          });
        }
        if (txRes.data) {
          setTransactions(txRes.data as CreditTransactionRecord[]);
        }
        if (payRes.data) {
          const mappedPayments = (payRes.data as Array<Record<string, unknown>>).map((row) => {
            const pkg = row.credit_packages as { name?: string } | null;
            const pln = row.plans as { name?: string } | null;
            return {
              id: String(row.id),
              amount: Number(row.amount ?? 0),
              currency: String(row.currency ?? 'INR'),
              provider: (row.provider as string | null) ?? null,
              provider_payment_id: (row.provider_payment_id as string | null) ?? null,
              kind: (row.kind as PaymentRecord['kind']) ?? null,
              item_name: pkg?.name ?? pln?.name ?? null,
              status: row.status as PaymentRecord['status'],
              created_at: String(row.created_at),
            };
          });
          setPayments(mappedPayments);
        }
      }

      if (prefsRes.data && prefsRes.data.preferences_json) {
        const raw = prefsRes.data.preferences_json as Partial<UserPreferences>;
        setPreferences({
          dayFirst: typeof raw.dayFirst === 'boolean' ? raw.dayFirst : true,
          dateFormat: raw.dateFormat ?? 'YYYY-MM-DD',
          phoneRegion: raw.phoneRegion ?? 'IN',
          formulaProtection:
            typeof raw.formulaProtection === 'boolean' ? raw.formulaProtection : true,
        });
      }

      if (jobsRes.data) {
        const mapped: CleaningJobRecord[] = (jobsRes.data as Array<Record<string, unknown>>).map(
          (row) => {
            const reportRel = row.cleaning_reports as
              | { quality_score: number | null }
              | Array<{ quality_score: number | null }>
              | null;
            const score = Array.isArray(reportRel)
              ? reportRel[0]?.quality_score ?? null
              : reportRel?.quality_score ?? null;
            return {
              id: String(row.id),
              status: row.status as CleaningJobRecord['status'],
              input_name: (row.input_name as string | null) ?? 'dataset',
              input_format: (row.input_format as string | null) ?? 'csv',
              output_format: String(row.output_format ?? 'csv'),
              rows_processed: Number(row.rows_processed ?? 0),
              credits_charged: Number(row.credits_charged ?? 0),
              created_at: String(row.created_at),
              completed_at: (row.completed_at as string | null) ?? null,
              input_expires_at: (row.input_expires_at as string | null) ?? null,
              output_expires_at: (row.output_expires_at as string | null) ?? null,
              quality_score: score !== null ? Number(score) : null,
            };
          },
        );
        setJobs(mapped);
      }
    } finally {
      setIsDataLoading(false);
    }
  }, [user, session?.access_token, clearAccountData]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    let mounted = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) {
        setAuthCallbackError(error.message);
      }
      setSession(data.session ?? null);
      setUser(data.session?.user ?? null);
      setIsLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
      } else if (event === 'SIGNED_OUT') {
        setIsPasswordRecovery(false);
      }
      setSession(nextSession ?? null);
      setUser(nextSession?.user ?? null);
      setIsLoading(false);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (user) {
      void refreshAccountData();
    } else {
      clearAccountData();
    }
  }, [user, refreshAccountData, clearAccountData]);

  const signIn = async (email: string, password: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return { error: 'Supabase Auth is not configured in environment variables.' };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? error.message : null };
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      return {
        error: 'Supabase Auth is not configured in environment variables.',
        requiresEmailVerification: false,
      };
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName.trim() },
        emailRedirectTo: `${window.location.origin}/auth`,
      },
    });
    if (error) {
      return { error: error.message, requiresEmailVerification: false };
    }
    const requiresEmailVerification = !data.session;
    return { error: null, requiresEmailVerification };
  };

  const resendVerificationEmail = async (email: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return { error: 'Supabase Auth is not configured.' };
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth` },
    });
    return { error: error ? error.message : null };
  };

  const resetPassword = async (email: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return { error: 'Supabase Auth is not configured.' };
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth`,
    });
    return { error: error ? error.message : null };
  };

  const updatePassword = async (newPassword: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return { error: 'Supabase Auth is not configured.' };
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (!error) {
      setIsPasswordRecovery(false);
    }
    return { error: error ? error.message : null };
  };

  const signOut = async () => {
    const supabase = getSupabaseClient();
    setIsPasswordRecovery(false);
    if (!supabase) {
      clearAccountData();
      return;
    }
    await supabase.auth.signOut();
    clearAccountData();
  };

  const updateProfile = async (fullName: string) => {
    const supabase = getSupabaseClient();
    if (!supabase || !user) return { error: 'Not signed in.' };
    const trimmed = fullName.trim();
    const { error } = await supabase
      .from('profiles')
      .upsert({ id: user.id, email: user.email ?? null, full_name: trimmed }, { onConflict: 'id' });
    if (!error) {
      await refreshAccountData();
    }
    return { error: error ? error.message : null };
  };

  const updatePreferences = async (prefs: UserPreferences) => {
    const supabase = getSupabaseClient();
    if (!supabase || !user) return { error: 'Not signed in.' };
    const { error } = await supabase.from('user_preferences').upsert(
      {
        user_id: user.id,
        preferences_json: prefs,
      },
      { onConflict: 'user_id' },
    );
    if (!error) {
      setPreferences(prefs);
    }
    return { error: error ? error.message : null };
  };

  const requestAccountDeletion = async (reason: string) => {
    const supabase = getSupabaseClient();
    if (!supabase || !user) return { error: 'Not signed in.' };

    const apiBase = getApiBaseUrl();
    if (apiBase && session?.access_token) {
      try {
        const client = new CleanDataApiClient(apiBase, session.access_token);
        await client.requestAccountDeletion(reason);
        await refreshAccountData();
        return { error: null };
      } catch {
        // Fallback directly to authenticated RLS update on profiles
      }
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        deletion_requested_at: new Date().toISOString(),
        deletion_reason: reason.trim().slice(0, 500),
      })
      .eq('id', user.id);

    if (!error) {
      await refreshAccountData();
    }
    return { error: error ? error.message : null };
  };

  return (
    <AuthContext.Provider
      value={{
        isConfigured,
        isLoading,
        isPasswordRecovery,
        authCallbackError,
        clearAuthCallbackError,
        billingError,
        session,
        user,
        profile,
        wallet,
        activePlan,
        preferences,
        jobs,
        transactions,
        payments,
        isDataLoading,
        signIn,
        signUp,
        resendVerificationEmail,
        resetPassword,
        updatePassword,
        signOut,
        updateProfile,
        updatePreferences,
        requestAccountDeletion,
        refreshAccountData,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
