// The cash-flow report: each period (a pay-cycle month, or a week) gets its
// own opening balance -> sources of cash -> uses of cash -> closing balance
// breakdown, combined across every card (plus tracked assets).
//
// Opening/closing balances reuse the exact same anchor-plus-forward-sum
// reconstruction the Balances tab already relies on for "current balance"
// (see netWorthAsOf in lib/balances.ts) — just run at each period's
// boundary instead of only "now". That mechanism can only see as far back as
// the earliest known anchor (a statement's own balance column, or a manual
// checkpoint) per card; before that, a card's contribution is unknowable and
// defaults to 0. Rather than hide that, the gap surfaces honestly folded
// into that period's "Other" catch-all (see categoryBreakdown below): it's
// whatever the real observed balance change (closing minus opening, both
// independently reconstructed) doesn't already explain via categorized
// transactions or asset revaluation — so a missing early anchor, an
// uncaptured bank fee, or any other drift all show up there instead of
// silently being absorbed into a named category.

import type { Transaction } from '../types';
import { startOfWeek } from './aggregate';
import { netWorthAsOf, assetsNetAsOf, type Asset, type AssetValueEntry, type BalanceCheckpoint, type CardType } from './balances';
import { adjacentPeriod, cycleBounds, currentCyclePeriod, todayISO } from './budget';
import { addDaysISO } from './rangePresets';
import { dayLabelShort, monthLabel } from './format';

export type SummaryGranularity = 'week' | 'month';

/**
 * Identifies which transactions are salary payments, so Monthly periods can
 * open on the actual day you got paid instead of a fixed day-of-month (see
 * buildSalaryCyclePeriods). A transaction counts as salary when it's
 * categorized as `category` (via categoryOf) AND its amount falls in
 * [minAmount, maxAmount] (either bound optional) — amount is always the
 * transaction's own signed value, so only ever matches positive (incoming)
 * transactions in practice.
 */
export interface SalaryRule {
  category: string;
  minAmount: number | null;
  maxAmount: number | null;
}

export function isValidSalaryRule(x: unknown): x is SalaryRule {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.category === 'string' &&
    r.category.length > 0 &&
    (r.minAmount === null || typeof r.minAmount === 'number') &&
    (r.maxAmount === null || typeof r.maxAmount === 'number')
  );
}

export interface CategoryAmount {
  category: string;
  amount: number;
}

export interface CategoryBreakdown {
  /** Every category's amount, including whatever landed in `otherTotal`. */
  total: number;
  /** Up to TOP_CATEGORY_COUNT categories, sorted by amount descending. */
  top: CategoryAmount[];
  /** Every remaining category beyond `top`, summed into one catch-all —
   *  plus any reconciling gap (see the file header) that moved the balance
   *  in this direction, so `total` always equals top + this exactly, with
   *  nothing left unaccounted for. */
  otherTotal: number;
}

export interface PeriodSummary {
  period: string;
  label: string;
  from: string;
  to: string;
  opening: number;
  openingComplete: boolean;
  closing: number;
  closingComplete: boolean;
  netChange: number;
  assetChange: number;
  sources: CategoryBreakdown;
  uses: CategoryBreakdown;
}

function lastPeriodKey(granularity: SummaryGranularity, monthStartDay: number, weekStartDay: number, today: string): string {
  return granularity === 'week' ? startOfWeek(today, weekStartDay) : currentCyclePeriod(monthStartDay);
}

function stepPeriod(granularity: SummaryGranularity, key: string, delta: number): string {
  return granularity === 'week' ? addDaysISO(key, delta * 7) : adjacentPeriod(key, delta);
}

function periodBounds(granularity: SummaryGranularity, key: string, monthStartDay: number): { from: string; to: string } {
  return granularity === 'week' ? { from: key, to: addDaysISO(key, 6) } : cycleBounds(key, monthStartDay);
}

function periodLabel(granularity: SummaryGranularity, key: string, bounds: { from: string; to: string }): string {
  return granularity === 'week' ? `${dayLabelShort(bounds.from)} – ${dayLabelShort(bounds.to)}` : monthLabel(key);
}

const TOP_CATEGORY_COUNT = 5;

