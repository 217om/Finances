// Combines transactions from multiple cards into one view — for the
// dashboard charts, and for the read-only merged Transactions list. Each card
// keeps categorizing its own transactions with its own rules and its own
// exclusion filter; combining just merges the results afterwards, it never
// mixes rules or filters between cards.

import type { Transaction } from '../types';
import { isExcluded, type CategoryFilterState } from './categoryFilter';
import { UNSORTED } from './subcategory';

export interface CardSnapshot {
  cardId: string;
  cardName: string;
  currency: string;
  transactions: Transaction[];
  categoryOf: (tx: Transaction) => string;
  subOf: (tx: Transaction, cat: string) => string;
  filter: CategoryFilterState;
}

export interface CombinedData {
  transactions: Transaction[];
  categoryOf: (tx: Transaction) => string;
  subOf: (tx: Transaction, cat: string) => string;
  cardNameOf: (tx: Transaction) => string;
  /** True if the combined cards don't all use the same currency, so summed
   *  totals mix units and should be shown with a caveat. */
  mixedCurrency: boolean;
}

/**
 * Every transaction, category-filtered per its own card — feeds the
 * dashboard's KPIs/chart/breakdown/insights AND the Categories tab's map,
 * so a category hidden on one card is excluded from combined totals while a
 * card that doesn't hide it still counts and shows its own contribution.
 */
export function combineSnapshots(snapshots: CardSnapshot[]): CombinedData {
  const txs: Transaction[] = [];
  // Keyed by object identity (not tx.id) so two different cards' transactions
  // that happen to hash to the same id never overwrite each other's category.
  const categoryByTx = new Map<Transaction, string>();
  const subByTx = new Map<Transaction, string>();
  const cardNameByTx = new Map<Transaction, string>();

  for (const snap of snapshots) {
    for (const tx of snap.transactions) {
      const cat = snap.categoryOf(tx);
      const sub = snap.subOf(tx, cat);
      if (isExcluded(snap.filter, cat, sub)) continue;
      txs.push(tx);
      categoryByTx.set(tx, cat);
      subByTx.set(tx, sub);
      cardNameByTx.set(tx, snap.cardName);
    }
  }
  txs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const currencies = new Set(snapshots.map((s) => s.currency));

  return {
    transactions: txs,
    categoryOf: (tx) => categoryByTx.get(tx) ?? 'Other',
    subOf: (tx) => subByTx.get(tx) ?? UNSORTED,
    cardNameOf: (tx) => cardNameByTx.get(tx) ?? '',
    mixedCurrency: currencies.size > 1,
  };
}

/**
 * Every transaction from every card, with none of any card's own filter
 * applied — feeds the Categories tab's combined map, which has its own
 * independent hide/show filter and so needs the full, unfiltered picture to
 * apply it to (a category one card hides should still be reachable here).
 */
export function combineAllData(snapshots: CardSnapshot[]): CombinedData {
  const txs: Transaction[] = [];
  const categoryByTx = new Map<Transaction, string>();
  const subByTx = new Map<Transaction, string>();
  const cardNameByTx = new Map<Transaction, string>();

  for (const snap of snapshots) {
    for (const tx of snap.transactions) {
      const cat = snap.categoryOf(tx);
      const sub = snap.subOf(tx, cat);
      txs.push(tx);
      categoryByTx.set(tx, cat);
      subByTx.set(tx, sub);
      cardNameByTx.set(tx, snap.cardName);
    }
  }
  txs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const currencies = new Set(snapshots.map((s) => s.currency));

  return {
    transactions: txs,
    categoryOf: (tx) => categoryByTx.get(tx) ?? 'Other',
    subOf: (tx) => subByTx.get(tx) ?? UNSORTED,
    cardNameOf: (tx) => cardNameByTx.get(tx) ?? '',
    mixedCurrency: currencies.size > 1,
  };
}

export interface CombinedRow {
  t: Transaction;
  cardId: string;
  cardName: string;
  category: string;
  sub: string;
  /** True if this transaction's own card hides this category/sub — i.e. it's
   *  excluded from the combined charts/KPIs (see combineSnapshots above). */
  hidden: boolean;
}

/**
 * Every transaction from every card, tagged with whether its own card's
 * filter hides it. The general-purpose merged Transactions view ignores
 * that flag entirely (never affected by any card's hidden-category filter,
 * mirroring the single-card Transactions tab) — but a chart-click
 * drill-down applies it for that one visit, exactly like the single-card
 * tab does, so the list matches what the chart actually counted.
 */
export function combineAllRows(snapshots: CardSnapshot[]): CombinedRow[] {
  const rows: CombinedRow[] = [];
  for (const snap of snapshots) {
    for (const tx of snap.transactions) {
      const category = snap.categoryOf(tx);
      const sub = snap.subOf(tx, category);
      rows.push({
        t: tx,
        cardId: snap.cardId,
        cardName: snap.cardName,
        category,
        sub,
        hidden: isExcluded(snap.filter, category, sub),
      });
    }
  }
  rows.sort((a, b) => (a.t.date < b.t.date ? 1 : a.t.date > b.t.date ? -1 : 0));
  return rows;
}
