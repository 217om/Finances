// Combines transactions from multiple cards into one view — for the
// dashboard charts, and for the read-only merged Transactions list. Each card
// keeps categorizing its own transactions with its own rules and its own
// exclusion filter; combining just merges the results afterwards, it never
// mixes rules or filters between cards.

import type { Transaction } from '../types';
import { isExcluded, type CategoryFilterState } from './categoryFilter';

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
  /** True if the combined cards don't all use the same currency, so summed
   *  totals mix units and should be shown with a caveat. */
  mixedCurrency: boolean;
}

/** Every transaction, category-filtered per its own card — feeds the
 *  dashboard's KPIs, cashflow chart, category breakdown, and insights. */
export function combineSnapshots(snapshots: CardSnapshot[]): CombinedData {
  const txs: Transaction[] = [];
  // Keyed by object identity (not tx.id) so two different cards' transactions
  // that happen to hash to the same id never overwrite each other's category.
  const categoryByTx = new Map<Transaction, string>();

  for (const snap of snapshots) {
    for (const tx of snap.transactions) {
      const cat = snap.categoryOf(tx);
      const sub = snap.subOf(tx, cat);
      if (isExcluded(snap.filter, cat, sub)) continue;
      txs.push(tx);
      categoryByTx.set(tx, cat);
    }
  }
  txs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const currencies = new Set(snapshots.map((s) => s.currency));

  return {
    transactions: txs,
    categoryOf: (tx) => categoryByTx.get(tx) ?? 'Other',
    mixedCurrency: currencies.size > 1,
  };
}

export interface CombinedRow {
  t: Transaction;
  cardId: string;
  cardName: string;
  category: string;
  sub: string;
}

/**
 * Every transaction from every card, unfiltered by any card's hidden-category
 * filter — mirrors the single-card Transactions tab, which is deliberately
 * never affected by that filter either. Feeds the read-only merged
 * Transactions view shown while "Combine all cards" is selected.
 */
export function combineAllRows(snapshots: CardSnapshot[]): CombinedRow[] {
  const rows: CombinedRow[] = [];
  for (const snap of snapshots) {
    for (const tx of snap.transactions) {
      const category = snap.categoryOf(tx);
      rows.push({
        t: tx,
        cardId: snap.cardId,
        cardName: snap.cardName,
        category,
        sub: snap.subOf(tx, category),
      });
    }
  }
  rows.sort((a, b) => (a.t.date < b.t.date ? 1 : a.t.date > b.t.date ? -1 : 0));
  return rows;
}
