// Turn a flat list of transactions into the high-level, per-month picture the
// user actually cares about: money in, money out, and the net each month, plus
// simple trend signals over the whole history.

import type { MonthlySummary, Transaction } from '../types';
import { categorize } from './categorize';

/** A function that returns the category for a transaction. */
export type CategoryOf = (tx: Transaction) => string;

const defaultCategoryOf: CategoryOf = (t) => categorize(t.description, t.amount);

export interface SourceSummary {
  source: string;
  count: number;
  firstDate: string;
  lastDate: string;
}

export interface Overview {
  months: MonthlySummary[]; // chronological, gap-filled
  totalIncome: number;
  totalExpenses: number;
  totalNet: number;
  avgMonthlyNet: number;
  avgMonthlyIncome: number;
  avgMonthlyExpenses: number;
  bestMonth: MonthlySummary | null;
  worstMonth: MonthlySummary | null;
  savingsRate: number; // totalNet / totalIncome
  /** % change of the trailing 6-month avg net vs the prior 6 months. */
  netTrendPct: number | null;
  /** The most recent calendar month with activity, and the one right before
   *  it (possibly a quiet, zero-activity month) — for a simple "vs last
   *  month" comparison, distinct from the longer 6-month trend above. */
  latestMonth: MonthlySummary | null;
  priorMonth: MonthlySummary | null;
  monthChangePct: number | null;
  /** Same idea, one week at a time. */
  latestWeek: MonthlySummary | null;
  priorWeek: MonthlySummary | null;
  weekChangePct: number | null;
  sources: SourceSummary[];
  txCount: number;
}

export function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  // Guard against pathological ranges (>1200 months).
  for (let i = 0; i < 1200 && cur <= end; i++) {
    out.push(cur);
    cur = addMonths(cur, 1);
  }
  return out;
}

/**
 * Which monthly period a date belongs to, given the day the user's month starts
 * on (1 = normal calendar months). With startDay = 25, a transaction dated the
 * 25th or later belongs to the period that *starts* that month; an earlier date
 * belongs to the period that started the previous month. The period is labelled
 * by the calendar month it starts in — i.e. the month that "starts on the 25th".
 */
export function periodKey(dateISO: string, startDay: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const ym = `${y}-${String(m).padStart(2, '0')}`;
  if (startDay <= 1 || d >= startDay) return ym;
  return addMonths(ym, -1);
}

function emptySummary(key: string): MonthlySummary {
  return { month: key, income: 0, expenses: 0, net: 0, txCount: 0, categories: {} };
}

/** Bucket transactions by an arbitrary string key (a day, a week-start, a pay-cycle month). */
function bucketTransactions(
  txs: Transaction[],
  keyOf: (t: Transaction) => string,
  categoryOf: CategoryOf,
): Map<string, MonthlySummary> {
  const map = new Map<string, MonthlySummary>();
  for (const t of txs) {
    const key = keyOf(t);
    let s = map.get(key);
    if (!s) {
      s = emptySummary(key);
      map.set(key, s);
    }
    if (t.amount >= 0) {
      s.income += t.amount;
    } else {
      s.expenses += -t.amount;
      const cat = categoryOf(t);
      s.categories[cat] = (s.categories[cat] ?? 0) + -t.amount;
    }
    s.net = s.income - s.expenses;
    s.txCount++;
  }
  return map;
}

