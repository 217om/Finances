// Loads a read-only snapshot of one card's transactions (categorized), for
// the notes calculator's card lookups (e.g. `card1.get("Dining")` or
// `card1.get("Dining", "2026-06-01", "2026-06-30")`). This only reads data —
// it never writes anything, and it's independent of which card is currently
// active in the main app. Deliberately ignores that card's "hidden from
// charts & totals" filter, so a note variable always means the same thing.

import type { Card } from './cards';
import { getAllTransactions, getKeywordRules, getOverrides, getRules } from './db';
import { makeResolver } from './categorize';

export interface CardCategoryRow {
  date: string; // ISO YYYY-MM-DD
  category: string;
  amount: number; // absolute value
}

export interface CardCategoryData {
  cardId: string;
  cardName: string;
  slug: string;
  rows: CardCategoryRow[];
  /** Canonical-cased category names present, for display/autocomplete. */
  categories: string[];
}

export async function loadCardCategoryTotals(card: Card, slug: string): Promise<CardCategoryData> {
  const [txs, rules, overrides, keywordRules] = await Promise.all([
    getAllTransactions(card.dbName).catch(() => []),
    getRules(card.dbName).catch(() => []),
    getOverrides(card.dbName).catch(() => []),
    getKeywordRules(card.dbName).catch(() => []),
  ]);
  const rulesMap = new Map(rules.map((r) => [r.signature, r]));
  const overridesMap = new Map(overrides.map((o) => [o.id, o.category]));
  const categoryOf = makeResolver(rulesMap, overridesMap, keywordRules);

  const rows: CardCategoryRow[] = [];
  const seen = new Set<string>();
  for (const t of txs) {
    const category = categoryOf(t);
    rows.push({ date: t.date, category, amount: Math.abs(t.amount) });
    seen.add(category);
  }

  return { cardId: card.id, cardName: card.name, slug, rows, categories: [...seen].sort() };
}

/** Sum a category's amounts, optionally restricted to an inclusive date range. */
export function sumCategory(data: CardCategoryData, category: string, from?: string, to?: string): number {
  const key = category.toLowerCase();
  let total = 0;
  for (const r of data.rows) {
    if (r.category.toLowerCase() !== key) continue;
    if (from && r.date < from) continue;
    if (to && r.date > to) continue;
    total += r.amount;
  }
  return total;
}
