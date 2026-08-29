// The cash-flow "bridge" report: opening balance -> sources of cash -> uses
// of cash -> change in other asset values -> closing balance, one column per
// pay-cycle month, combined across every card (plus tracked assets).
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
import { netWorthAsOf, assetsNetAsOf, type Asset, type AssetValueEntry, type BalanceCheckpoint, type CardType } from './balances';
import { adjacentPeriod, cycleBounds, currentCyclePeriod, todayISO } from './budget';
import { addDaysISO } from './rangePresets';

export interface CategoryAmount {
  category: string;
  amount: number;
}

export interface PeriodBridge {
  /** "YYYY-MM" pay-cycle period key. */
  period: string;
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
  totalSources: number;
  totalUses: number;
  totalAssetChange: number;
  totalOther: number;
  sourceCategories: CategoryAmount[]; // whole window, sorted desc
  useCategories: CategoryAmount[];
  /** True when any period's opening/closing balance had to default part of
   *  a card to 0 for lack of an anchor that far back. */
  anyIncomplete: boolean;
}

/**
 * Builds the trailing `periodCount` pay-cycle months' cash bridge, ending at
 * the current (possibly still in-progress) cycle — its "closing" balance is
 * always as of today, not the calendar cycle's full end date.
 *
 * `cards` drives the balance reconstruction (needs each card's own
 * transactions/checkpoints/type); `combinedTransactions`/`categoryOf` drive
 * the sources/uses breakdown and should already be the union of every card's
 * transactions with each one's own categorization applied (see
 * lib/combine.ts's combineAllData) — unfiltered by any card's own hidden-
 * category filter, since this report is meant to explain the real cash
 * movement, not a curated subset of it.
 */
export function buildExecutiveSummary(
  cards: { type: CardType; transactions: Transaction[]; checkpoints: BalanceCheckpoint[] }[],
  assets: Asset[],
  assetValues: AssetValueEntry[],
  combinedTransactions: Transaction[],
  categoryOf: (tx: Transaction) => string,
  monthStartDay: number,
  periodCount = 6,
): ExecutiveSummary | null {
  const hasAnyData =
    combinedTransactions.length > 0 || cards.some((c) => c.checkpoints.length > 0) || assets.length > 0;
  if (!hasAnyData) return null;

  const today = todayISO();
  const lastPeriod = currentCyclePeriod(monthStartDay);
  let startPeriod = lastPeriod;
  for (let i = 1; i < periodCount; i++) startPeriod = adjacentPeriod(startPeriod, -1);

  const periods: PeriodBridge[] = [];
  let cur = startPeriod;
  for (let i = 0; i < periodCount; i++) {
    const bounds = cycleBounds(cur, monthStartDay);
    const from = bounds.from;
    // The current cycle is still in progress — its "closing" is as of today,
    // not the full calendar cycle end, which hasn't happened yet.
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

    cur = adjacentPeriod(cur, 1);
  }

  const windowFrom = periods[0].from;
  const windowTo = periods[periods.length - 1].to;
  const sourceMap = new Map<string, number>();
  const useMap = new Map<string, number>();
  for (const t of combinedTransactions) {
    if (t.date < windowFrom || t.date > windowTo) continue;
    const cat = categoryOf(t);
    if (t.amount >= 0) sourceMap.set(cat, (sourceMap.get(cat) ?? 0) + t.amount);
    else useMap.set(cat, (useMap.get(cat) ?? 0) + -t.amount);
  }
  const toSorted = (m: Map<string, number>): CategoryAmount[] =>
    [...m.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);

  return {
    periods,
    opening: periods[0].opening,
    closing: periods[periods.length - 1].closing,
    netChange: periods[periods.length - 1].closing - periods[0].opening,
    totalSources: periods.reduce((a, p) => a + p.sources, 0),
    totalUses: periods.reduce((a, p) => a + p.uses, 0),
    totalAssetChange: periods.reduce((a, p) => a + p.assetChange, 0),
    totalOther: periods.reduce((a, p) => a + p.other, 0),
    sourceCategories: toSorted(sourceMap),
    useCategories: toSorted(useMap),
    anyIncomplete: periods.some((p) => !p.openingComplete || !p.closingComplete),
  };
}