function categoryBreakdown(map: Map<string, number>, gapAdd: number): CategoryBreakdown {
  const sorted = [...map.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
  const top = sorted.slice(0, TOP_CATEGORY_COUNT);
  const rawTotal = sorted.reduce((a, r) => a + r.amount, 0);
  const otherTotal = sorted.slice(TOP_CATEGORY_COUNT).reduce((a, r) => a + r.amount, 0) + gapAdd;
  return { total: rawTotal + gapAdd, top, otherTotal };
}

/** One arbitrary [from, to] range's full opening/closing + sources/uses
 *  breakdown — the shared computation behind both a trailing period (see
 *  computePeriodSummary) and a user-picked custom date range (see
 *  buildCustomRangeSummary). */
function summarizeRange(
  cards: { type: CardType; transactions: Transaction[]; checkpoints: BalanceCheckpoint[] }[],
  assets: Asset[],
  assetValues: AssetValueEntry[],
  transactions: Transaction[],
  categoryOf: (tx: Transaction) => string,
  period: string,
  label: string,
  from: string,
  to: string,
): PeriodSummary {
  const openingAsOf = addDaysISO(from, -1);

  const openingNW = netWorthAsOf(cards, assets, assetValues, openingAsOf);
  const closingNW = netWorthAsOf(cards, assets, assetValues, to);
  const assetChange = assetsNetAsOf(assets, assetValues, to) - assetsNetAsOf(assets, assetValues, openingAsOf);

  const sourceMap = new Map<string, number>();
  const useMap = new Map<string, number>();
  let rawSources = 0;
  let rawUses = 0;
  for (const t of transactions) {
    if (t.date < from || t.date > to || t.amount === 0) continue;
    const cat = categoryOf(t);
    if (t.amount > 0) {
      rawSources += t.amount;
      sourceMap.set(cat, (sourceMap.get(cat) ?? 0) + t.amount);
    } else {
      rawUses += -t.amount;
      useMap.set(cat, (useMap.get(cat) ?? 0) + -t.amount);
    }
  }

  const netChange = closingNW.amount - openingNW.amount;
  const gap = netChange - (rawSources - rawUses) - assetChange;

  return {
    period,
    label,
    from,
    to,
    opening: openingNW.amount,
    openingComplete: openingNW.complete,
    closing: closingNW.amount,
    closingComplete: closingNW.complete,
    netChange,
    assetChange,
    sources: categoryBreakdown(sourceMap, Math.max(gap, 0)),
    uses: categoryBreakdown(useMap, Math.max(-gap, 0)),
  };
}

/** One period's full opening/closing + sources/uses breakdown — the
 *  per-period computation behind buildPeriodBreakdowns. */
function computePeriodSummary(
  cards: { type: CardType; transactions: Transaction[]; checkpoints: BalanceCheckpoint[] }[],
  assets: Asset[],
  assetValues: AssetValueEntry[],
  transactions: Transaction[],
  categoryOf: (tx: Transaction) => string,
  monthStartDay: number,
  granularity: SummaryGranularity,
  key: string,
  today: string,
): PeriodSummary {
  const bounds = periodBounds(granularity, key, monthStartDay);
  // A still-in-progress period's "closing" is as of today, not the full
  // calendar period's end, which hasn't happened yet.
  const to = bounds.to > today ? today : bounds.to;
  return summarizeRange(cards, assets, assetValues, transactions, categoryOf, key, periodLabel(granularity, key, bounds), bounds.from, to);
}

function customRangeLabel(from: string, to: string): string {
  return from === to ? dayLabelShort(from) : `${dayLabelShort(from)} – ${dayLabelShort(to)}`;
}

/**
 * The same opening/closing + sources/uses breakdown as one column of
 * buildPeriodBreakdowns' trend table, but for an arbitrary user-picked
 * [from, to] range instead of a trailing pay-cycle month or week — lets the
 * report answer "what happened between these two exact dates" directly.
 * `to` is clamped to today if it's in the future; `from`/`to` are swapped if
 * given in reverse order.
 */
export function buildCustomRangeSummary(
  cards: { type: CardType; transactions: Transaction[]; checkpoints: BalanceCheckpoint[] }[],
  assets: Asset[],
  assetValues: AssetValueEntry[],
  transactions: Transaction[],
  categoryOf: (tx: Transaction) => string,
  from: string,
  to: string,
): PeriodSummary {
  const today = todayISO();
  const lo = from <= to ? from : to;
  const hiRaw = from <= to ? to : from;
  const hi = hiRaw > today ? today : hiRaw;
  return summarizeRange(cards, assets, assetValues, transactions, categoryOf, `${lo}_${hi}`, customRangeLabel(lo, hi), lo, hi);
}

function hasAnyData(
  cards: { checkpoints: BalanceCheckpoint[] }[],
  assets: Asset[],
  transactions: Transaction[],
): boolean {
  return transactions.length > 0 || cards.some((c) => c.checkpoints.length > 0) || assets.length > 0;
}

function matchesSalaryRule(t: Transaction, categoryOf: (tx: Transaction) => string, rule: SalaryRule): boolean {
  if (t.amount <= 0) return false;
  if (categoryOf(t) !== rule.category) return false;
  if (rule.minAmount != null && t.amount < rule.minAmount) return false;
  if (rule.maxAmount != null && t.amount > rule.maxAmount) return false;
  return true;
}

/** Whether `rule` matches at least one transaction — lets the UI warn that a
 *  newly configured (or too-narrow) rule hasn't found a salary payment yet,
 *  so periods are still falling back to the fixed pay-cycle. */
export function hasSalaryRuleMatch(transactions: Transaction[], categoryOf: (tx: Transaction) => string, rule: SalaryRule): boolean {
  return transactions.some((t) => matchesSalaryRule(t, categoryOf, rule));
}

/**
 * "Monthly" periods built from actual salary-payment dates instead of a
 * fixed day-of-month: each date a transaction matches `rule` (see
 * matchesSalaryRule) opens a new period running through the day before the
 * *next* salary date, so "opening balance" always means exactly what the
 * user means by it — the balance the day they got paid. The most recent
 * salary date's period runs through `today` (in progress). Returns null
 * (falling back to the fixed pay-cycle behavior) when the rule hasn't
 * matched anything yet, so the report never just goes blank while a newly
 * set-up rule is waiting for its first real match.
 */
function buildSalaryCyclePeriods(
  cards: { type: CardType; transactions: Transaction[]; checkpoints: BalanceCheckpoint[] }[],
  assets: Asset[],
  assetValues: AssetValueEntry[],
  transactions: Transaction[],
  categoryOf: (tx: Transaction) => string,
  rule: SalaryRule,
  count: number,
  today: string,
): PeriodSummary[] | null {
  const dates = [...new Set(transactions.filter((t) => matchesSalaryRule(t, categoryOf, rule)).map((t) => t.date))].sort();
  if (dates.length === 0) return null;

  const bounds = dates.map((from, i) => ({
    from,
    to: i + 1 < dates.length ? addDaysISO(dates[i + 1], -1) : today,
  }));

  return bounds
    .slice(-count)
    .map((b) => summarizeRange(cards, assets, assetValues, transactions, categoryOf, b.from, customRangeLabel(b.from, b.to), b.from, b.to));
}

// Weekly columns carry a full top-5-plus-Other breakdown each, so fewer of
// them fit comfortably than the old simple-totals table did — 4 (roughly a
// month of weeks) instead of 8.
const DEFAULT_PERIOD_COUNT: Record<SummaryGranularity, number> = { week: 4, month: 6 };

/**
 * The trailing `periodCount` periods (pay-cycle months by default, or
 * weeks), each with its own full opening/closing + sources/uses breakdown.
 * Chronological, oldest first; the last entry is the current, possibly
 * still in-progress period. Leading periods with no activity at all are
 * dropped (see below) — the result may have fewer than `periodCount`
 * entries.
 *
 * `cards` drives the balance reconstruction (needs each card's own
 * transactions/checkpoints/type); `transactions`/`categoryOf` should already
 * be the union of every card's transactions with each one's own
 * categorization applied (see lib/combine.ts's combineAllData) —
 * unfiltered by any card's own hidden-category filter, since this report is
 * meant to explain the real cash movement, not a curated subset of it.
 *
 * When `granularity` is 'month' and `salaryRule` is given, periods are built
 * from actual salary-payment dates instead — see buildSalaryCyclePeriods.
 */
export function buildPeriodBreakdowns(
  cards: { type: CardType; transactions: Transaction[]; checkpoints: BalanceCheckpoint[] }[],
  assets: Asset[],
  assetValues: AssetValueEntry[],
  transactions: Transaction[],
  categoryOf: (tx: Transaction) => string,
  monthStartDay: number,
  weekStartDay = 1,
  granularity: SummaryGranularity = 'month',
  periodCount?: number,
  salaryRule?: SalaryRule | null,
): PeriodSummary[] {
  if (!hasAnyData(cards, assets, transactions)) return [];

  const count = periodCount ?? DEFAULT_PERIOD_COUNT[granularity];

  if (granularity === 'month' && salaryRule) {
    const salaryPeriods = buildSalaryCyclePeriods(cards, assets, assetValues, transactions, categoryOf, salaryRule, count, todayISO());
    if (salaryPeriods) return salaryPeriods;
  }

  const today = todayISO();
  const lastPeriod = lastPeriodKey(granularity, monthStartDay, weekStartDay, today);
  let startPeriod = lastPeriod;
  for (let i = 1; i < count; i++) startPeriod = stepPeriod(granularity, startPeriod, -1);

  const out: PeriodSummary[] = [];
  let cur = startPeriod;
  for (let i = 0; i < count; i++) {
    out.push(computePeriodSummary(cards, assets, assetValues, transactions, categoryOf, monthStartDay, granularity, cur, today));
    cur = stepPeriod(granularity, cur, 1);
  }

  // Drop leading periods with nothing in them at all (no balance yet, no
  // sources, no uses) — a blank "Mar 2026" column before your data actually
  // starts isn't useful, it's just dead space. Never trims from the middle
  // or drops the current period, even if it's still empty (a fresh month
  // with no transactions yet is genuinely "now", worth showing).
  const isEmpty = (p: PeriodSummary) =>
    p.opening === 0 && p.closing === 0 && p.sources.total <= 0.005 && p.uses.total <= 0.005;
  const firstReal = out.findIndex((p) => !isEmpty(p));
  return firstReal <= 0 ? out : out.slice(firstReal);
}
