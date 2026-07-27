// Loads a read-only snapshot of one card's category totals, for the notes
// calculator's card lookups (e.g. `card1.get("Dining")`). This only reads
// data — it never writes anything, and it's independent of which card is
// currently active in the main app.

import type { Card } from './cards';
import { getAllTransactions, getKeywordRules, getOverrides, getRules } from './db';
import { makeResolver } from './categorize';

export interface CardCategoryTotals {
  cardId: string;
  cardName: string;
  slug: string;
  /** Absolute total per category, keyed by lowercased category name. */
  totals: Record<string, number>;
  /** Canonical-cased category names present, for display/autocomplete. */
  categories: string[];
}

/**
 * Sums each category's absolute total for one card, from every transaction —
 * deliberately independent of that card's "hidden from charts & totals"
 * filter, so a note variable always means the same thing regardless of what
 * you've chosen to hide on the Categories tab.
 */
export async function loadCardCategoryTotals(card: Card, slug: string): Promise<CardCategoryTotals> {
  const [txs, rules, overrides, keywordRules] = await Promise.all([
    getAllTransactions(card.dbName).catch(() => []),
    getRules(card.dbName).catch(() => []),
    getOverrides(card.dbName).catch(() => []),
    getKeywordRules(card.dbName).catch(() => []),
  ]);
  const rulesMap = new Map(rules.map((r) => [r.signature, r]));
  const overridesMap = new Map(overrides.map((o) => [o.id, o.category]));
  const categoryOf = makeResolver(rulesMap, overridesMap, keywordRules);

  const totals: Record<string, number> = {};
  const casing: Record<string, string> = {};
  for (const t of txs) {
    const cat = categoryOf(t);
    const key = cat.toLowerCase();
    totals[key] = (totals[key] ?? 0) + Math.abs(t.amount);
    casing[key] = cat;
  }

  return { cardId: card.id, cardName: card.name, slug, totals, categories: Object.values(casing).sort() };
}
