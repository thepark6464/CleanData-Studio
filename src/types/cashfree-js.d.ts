declare module '@cashfreepayments/cashfree-js' {
  export interface CashfreeCheckoutResult {
    error?: {
      message?: string;
      code?: string;
    };
    redirect?: boolean;
    paymentDetails?: {
      paymentMessage?: string;
    };
  }

  export interface CashfreeInstance {
    checkout: (options: {
      paymentSessionId: string;
      redirectTarget?: '_self' | '_blank' | '_top' | '_modal' | HTMLElement;
    }) => Promise<CashfreeCheckoutResult>;
    subscriptionsCheckout: (options: {
      subsSessionId: string;
      redirectTarget?: '_self' | '_blank' | '_top';
    }) => Promise<CashfreeCheckoutResult>;
  }

  export function load(options: {
    mode: 'sandbox' | 'production';
  }): Promise<CashfreeInstance | null>;
}
