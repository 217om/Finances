// Turn a flat list of transactions into the high-level, per-month picture the
// user actually cares about: money in, money out, and the net each month, plus
// simple trend signals over the whole history.

import type { MonthlySummary, Transaction } from '../types';

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
  sources: SourceSummary[];
  txCount: number;
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
      s = { month: key, income: 0, expenses: 0, net: 0, txCount: 0 };
      map.set(key, s);
    }
    if (t.amount >= 0) s.income += t.amount;
    else s.expenses += -t.amount;
    s.net = s.income - s.expenses;
    s.txCount++;
  }

  const present = [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
  if (present.length === 0) return [];

  // Fill gaps so a month with no statement shows as a flat zero rather than
  // silently collapsing the time axis.
  const all = monthsBetween(present[0].month, present[present.length - 1].month);
  return all.map(
    (m) => map.get(m) ?? { month: m, income: 0, expenses: 0, net: 0, txCount: 0 },
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
