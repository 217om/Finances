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

// Specific income categories a user can assign (via override or keyword rule).
// 'Income' itself remains the generic default — same relationship as 'Other'
// is to the expense categories above.
export const INCOME_CATEGORIES = [
  'Salary',
  'Bonus',
  'Gift',
  'Refund',
  'Interest',
  'Investment',
  'Other Income',
] as const;

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

/** A regex pattern rendered back into the plain word(s) it matches, for display. */
function patternLabels(re: RegExp): string[] {
  const cleaned = re.source
    .replace(/\\b/g, '')
    .replace(/\\(.)/g, '$1')
    .replace(/[?*+]/g, '');
  return cleaned.split('|').map((s) => s.trim()).filter(Boolean);
}

export interface BuiltInRule {
  category: string;
  keywords: string[];
}

/** The app's built-in keyword-matching logic, read-only, for display in the
 *  Advanced Settings categorization map. Same order and precedence as RULES —
 *  first matching category wins. */
export const BUILT_IN_RULES: BuiltInRule[] = RULES.map((r) => ({
  category: r.category,
  keywords: r.patterns.flatMap(patternLabels),
}));

// Pure functions of the description are memoized: with many years of data the
// same descriptions and signatures are looked up repeatedly across aggregation,
// grouping, and resolution.
const categoryCache = new Map<string, string>();

/** Pick a category for a transaction. Positive amounts are income. */
export function categorize(description: string, amount: number): string {
  if (amount >= 0) return INCOME_CATEGORY;
  const cached = categoryCache.get(description);
  if (cached !== undefined) return cached;
  let result = 'Other';
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(description))) {
      result = rule.category;
      break;
    }
  }
  categoryCache.set(description, result);
  return result;
}

// --- Fuzzy grouping signature -------------------------------------------------

// Noise words that aren't useful for identifying a merchant.
const SIGNATURE_STOP = new Set([
  'pos', 'purchase', 'payment', 'pmt', 'card', 'visa', 'mastercard', 'maestro',
  'debit', 'credit', 'transaction', 'trans', 'txn', 'tran', 'ref', 'reference',
  'online', 'web', 'ecom', 'ecommerce', 'intl', 'international', 'value', 'date',
  'authorisation', 'authorization', 'auth', 'contactless', 'mobile', 'app',
  'aed', 'omr', 'usd', 'eur', 'gbp', 'sar', 'inr',
]);

/** Significant lowercase tokens from a description (drops noise & numbers). */
export function significantTokens(description: string): string[] {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !SIGNATURE_STOP.has(t));
}

/**
 * A stable "merchant signature" used to group similar transactions even when
 * the full descriptions differ (extra branch codes, locations, reference
 * numbers). Bank descriptions usually lead with the merchant name, so the first
 * significant token is the most stable identifier: "ADNOC Petrol" and "ADNOC
 * Petrol Station Marina" both reduce to "adnoc".
 */
const signatureCache = new Map<string, string>();

export function signatureOf(description: string): string {
  const cached = signatureCache.get(description);
  if (cached !== undefined) return cached;
  const toks = significantTokens(description);
  let result: string;
  if (toks.length === 0) {
    const fallback = description.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')[0];
    result = fallback || 'misc';
  } else {
    result = toks[0];
  }
  signatureCache.set(description, result);
  return result;
}

interface MinimalTx {
  id: string;
  description: string;
  amount: number;
}

/**
 * Resolve a transaction's category with precedence:
 *   1. a manual per-transaction override (income or expense)
 *   2. a keyword refinement rule (newest matching one wins — income or expense)
 *   3. a signature rule from the expense categorization wizard (expenses only)
 *   4. the built-in guess (keyword match for expenses, "Income" for income)
 *
 * Signature rules are deliberately expense-only: they're built from grouping
 * expense transactions by merchant signature, and applying one to an income
 * transaction that happens to share a signature (e.g. both containing
 * "Transfer") would be a confusing false positive. Overrides and keyword
 * rules are more surgical/intentional, so they apply regardless of sign.
 *
 * `keywordRules` must be pre-sorted by priority (highest first, ties broken
 * by newest-first) so the first substring match is the highest-priority
 * refinement.
 */
