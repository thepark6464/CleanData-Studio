import { useRef } from 'react';
import { Footer } from './components/Footer';
import { TopBar } from './components/TopBar';
import { AuthProvider, useAuth } from './lib/auth/AuthContext';
import { useAppRouter } from './lib/router';
import { AboutPage } from './pages/AboutPage';
import { ApiKeysPage } from './pages/ApiKeysPage';
import { AuthPage } from './pages/AuthPage';
import { BillingPage } from './pages/BillingPage';
import { CleanerPage } from './pages/CleanerPage';
import { ContactPage } from './pages/ContactPage';
import { DashboardPage } from './pages/DashboardPage';
import { DevelopersPage } from './pages/DevelopersPage';
import { LandingPage } from './pages/LandingPage';
import { PrivacyPage, RefundPolicyPage, TermsPage } from './pages/LegalPages';
import { NotFoundPage } from './pages/NotFoundPage';
import { PricingPage } from './pages/PricingPage';
import { SettingsPage } from './pages/SettingsPage';

function AppShell() {
  const { route, navigate } = useAppRouter();
  const { user, signOut } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handlePrimaryTopBarAction = () => {
    if (route === '/cleaner') {
      fileInputRef.current?.click();
    } else if (user || route === '/auth') {
      navigate('/cleaner');
    } else {
      navigate('/auth');
    }
  };

  const handleSignOut = async () => {
    await signOut();
    if (route.startsWith('/dashboard')) {
      navigate('/auth');
    } else {
      navigate('/');
    }
  };

  return (
    <div className="flex min-h-screen flex-col overflow-x-clip bg-slate-50 text-slate-900">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-slate-950 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>

      <TopBar
        currentRoute={route}
        onNavigate={navigate}
        onPrimaryAction={handlePrimaryTopBarAction}
        hasDataset={false}
        isSignedIn={Boolean(user)}
        userEmail={user?.email ?? null}
        onSignOut={handleSignOut}
      />

      <main id="main-content" className="flex-1">
        {route === '/' && <LandingPage onNavigate={navigate} />}
        {route === '/cleaner' && <CleanerPage fileInputRef={fileInputRef} />}
        {route === '/pricing' && <PricingPage onNavigate={navigate} />}
        {route === '/developers' && <DevelopersPage onNavigate={navigate} />}
        {route === '/about' && <AboutPage onNavigate={navigate} />}
        {route === '/contact' && <ContactPage onNavigate={navigate} />}
        {route === '/privacy' && <PrivacyPage onNavigate={navigate} />}
        {route === '/terms' && <TermsPage onNavigate={navigate} />}
        {route === '/refund-policy' && <RefundPolicyPage onNavigate={navigate} />}
        {route === '/auth' && <AuthPage onNavigate={navigate} />}
        {route === '/dashboard' && <DashboardPage onNavigate={navigate} />}
        {route === '/dashboard/billing' && <BillingPage onNavigate={navigate} />}
        {route === '/dashboard/api-keys' && <ApiKeysPage onNavigate={navigate} />}
        {route === '/dashboard/settings' && <SettingsPage onNavigate={navigate} />}
        {route === '/404' && <NotFoundPage onNavigate={navigate} />}
      </main>

      <Footer onNavigate={navigate} />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
