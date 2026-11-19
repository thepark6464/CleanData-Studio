export interface PlanConfig {
  id: 'free' | 'starter' | 'pro' | 'business';
  name: string;
  audience: string;
  monthlyPricePaise: number;
  monthlyCredits: number | null;
  dailyJobLimit: number | null;
  maxFileSizeMb: number;
  apiAccess: boolean;
  apiRateLimitPerMin: number;
  exports: string;
  features: string[];
  highlighted?: boolean;
}

export interface CreditPackConfig {
  id: string;
  name: string;
  credits: number;
  pricePaise: number;
  maxRowsEquivalent: number;
}

export const CURRENCY_SYMBOL = '₹';
export const CURRENCY_CODE = 'INR';
export const ROWS_PER_CREDIT = 1000;
export const PURCHASED_CREDIT_EXPIRY_MONTHS = 12;

export function formatInrFromPaise(paise: number): string {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString('en-IN')}`;
}

export function estimateCreditsForRows(rowCount: number): number {
  if (rowCount <= 0) return 0;
  return Math.max(1, Math.ceil(rowCount / ROWS_PER_CREDIT));
}

export const SUBSCRIPTION_PLANS: PlanConfig[] = [
  {
    id: 'free',
    name: 'Free',
    audience: 'For quick individual CSV checks',
    monthlyPricePaise: 0,
    monthlyCredits: null,
    dailyJobLimit: 3,
    maxFileSizeMb: 5,
    apiAccess: false,
    apiRateLimitPerMin: 0,
    exports: 'CSV',
    features: [
      'Unlimited browser cleaning up to 5 MB',
      '3 registered server jobs per day',
      'Core cleaning rules and CSV export',
      'Transparent quality score report',
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    audience: 'For freelancers and recurring spreadsheets',
    monthlyPricePaise: 29900,
    monthlyCredits: 100,
    dailyJobLimit: null,
    maxFileSizeMb: 25,
    apiAccess: false,
    apiRateLimitPerMin: 0,
    exports: 'CSV, XLSX',
    features: [
      '100 monthly credits (up to 100,000 rows)',
      'Up to 25 MB per file upload',
      'Advanced cleaning and multi sheet XLSX export',
      'Saved job history and 7 day retention',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    audience: 'For startups and automated data pipelines',
    monthlyPricePaise: 79900,
    monthlyCredits: 500,
    dailyJobLimit: null,
    maxFileSizeMb: 100,
    apiAccess: true,
    apiRateLimitPerMin: 60,
    exports: 'CSV, XLSX, JSON report',
    highlighted: true,
    features: [
      '500 monthly credits (up to 500,000 rows)',
      'Up to 100 MB per file upload',
      'Full REST API access (60 req/min)',
      'Bulk processing and signed downloads',
    ],
  },
  {
    id: 'business',
    name: 'Business',
    audience: 'For high volume operations and agencies',
    monthlyPricePaise: 199900,
    monthlyCredits: 2000,
    dailyJobLimit: null,
    maxFileSizeMb: 250,
    apiAccess: true,
    apiRateLimitPerMin: 240,
    exports: 'CSV, XLSX, JSON report',
    features: [
      '2,000 monthly credits (up to 2,000,000 rows)',
      'Up to 250 MB per file upload',
      'Higher API rate limits (240 req/min)',
      'Batch processing and priority support',
    ],
  },
];

export const CREDIT_PACKS: CreditPackConfig[] = [
  {
    id: 'pack_10',
    name: '10 Credits',
    credits: 10,
    pricePaise: 4900,
    maxRowsEquivalent: 10000,
  },
  {
    id: 'pack_50',
    name: '50 Credits',
    credits: 50,
    pricePaise: 14900,
    maxRowsEquivalent: 50000,
  },
  {
    id: 'pack_150',
    name: '150 Credits',
    credits: 150,
    pricePaise: 34900,
    maxRowsEquivalent: 150000,
  },
  {
    id: 'pack_500',
    name: '500 Credits',
    credits: 500,
    pricePaise: 89900,
    maxRowsEquivalent: 500000,
  },
];

export const ILLUSTRATIVE_REVENUE_PROJECTIONS = [
  { customers: 10, monthlyRevenuePaise: 499000 },
  { customers: 100, monthlyRevenuePaise: 4990000 },
  { customers: 500, monthlyRevenuePaise: 24950000 },
  { customers: 1000, monthlyRevenuePaise: 49900000 },
];
