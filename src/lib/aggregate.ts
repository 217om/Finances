// Turn a flat list of transactions into the high-level, per-month picture the
// user actually cares about: money in, money out, and the net each month, plus
// simple trend signals over the whole history.

import type { MonthlySummary, Transaction } from '../types';
import { categorize } from './categorize';

export interface SourceSummary {
  source: string;
  count: number;
  firstDate: string;
  lastDate: string;
}

/** A detected recurring payment (subscription/bill) or income (salary). */
export interface RecurringItem {
  label: string;
  kind: 'income' | 'expense';
  category: string;
  /** Typical (median) amount per occurrence, positive number. */
  amount: number;
  /** Number of distinct months it appeared in. */
  months: number;
  lastDate: string;
}

/** A noteworthy observation about the user's months. */
export interface Insight {
  severity: 'good' | 'warn' | 'info';
  title: string;
  detail: string;
  month?: string;
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
  sources: SourceSummary[];
  txCount: number;
  recurring: RecurringItem[];
  recurringExpenseMonthly: number;
  insights: Insight[];
}

function addMonths(ym: string, delta: number): string {
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

/** Group transactions into per-period income / expense / net buckets. */
export function summarizeByMonth(txs: Transaction[], startDay = 1): MonthlySummary[] {
  const map = new Map<string, MonthlySummary>();
  for (const t of txs) {
    const key = periodKey(t.date, startDay);
    let s = map.get(key);
    if (!s) {
      s = { month: key, income: 0, expenses: 0, net: 0, txCount: 0, categories: {} };
      map.set(key, s);
    }
    if (t.amount >= 0) {
      s.income += t.amount;
    } else {
      s.expenses += -t.amount;
      const cat = categorize(t.description, t.amount);
      s.categories[cat] = (s.categories[cat] ?? 0) + -t.amount;
    }
    s.net = s.income - s.expenses;
    s.txCount++;
  }

  const present = [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
  if (present.length === 0) return [];

  // Fill gaps so a month with no statement shows as a flat zero rather than
  // silently collapsing the time axis.
  const all = monthsBetween(present[0].month, present[present.length - 1].month);
  return all.map(
    (m) => map.get(m) ?? { month: m, income: 0, expenses: 0, net: 0, txCount: 0, categories: {} },
  );
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

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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

/** Collapse a description to a stable merchant key (drop digits/punctuation). */
function merchantKey(description: string): string {
  return description
    .toLowerCase()
    .replace(/[0-9]+/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 3)
    .join(' ');
}

/**
 * Detect recurring income/expenses: things that show up in 3+ distinct months
 * with a reasonably consistent amount (e.g. salary, rent, subscriptions).
 */
export function detectRecurring(txs: Transaction[]): RecurringItem[] {
  const groups = new Map<string, { txs: Transaction[]; labels: Map<string, number> }>();
  for (const t of txs) {
    const key = merchantKey(t.description);
    if (key.length < 3) continue;
    let g = groups.get(key);
    if (!g) {
      g = { txs: [], labels: new Map() };
      groups.set(key, g);
    }
    g.txs.push(t);
    g.labels.set(t.description, (g.labels.get(t.description) ?? 0) + 1);
  }

  const items: RecurringItem[] = [];
  for (const g of groups.values()) {
    const monthsSeen = new Set(g.txs.map((t) => t.month));
    if (monthsSeen.size < 3) continue;

    const amounts = g.txs.map((t) => t.amount);
    const med = median(amounts);
    if (med === 0) continue;

    // Require consistency: most occurrences within 30% of the median amount.
    const consistent = amounts.filter((a) => Math.abs(a - med) <= Math.abs(med) * 0.3).length;
    if (consistent / amounts.length < 0.6) continue;

    // Most frequent original description as the display label.
    const label = [...g.labels.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const lastDate = g.txs.reduce((acc, t) => (t.date > acc ? t.date : acc), g.txs[0].date);

    items.push({
      label,
      kind: med >= 0 ? 'income' : 'expense',
      category: categorize(label, med),
      amount: Math.abs(med),
      months: monthsSeen.size,
      lastDate,
    });
  }

  return items.sort((a, b) => b.amount - a.amount);
}

/** Build a short list of plain-language insights about the user's months. */
function buildInsights(active: MonthlySummary[], recurring: RecurringItem[]): Insight[] {
  const insights: Insight[] = [];
  if (active.length === 0) return insights;

  const last = active[active.length - 1];
  const expenseHistory = active.map((m) => m.expenses);
  const medExpense = median(expenseHistory);

  // High-spend month: latest month well above the typical month.
  if (medExpense > 0 && last.expenses >= medExpense * 1.4) {
    const pct = Math.round((last.expenses / medExpense - 1) * 100);
    insights.push({
      severity: 'warn',
      title: `Spending spiked in ${last.month}`,
      detail: `Expenses were ${pct}% above your typical month.`,
      month: last.month,
    });
  }

  // Missing income: income usually present, but not in the latest month.
  const monthsWithIncome = active.filter((m) => m.income > 0).length;
  if (active.length >= 3 && monthsWithIncome / active.length >= 0.6 && last.income === 0) {
    insights.push({
      severity: 'warn',
      title: `No income recorded in ${last.month}`,
      detail: 'You usually have income this time — a statement may be missing or a deposit is late.',
      month: last.month,
    });
  }

  // Negative month: spent more than earned most recently.
  if (last.income > 0 && last.net < 0) {
    insights.push({
      severity: 'warn',
      title: `${last.month} ran at a loss`,
      detail: 'You spent more than you brought in this month.',
      month: last.month,
    });
  }

  // A reassuring note when things look healthy.
  const recentNets = active.slice(-3).map((m) => m.net);
  if (recentNets.length >= 2 && recentNets.every((n) => n > 0)) {
    insights.push({
      severity: 'good',
      title: 'Consistently positive',
      detail: `You've saved money in each of the last ${recentNets.length} months.`,
    });
  }

  // Subscriptions footprint.
  const subs = recurring.filter((r) => r.kind === 'expense');
  if (subs.length >= 2) {
    const monthly = subs.reduce((a, r) => a + r.amount, 0);
    insights.push({
      severity: 'info',
      title: `${subs.length} recurring payments detected`,
      detail: `They add up to about ${monthly.toFixed(0)} per month in regular bills and subscriptions.`,
    });
  }

  return insights;
}

/** Compute the whole-history overview from a flat transaction list. */
export function buildOverview(txs: Transaction[], startDay = 1): Overview {
  const months = summarizeByMonth(txs, startDay);
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

  const recurring = detectRecurring(txs);
  const recurringExpenseMonthly = recurring
    .filter((r) => r.kind === 'expense')
    .reduce((a, r) => a + r.amount, 0);
  const insights = buildInsights(active, recurring);

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
    sources: summarizeSources(txs),
    txCount: txs.length,
    recurring,
    recurringExpenseMonthly,
    insights,
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
