// The cash-flow "bridge" report: opening balance -> sources of cash -> uses
// of cash -> change in other asset values -> closing balance, one column per
// period (a pay-cycle month, or a week), combined across every card (plus
// tracked assets).
//
// Opening/closing balances reuse the exact same anchor-plus-forward-sum
// reconstruction the Balances tab already relies on for "current balance"
// (see netWorthAsOf in lib/balances.ts) — just run at each period's
// boundary instead of only "now". That mechanism can only see as far back as
// the earliest known anchor (a statement's own balance column, or a manual
// checkpoint) per card; before that, a card's contribution is unknowable and
// defaults to 0. Rather than hide that, the gap surfaces honestly as the
// "other" line below: it's defined as whatever the real observed balance
// change (closing minus opening, both independently reconstructed) doesn't
// already explain via categorized transactions or asset revaluation — so a
// missing early anchor, an uncaptured bank fee, or any other drift all show
// up there instead of silently being absorbed into "sources" or "uses".

import type { Transaction } from '../types';
import { startOfWeek } from './aggregate';
import { netWorthAsOf, assetsNetAsOf, type Asset, type AssetValueEntry, type BalanceCheckpoint, type CardType } from './balances';
import { adjacentPeriod, cycleBounds, currentCyclePeriod, todayISO } from './budget';
import { addDaysISO } from './rangePresets';
import { dayLabelShort, monthLabel } from './format';

export type SummaryGranularity = 'week' | 'month';

export interface PeriodBridge {
  /** "YYYY-MM" pay-cycle key for a month, or the week's start date for a week. */
  period: string;
  /** Ready-to-display column header, e.g. "Aug 2026" or "Jul 27 – Aug 2". */
  label: string;
  from: string;
  to: string;
  opening: number;
  openingComplete: boolean;
  sources: number;
  uses: number;
  /** Net change in tracked assets' value this period (can be 0 if none). */
  assetChange: number;
  /** Reconciling "other" — see the file header for what this captures. */
  other: number;
  closing: number;
  closingComplete: boolean;
  txCount: number;
}

export interface ExecutiveSummary {
  periods: PeriodBridge[]; // chronological, oldest first
  opening: number;
  closing: number;
  netChange: number;
  /** True when any period's opening/closing balance had to default part of
   *  a card to 0 for lack of an anchor that far back. */
  anyIncomplete: boolean;
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

export interface CurrentPeriodSummary {
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

/**
 * The current (possibly still in-progress) single period's opening/closing
 * balance plus a sources/uses breakdown capped at the top
 * `TOP_CATEGORY_COUNT` categories each, with everything past that folded
 * into one "other" catch-all per side — same "cards"/`transactions`/
 * `categoryOf` inputs and reconciling-gap handling as buildExecutiveSummary,
 * just for one period instead of a trailing trend.
 */
export function currentPeriodSummary(
  cards: { type: CardType; transactions: Transaction[]; checkpoints: BalanceCheckpoint[] }[],
  assets: Asset[],
  assetValues: AssetValueEntry[],
  transactions: Transaction[],
  categoryOf: (tx: Transaction) => string,
  monthStartDay: number,
  weekStartDay = 1,
  granularity: SummaryGranularity = 'month',
): CurrentPeriodSummary | null {
  const hasAnyData = transactions.length > 0 || cards.some((c) => c.checkpoints.length > 0) || assets.length > 0;
  if (!hasAnyData) return null;

  const today = todayISO();
  const key = lastPeriodKey(granularity, monthStartDay, weekStartDay, today);
  const bounds = periodBounds(granularity, key, monthStartDay);
  const from = bounds.from;
  const to = bounds.to > today ? today : bounds.to;
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
    period: key,
    label: periodLabel(granularity, key, bounds),
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

const DEFAULT_PERIOD_COUNT: Record<SummaryGranularity, number> = { week: 8, month: 6 };

/**
 * Builds the trailing periods' cash bridge (pay-cycle months by default, or
 * weeks — see `granularity`), ending at the current, possibly still
 * in-progress period — its "closing" balance is always as of today, not the
 * full calendar period's end date.
 *
 * `cards` drives the balance reconstruction (needs each card's own
 * transactions/checkpoints/type); `combinedTransactions` should already be
 * the union of every card's transactions (see lib/combine.ts's
 * combineAllData) — unfiltered by any card's own hidden-category filter,
 * since this report is meant to explain the real cash movement, not a
 * curated subset of it.
 */
export function buildExecutiveSummary(
  cards: { type: CardType; transactions: Transaction[]; checkpoints: BalanceCheckpoint[] }[],
  assets: Asset[],
  assetValues: AssetValueEntry[],
  combinedTransactions: Transaction[],
  monthStartDay: number,
  weekStartDay = 1,
  granularity: SummaryGranularity = 'month',
  periodCount?: number,
): ExecutiveSummary | null {
  const hasAnyData =
    combinedTransactions.length > 0 || cards.some((c) => c.checkpoints.length > 0) || assets.length > 0;
  if (!hasAnyData) return null;

  const count = periodCount ?? DEFAULT_PERIOD_COUNT[granularity];
  const today = todayISO();
  const lastPeriod = lastPeriodKey(granularity, monthStartDay, weekStartDay, today);
  let startPeriod = lastPeriod;
  for (let i = 1; i < count; i++) startPeriod = stepPeriod(granularity, startPeriod, -1);

  const periods: PeriodBridge[] = [];
  let cur = startPeriod;
  for (let i = 0; i < count; i++) {
    const bounds = periodBounds(granularity, cur, monthStartDay);
    const from = bounds.from;
    // The current period is still in progress — its "closing" is as of
    // today, not the full calendar period's end, which hasn't happened yet.
    const to = cur === lastPeriod && bounds.to > today ? today : bounds.to;
    const openingAsOf = addDaysISO(from, -1);

    const openingNW = netWorthAsOf(cards, assets, assetValues, openingAsOf);
    const closingNW = netWorthAsOf(cards, assets, assetValues, to);
    const assetChange = assetsNetAsOf(assets, assetValues, to) - assetsNetAsOf(assets, assetValues, openingAsOf);

    let sources = 0;
    let uses = 0;
    let txCount = 0;
    for (const t of combinedTransactions) {
      if (t.date < from || t.date > to) continue;
      txCount++;
      if (t.amount >= 0) sources += t.amount;
      else uses += -t.amount;
    }

    const netChange = closingNW.amount - openingNW.amount;
    const other = netChange - (sources - uses) - assetChange;

    periods.push({
      period: cur,
      label: periodLabel(granularity, cur, bounds),
      from,
      to,
      opening: openingNW.amount,
      openingComplete: openingNW.complete,
      sources,
      uses,
      assetChange,
      other,
      closing: closingNW.amount,
      closingComplete: closingNW.complete,
      txCount,
    });

    cur = stepPeriod(granularity, cur, 1);
  }

  return {
    periods,
    opening: periods[0].opening,
    closing: periods[periods.length - 1].closing,
    netChange: periods[periods.length - 1].closing - periods[0].opening,
    anyIncomplete: periods.some((p) => !p.openingComplete || !p.closingComplete),
  };
}
