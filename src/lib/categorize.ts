// Rule-based transaction categorization. Income is decided by sign; expenses
// are matched against keyword rules (first match wins). Keep the vocabulary
// broad and region-aware (incl. Gulf merchants/telecoms) so it works out of the
// box, while staying easy to extend.

export const EXPENSE_CATEGORIES = [
  'Housing',
  'Groceries',
  'Dining',
  'Transport',
  'Utilities',
  'Shopping',
  'Health',
  'Entertainment',
  'Travel',
  'Education',
  'Fees & Charges',
  'Transfers',
  'Cash',
  'Other',
] as const;

export const INCOME_CATEGORY = 'Income';

interface Rule {
  category: string;
  patterns: RegExp[];
}

const RULES: Rule[] = [
  { category: 'Housing', patterns: [/\brent\b/i, /mortgage/i, /landlord/i, /housing/i, /lease/i, /tenanc/i] },
  {
    category: 'Groceries',
    patterns: [/grocer/i, /supermarket/i, /\blulu\b/i, /carrefour/i, /spinney/i, /\bnesto\b/i, /hypermarket/i, /aldi/i, /tesco/i, /sainsbury/i, /walmart/i, /costco/i, /\bmart\b/i],
  },
  {
    category: 'Dining',
    patterns: [/restaurant/i, /\bcafe\b/i, /coffee/i, /starbucks/i, /tim horton/i, /mcdonald/i, /\bkfc\b/i, /burger/i, /pizza/i, /bakery/i, /deliveroo/i, /talabat/i, /zomato/i, /ubereats|uber eats/i, /dining/i, /shawarma/i],
  },
  {
    category: 'Transport',
    patterns: [/\buber\b/i, /careem/i, /\btaxi\b/i, /\blyft\b/i, /fuel/i, /petrol/i, /\badnoc\b/i, /\bshell\b/i, /\bgas\b/i, /\bmetro\b/i, /parking/i, /\btoll\b/i, /\bsalik\b/i, /transport/i],
  },
  {
    category: 'Utilities',
    patterns: [/electric/i, /\bwater\b/i, /utility|utilities/i, /internet/i, /broadband/i, /etisalat/i, /\bdu\b/i, /ooredoo/i, /omantel/i, /vodafone/i, /\bewa\b/i, /\bdewa\b/i, /\bsewa\b/i, /telecom/i, /mobile bill/i, /airtime/i],
  },
  {
    category: 'Health',
    patterns: [/pharmac/i, /hospital/i, /\bclinic\b/i, /medical/i, /dental|dentist/i, /\bdoctor\b/i, /health/i, /\baster\b/i, /\bnmc\b/i, /\bvps\b/i, /optic/i],
  },
  {
    category: 'Entertainment',
    patterns: [/netflix/i, /spotify/i, /youtube/i, /cinema/i, /\bvox\b/i, /\bnovo\b/i, /movie/i, /\bgame\b/i, /playstation/i, /\bxbox\b/i, /disney/i, /prime video/i, /\bosn\b/i, /\bshahid\b/i, /anghami/i],
  },
  {
    category: 'Travel',
    patterns: [/airline/i, /airways/i, /emirates/i, /etihad/i, /flydubai/i, /\bhotel\b/i, /booking\.com/i, /airbnb/i, /expedia/i, /\bflight\b/i, /\btravel\b/i, /\bvisa fee\b/i],
  },
  {
    category: 'Education',
    patterns: [/school/i, /universit/i, /college/i, /tuition/i, /\bcourse\b/i, /udemy/i, /coursera/i, /education/i, /\bbooks?\b/i],
  },
  {
    category: 'Shopping',
    patterns: [/amazon/i, /\bnoon\b/i, /\bikea\b/i, /\bmall\b/i, /\bstore\b/i, /\bshop\b/i, /retail/i, /\bh&m\b/i, /\bzara\b/i, /\bnike\b/i, /apple\.com|apple store/i, /electronic/i, /sharaf/i, /\bsephora\b/i],
  },
  {
    category: 'Fees & Charges',
    patterns: [/\bfee\b/i, /\bfees\b/i, /charge/i, /interest/i, /penalty/i, /\bvat\b/i, /service chg/i, /bank chg/i, /overdraft/i],
  },
  {
    category: 'Transfers',
    patterns: [/transfer/i, /\btrf\b/i, /sent to/i, /received from/i, /\bwire\b/i, /remittance/i, /western union/i, /paypal/i, /\bach\b/i, /\bimps\b/i, /\bupi\b/i],
  },
  { category: 'Cash', patterns: [/\batm\b/i, /cash withdrawal/i, /withdrawal/i, /cash wdl/i] },
];

/** Pick a category for a transaction. Positive amounts are income. */
export function categorize(description: string, amount: number): string {
  if (amount >= 0) return INCOME_CATEGORY;
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(description))) return rule.category;
  }
  return 'Other';
}

// Stable colors so a category looks the same across every chart.
export const CATEGORY_COLORS: Record<string, string> = {
  Income: '#16a34a',
  Housing: '#6366f1',
  Groceries: '#0ea5e9',
  Dining: '#f97316',
  Transport: '#14b8a6',
  Utilities: '#eab308',
  Shopping: '#ec4899',
  Health: '#ef4444',
  Entertainment: '#a855f7',
  Travel: '#06b6d4',
  Education: '#8b5cf6',
  'Fees & Charges': '#dc2626',
  Transfers: '#64748b',
  Cash: '#78716c',
  Other: '#94a3b8',
};

export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? '#94a3b8';
}