export function resolveCategory(
  tx: MinimalTx,
  rules: Map<string, import('../types').CategoryRule>,
  overrides: Map<string, string>,
  keywordRules: import('../types').KeywordRule[] = [],
): string {
  const o = overrides.get(tx.id);
  if (o) return o;

  const desc = tx.description.toLowerCase();
  for (const kr of keywordRules) {
    if (kr.keyword && desc.includes(kr.keyword)) return kr.category;
  }

  if (tx.amount < 0) {
    const rule = rules.get(signatureOf(tx.description));
    if (rule && !rule.excludedIds.includes(tx.id)) return rule.category;
  }
  return categorize(tx.description, tx.amount);
}

/** Build a resolver closure for the current rules, overrides, and keyword rules. */
export function makeResolver(
  rules: Map<string, import('../types').CategoryRule>,
  overrides: Map<string, string>,
  keywordRules: import('../types').KeywordRule[] = [],
): (tx: MinimalTx) => string {
  const sorted = [...keywordRules].sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1) || b.createdAt - a.createdAt);
  return (tx) => resolveCategory(tx, rules, overrides, sorted);
}

/**
 * Combines a global rule list with a card-specific one, keyed by whatever
 * makes each rule type unique (keyword, signature, or sub-rule id). A
 * card-specific rule shadows a global rule with the same key — its own
 * customization always wins over the shared default.
 */
export function mergeByKey<T>(globalList: T[], cardList: T[], keyFn: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of globalList) map.set(keyFn(item), item);
  for (const item of cardList) map.set(keyFn(item), item);
  return [...map.values()];
}

interface KeywordRanked {
  keyword: string;
  createdAt: number;
}

/**
 * Both keyword rules and per-parent sub-rules resolve the same way: highest
 * priority first (ties broken newest-first), first substring match wins.
 * That means whenever one rule's keyword is a substring of another's, the
 * substring rule — if it has equal or higher priority (evaluated first) —
 * will always match first too, so the longer/narrower rule can never
 * actually apply. `sortedRules` must already be in evaluation order (the
 * same order `makeResolver` and `makeSubResolver` use). Returns the specific
 * rule that shadows `target`, or null if nothing does.
 */
export function findShadowingRule<T extends KeywordRanked>(target: T, sortedRules: T[]): T | null {
  for (const r of sortedRules) {
    if (r.keyword === target.keyword) return null; // reached target's own rank first
    if (target.keyword.includes(r.keyword)) return r;
  }
  return null;
}

// Stable colors so a category looks the same across every chart. Muted,
// earthy tones tuned to sit well on the app's dark charcoal/beige/coral theme.
export const CATEGORY_COLORS: Record<string, string> = {
  Income: '#9CB88F',
  Salary: '#7C9473',
  Bonus: '#C9A227',
  Gift: '#B6798A',
  Refund: '#6E9B8C',
  Interest: '#7C93A3',
  Investment: '#A98BC4',
  'Other Income': '#8FA377',
  Housing: '#A87A5B',
  Groceries: '#8CA69E',
  Dining: '#C1704F',
  Transport: '#6F8FA0',
  Utilities: '#C9A876',
  Shopping: '#B48A9E',
  Health: '#C77B5E',
  Entertainment: '#9B7FAE',
  Travel: '#93A3B0',
  Education: '#A3A25A',
  'Fees & Charges': '#C1584B',
  Transfers: '#8A7A6E',
  Cash: '#B0855A',
  Other: '#7A6F63',
};

// Palette used to give user-created categories a stable, distinct color.
const PALETTE = [
  '#9CB88F', '#C9A227', '#B6798A', '#6E9B8C', '#7C93A3', '#A98BC4', '#A87A5B',
  '#C1704F', '#8CA69E', '#C9A876', '#B48A9E', '#C77B5E', '#93A3B0', '#A3A25A',
  '#C1584B', '#8A7A6E', '#B0855A', '#9B7FAE',
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function categoryColor(category: string): string {
  if (CATEGORY_COLORS[category]) return CATEGORY_COLORS[category];
  // Deterministic color for custom categories so they look consistent.
  return PALETTE[hashString(category) % PALETTE.length];
}

/** Normalize a user-typed category name (trim, collapse spaces, cap length). */
export function normalizeCategoryName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 28);
}
