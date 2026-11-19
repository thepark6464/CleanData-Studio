import React, { useEffect, useState } from 'react';

export type AppRoute =
  | '/'
  | '/cleaner'
  | '/pricing'
  | '/developers'
  | '/privacy'
  | '/terms'
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
  '/privacy',
  '/terms',
  '/auth',
  '/dashboard',
  '/dashboard/billing',
  '/dashboard/api-keys',
  '/dashboard/settings',
]);

export function normalizeRoute(pathname: string): AppRoute {
  const cleaned = pathname.replace(/\/+$/, '') || '/';
  if (VALID_ROUTES.has(cleaned as AppRoute)) {
    return cleaned as AppRoute;
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
