// Display formatting helpers.

let currency = 'OMR';

/** Set the currency used by `money()` (persisted by the caller). */
export function setCurrency(code: string): void {
  currency = code;
}

export function getCurrency(): string {
  return currency;
}

const COMMON_CURRENCIES = ['OMR', 'USD', 'EUR', 'GBP', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'CAD', 'AUD', 'JPY', 'INR', 'CHF'];

export function currencyOptions(): string[] {
  return COMMON_CURRENCIES;
}

export function money(n: number, opts: { compact?: boolean; sign?: boolean } = {}): string {
  // In standard mode let the currency decide its natural decimals (e.g. OMR
  // uses 3). In compact mode keep it terse.
  const formatter = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    notation: opts.compact ? 'compact' : 'standard',
    ...(opts.compact ? { maximumFractionDigits: 1 } : {}),
    signDisplay: opts.sign ? 'always' : 'auto',
  });
  return formatter.format(n);
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** "2024-03" -> "Mar 2024". */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** "2024-03" -> "Mar '24" for dense axes. */
export function monthLabelShort(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return `${MONTH_NAMES[m - 1]} '${String(y).slice(2)}`;
}

export function percent(n: number | null, digits = 0): string {
  if (n === null || Number.isNaN(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}
