// Combines transactions from multiple cards into one view — for the
// dashboard charts, the Categories tab's map, and the read-only merged
// Transactions list. Each card keeps categorizing its own transactions with
// its own rules; combining just merges the results afterwards, it never
// mixes rules between cards. Visibility (what's hidden) is handled entirely
// by the combined view's own independent filter, in App.tsx — not by any
// individual card's filter, so nothing here needs to know about those.

import type { Transaction } from '../types';
import { UNSORTED } from './subcategory';

export interface CardSnapshot {
  cardId: string;
  cardName: string;
  currency: string;
  transactions: Transaction[];
  categoryOf: (tx: Transaction) => string;
  subOf: (tx: Transaction, cat: string) => string;
}

export interface CombinedData {
  transactions: Transaction[];
  categoryOf: (tx: Transaction) => string;
  subOf: (tx: Transaction, cat: string) => string;
  cardNameOf: (tx: Transaction) => string;
  /** Which card a transaction actually belongs to — needed for anything that
   *  writes back to a specific card's own database, like a per-transaction note. */
  cardIdOf: (tx: Transaction) => string;
  /** True if the combined cards don't all use the same currency, so summed
   *  totals mix units and should be shown with a caveat. */
  mixedCurrency: boolean;
}

/**
 * Every transaction from every card, with none of any card's own filter
 * applied — feeds both the Dashboard and the Categories tab's map while
 * combined, which share one independent hide/show filter (see App.tsx), so
 * a category any individual card hides on its own is still reachable here.
 */
export function combineAllData(snapshots: CardSnapshot[]): CombinedData {
  const txs: Transaction[] = [];
  // Keyed by object identity (not tx.id) so two different cards' transactions
  // that happen to hash to the same id never overwrite each other's category.
  const categoryByTx = new Map<Transaction, string>();
  const subByTx = new Map<Transaction, string>();
  const cardNameByTx = new Map<Transaction, string>();
  const cardIdByTx = new Map<Transaction, string>();

  for (const snap of snapshots) {
    for (const tx of snap.transactions) {
      const cat = snap.categoryOf(tx);
      const sub = snap.subOf(tx, cat);
      txs.push(tx);
      categoryByTx.set(tx, cat);
      subByTx.set(tx, sub);
      cardNameByTx.set(tx, snap.cardName);
      cardIdByTx.set(tx, snap.cardId);
    }
  }
  txs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const currencies = new Set(snapshots.map((s) => s.currency));

  return {
    transactions: txs,
    categoryOf: (tx) => categoryByTx.get(tx) ?? 'Other',
    subOf: (tx) => subByTx.get(tx) ?? UNSORTED,
    cardNameOf: (tx) => cardNameByTx.get(tx) ?? '',
    cardIdOf: (tx) => cardIdByTx.get(tx) ?? '',
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
 * Every transaction from every card. Feeds the merged Transactions view,
 * which — like the single-card Transactions tab — is never affected by the
 * combined view's own hidden-category filter, except for one visit's worth
 * after a chart-click drill-down (see CombinedTransactionsPage, which
 * applies that filter itself using the category/sub already resolved here).
 */
export function combineAllRows(snapshots: CardSnapshot[]): CombinedRow[] {
  const rows: CombinedRow[] = [];
  for (const snap of snapshots) {
    for (const tx of snap.transactions) {
      const category = snap.categoryOf(tx);
      const sub = snap.subOf(tx, category);
      rows.push({ t: tx, cardId: snap.cardId, cardName: snap.cardName, category, sub });
    }
  }
  rows.sort((a, b) => (a.t.date < b.t.date ? 1 : a.t.date > b.t.date ? -1 : 0));
  return rows;
}
