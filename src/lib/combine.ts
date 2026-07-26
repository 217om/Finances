// Combines transactions from multiple cards into one view for the dashboard
// charts only. Each card keeps categorizing its own transactions with its own
// rules and its own exclusion filter — combining just merges the results
// afterwards, it never mixes rules or filters between cards.

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
