// Loads a read-only snapshot of one card's category totals, for the notes
// calculator's card lookups (e.g. `card1.get("Dining")`). This only reads
// data — it never writes anything, and it's independent of which card is
// currently active in the main app.

import type { Card } from './cards';
import { scopedKey } from './cards';
import { getAllTransactions, getKeywordRules, getOverrides, getRules } from './db';
import { makeResolver } from './categorize';
import { defaultCategoryFilter, isExcluded, isValidCategoryFilter, type CategoryFilterState } from './categoryFilter';

const CATEGORY_FILTER_KEY = 'cashflow.categoryFilter';

export interface CardCategoryTotals {
  cardId: string;
  cardName: string;
  slug: string;
  /** Absolute total per category, keyed by lowercased category name. */
  totals: Record<string, number>;
  /** Canonical-cased category names present, for display/autocomplete. */
  categories: string[];
}

function loadFilterFor(cardId: string): CategoryFilterState {
  try {
    const raw = localStorage.getItem(scopedKey(CATEGORY_FILTER_KEY, cardId));
    const parsed = JSON.parse(raw ?? 'null');
    if (isValidCategoryFilter(parsed)) return parsed;
  } catch {
    /* ignore */
  }
  return defaultCategoryFilter();
}

/** Sums each category's absolute total for one card, respecting that card's
 *  own "hidden from charts & totals" exclusions — same numbers you'd see on
 *  that card's own dashboard. */
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
  const filter = loadFilterFor(card.id);

  const totals: Record<string, number> = {};
  const casing: Record<string, string> = {};
  for (const t of txs) {
    const cat = categoryOf(t);
    if (isExcluded(filter, cat, null)) continue;
    const key = cat.toLowerCase();
    totals[key] = (totals[key] ?? 0) + Math.abs(t.amount);
    casing[key] = cat;
  }

  return { cardId: card.id, cardName: card.name, slug, totals, categories: Object.values(casing).sort() };
}