/** Group transactions into per-period income / expense / net buckets. */
export function summarizeByMonth(
  txs: Transaction[],
  startDay = 1,
  categoryOf: CategoryOf = defaultCategoryOf,
): MonthlySummary[] {
  const map = bucketTransactions(txs, (t) => periodKey(t.date, startDay), categoryOf);

  const present = [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
  if (present.length === 0) return [];

  // Fill gaps so a month with no statement shows as a flat zero rather than
  // silently collapsing the time axis.
  const all = monthsBetween(present[0].month, present[present.length - 1].month);
  return all.map((m) => map.get(m) ?? emptySummary(m));
}

// --- Day / week bucketing (for the chart's granularity toggle) --------------

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toUTC(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function addDays(iso: string, delta: number): string {
  const d = toUTC(iso);
  d.setUTCDate(d.getUTCDate() + delta);
  return fromUTC(d);
}

/** The start of the week containing this date, given the day the user's week
 *  starts on (0 = Sunday .. 6 = Saturday, matching Date#getUTCDay). Defaults
 *  to Monday, the app's original hardcoded behavior. */
export function startOfWeek(iso: string, weekStartDay = 1): string {
  const d = toUTC(iso);
  const day = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const sinceStart = (day - weekStartDay + 7) % 7;
  d.setUTCDate(d.getUTCDate() - sinceStart);
  return fromUTC(d);
}

function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  // Guard against pathological ranges (>20 years of days).
  for (let i = 0; i < 7305 && cur <= end; i++) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

function weeksBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  // Guard against pathological ranges (>60 years of weeks).
  for (let i = 0; i < 3130 && cur <= end; i++) {
    out.push(cur);
    cur = addDays(cur, 7);
  }
  return out;
}

/** Group transactions per calendar day, gap-filled so quiet days show as zero. */
export function summarizeByDay(
  txs: Transaction[],
  categoryOf: CategoryOf = defaultCategoryOf,
): MonthlySummary[] {
  const map = bucketTransactions(txs, (t) => t.date, categoryOf);
  const present = [...map.keys()].sort();
  if (present.length === 0) return [];
  const all = daysBetween(present[0], present[present.length - 1]);
  return all.map((d) => map.get(d) ?? emptySummary(d));
}

/** Group transactions per week (starting on `weekStartDay`), gap-filled so
 *  quiet weeks show as zero. */
export function summarizeByWeek(
  txs: Transaction[],
  weekStartDay = 1,
  categoryOf: CategoryOf = defaultCategoryOf,
): MonthlySummary[] {
  const map = bucketTransactions(txs, (t) => startOfWeek(t.date, weekStartDay), categoryOf);
  const present = [...map.keys()].sort();
  if (present.length === 0) return [];
  const all = weeksBetween(present[0], present[present.length - 1]);
  return all.map((w) => map.get(w) ?? emptySummary(w));
}

function summarizeSources(txs: Transaction[]): SourceSummary[] {
  const map = new Map<string, SourceSummary>();
  for (const t of txs) {
    let s = map.get(t.source);
    if (!s) {
      s = { source: t.source, count: 0, firstDate: t.date, lastDate: t.date };
      map.set(t.source, s);
    }
    s.count++;
    if (t.date < s.firstDate) s.firstDate = t.date;
    if (t.date > s.lastDate) s.lastDate = t.date;
  }
  return [...map.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Sum each category's expense across a set of months (e.g. the visible range). */
export function categoryTotals(months: MonthlySummary[]): { category: string; amount: number }[] {
  const totals: Record<string, number> = {};
  for (const m of months) {
    for (const [cat, amt] of Object.entries(m.categories)) {
      totals[cat] = (totals[cat] ?? 0) + amt;
    }
  }
  return Object.entries(totals)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/** The change from `prior` to `latest`, as a % of `prior`'s magnitude — null
 *  when either side is missing or prior is exactly zero (nothing to compare
 *  a percentage against). */
function changePct(latest: MonthlySummary | null, prior: MonthlySummary | null): number | null {
  if (!latest || !prior || prior.net === 0) return null;
  return ((latest.net - prior.net) / Math.abs(prior.net)) * 100;
}

/** Compute the whole-history overview from a flat transaction list. */
export function buildOverview(
  txs: Transaction[],
  startDay = 1,
  categoryOf: CategoryOf = defaultCategoryOf,
  weekStartDay = 1,
): Overview {
  const months = summarizeByMonth(txs, startDay, categoryOf);
  const active = months.filter((m) => m.txCount > 0);

  const totalIncome = active.reduce((a, m) => a + m.income, 0);
  const totalExpenses = active.reduce((a, m) => a + m.expenses, 0);
  const totalNet = totalIncome - totalExpenses;

  const bestMonth = active.reduce<typeof active[number] | null>(
    (best, m) => (best === null || m.net > best.net ? m : best),
    null,
  );
  const worstMonth = active.reduce<typeof active[number] | null>(
    (worst, m) => (worst === null || m.net < worst.net ? m : worst),
    null,
  );

  // Trend: trailing 6 active months vs the 6 before them.
  let netTrendPct: number | null = null;
  if (active.length >= 4) {
    const recent = active.slice(-6);
    const prior = active.slice(-12, -6);
    if (prior.length > 0) {
      const recentAvg = average(recent.map((m) => m.net));
      const priorAvg = average(prior.map((m) => m.net));
      if (priorAvg !== 0) netTrendPct = ((recentAvg - priorAvg) / Math.abs(priorAvg)) * 100;
    }
  }

  // The gap-filled arrays' last entry is always a real (non-empty) period by
  // construction (see summarizeByMonth/summarizeByWeek) — the one before it
  // may be a genuine quiet stretch with no activity at all.
  const latestMonth = months.length > 0 ? months[months.length - 1] : null;
  const priorMonth = months.length > 1 ? months[months.length - 2] : null;
  const weeks = summarizeByWeek(txs, weekStartDay, categoryOf);
  const latestWeek = weeks.length > 0 ? weeks[weeks.length - 1] : null;
  const priorWeek = weeks.length > 1 ? weeks[weeks.length - 2] : null;

  return {
    months,
    totalIncome,
    totalExpenses,
    totalNet,
    avgMonthlyNet: average(active.map((m) => m.net)),
    avgMonthlyIncome: average(active.map((m) => m.income)),
    avgMonthlyExpenses: average(active.map((m) => m.expenses)),
    bestMonth,
    worstMonth,
    savingsRate: totalIncome > 0 ? (totalNet / totalIncome) * 100 : 0,
    netTrendPct,
    latestMonth,
    priorMonth,
    monthChangePct: changePct(latestMonth, priorMonth),
    latestWeek,
    priorWeek,
    weekChangePct: changePct(latestWeek, priorWeek),
    sources: summarizeSources(txs),
    txCount: txs.length,
  };
}

/** Attach a centered/ trailing 3-month moving average of net to each month. */
export function withMovingAverage(
  months: MonthlySummary[],
): (MonthlySummary & { netMA: number | null })[] {
  return months.map((m, i) => {
    if (i < 2) return { ...m, netMA: null };
    const window = months.slice(i - 2, i + 1);
    const ma = window.reduce((a, x) => a + x.net, 0) / window.length;
    return { ...m, netMA: ma };
  });
}
