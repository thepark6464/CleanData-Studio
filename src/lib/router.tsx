import React, { useEffect, useState } from 'react';

export type AppRoute =
  | '/'
  | '/cleaner'
  | '/pricing'
  | '/developers'
  | '/about'
  | '/contact'
  | '/privacy'
  | '/terms'
  | '/refund-policy'
  | '/auth'
  | '/dashboard'
  | '/dashboard/billing'
  | '/dashboard/api-keys'
  | '/dashboard/settings'
  | '/404';

const VALID_ROUTES = new Set<AppRoute>([
  '/',
  '/cleaner',
  '/pricing',
  '/developers',
  '/about',
  '/contact',
  '/privacy',
  '/terms',
  '/refund-policy',
  '/auth',
  '/dashboard',
  '/dashboard/billing',
  '/dashboard/api-keys',
  '/dashboard/settings',
]);

const ROUTE_ALIASES: Record<string, AppRoute> = {
  '/login': '/auth',
  '/signin': '/auth',
  '/signup': '/auth',
  '/register': '/auth',
  '/forgot-password': '/auth',
  '/reset-password': '/auth',
  '/auth/callback': '/auth',
  '/settings': '/dashboard/settings',
  '/billing': '/dashboard/billing',
  '/api-keys': '/dashboard/api-keys',
  '/about-us': '/about',
  '/contact-us': '/contact',
  '/support': '/contact',
  '/privacy-policy': '/privacy',
  '/terms-and-conditions': '/terms',
  '/terms-of-service': '/terms',
  '/refunds': '/refund-policy',
  '/refund': '/refund-policy',
  '/refund-and-cancellation-policy': '/refund-policy',
  '/cancellation-policy': '/refund-policy',
};

const INTENDED_ROUTE_KEY = 'cleandata_intended_route';

export function setIntendedRoute(route: AppRoute): void {
  if (typeof window === 'undefined') return;
  if (route === '/auth' || route === '/404') return;
  try {
    window.sessionStorage.setItem(INTENDED_ROUTE_KEY, route);
  } catch {
    // Ignore storage errors in restricted environments
  }
}

export function consumeIntendedRoute(fallback: AppRoute = '/dashboard'): AppRoute {
  if (typeof window === 'undefined') return fallback;
  try {
    const saved = window.sessionStorage.getItem(INTENDED_ROUTE_KEY);
    window.sessionStorage.removeItem(INTENDED_ROUTE_KEY);
    if (saved && VALID_ROUTES.has(saved as AppRoute) && saved !== '/auth') {
      return saved as AppRoute;
    }
  } catch {
    // Ignore storage errors
  }
  return fallback;
}

export function normalizeRoute(pathname: string): AppRoute {
  const cleaned = pathname.replace(/\/+$/, '') || '/';
  if (VALID_ROUTES.has(cleaned as AppRoute)) {
    return cleaned as AppRoute;
  }
  if (cleaned in ROUTE_ALIASES) {
    return ROUTE_ALIASES[cleaned];
  }
  return '/404';
}

export function useAppRouter() {
  const [route, setRoute] = useState<AppRoute>(() =>
    normalizeRoute(typeof window !== 'undefined' ? window.location.pathname : '/'),
  );

  useEffect(() => {
    const handlePopState = () => {
      setRoute(normalizeRoute(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (to: AppRoute) => {
    if (to === route) return;
    window.history.pushState({}, '', to);
    setRoute(to);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return { route, navigate };
}

interface AppLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  to: AppRoute;
  onNavigate: (to: AppRoute) => void;
}

export const AppLink: React.FC<AppLinkProps> = ({
  to,
  onNavigate,
  onClick,
  children,
  ...rest
}) => {
  return (
    <a
      href={to}
      onClick={(e) => {
        if (onClick) onClick(e);
        if (
          e.defaultPrevented ||
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey
        ) {
          return;
        }
        e.preventDefault();
        onNavigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
};
