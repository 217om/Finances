// Optional second tier under a category. Sub-categories never change a
// transaction's top-level category — they split a "junk drawer" bucket (like
// Transfers) into finer parts. A transaction's sub-category resolves as:
//   1. a manual per-transaction sub-override
//   2. a sub-rule for its parent whose keyword matches (newest wins)
//   3. "Unsorted"

import type { SubOverride, SubRule, Transaction } from '../types';
import { significantTokens } from './categorize';

export const UNSORTED = 'Unsorted';

export interface SubResolver {
  /** Sub-category for a transaction given its (already resolved) parent category. */
  subOf: (tx: Transaction, parent: string) => string;
  /** Categories that have at least one sub-rule or sub-override (i.e. are split). */
  splitParents: Set<string>;
  /** Known sub-category names for a parent (from rules + overrides). */
  subsForParent: (parent: string) => string[];
}

export function makeSubResolver(subRules: SubRule[], subOverrides: SubOverride[]): SubResolver {
  const overrideById = new Map(subOverrides.map((o) => [o.id, o]));
  const rulesByParent = new Map<string, SubRule[]>();
  for (const r of subRules) {
    const list = rulesByParent.get(r.parent);
    if (list) list.push(r);
    else rulesByParent.set(r.parent, [r]);
  }
  // Newest first so the first keyword match is the highest priority.
  for (const list of rulesByParent.values()) list.sort((a, b) => b.createdAt - a.createdAt);

  const splitParents = new Set<string>();
  for (const r of subRules) splitParents.add(r.parent);
  for (const o of subOverrides) splitParents.add(o.parent);

  const subsByParent = new Map<string, Set<string>>();
  const add = (parent: string, sub: string) => {
    let s = subsByParent.get(parent);
    if (!s) {
      s = new Set();
      subsByParent.set(parent, s);
    }
    s.add(sub);
  };
  for (const r of subRules) add(r.parent, r.sub);
  for (const o of subOverrides) add(o.parent, o.sub);

  return {
    splitParents,
    subsForParent: (parent) => [...(subsByParent.get(parent) ?? [])].sort(),
    subOf: (tx, parent) => {
      const o = overrideById.get(tx.id);
      if (o) return o.sub;
      const rules = rulesByParent.get(parent);
      if (rules) {
        const desc = tx.description.toLowerCase();
        for (const r of rules) if (r.keyword && desc.includes(r.keyword)) return r.sub;
      }
      return UNSORTED;
    },
  };
}

export interface SubSuggestion {
  keyword: string;
  count: number;
  total: number; // positive
  samples: string[];
}

/**
 * Cluster a parent category's still-unsorted transactions by their most
 * distinctive token (the counterparty), so look-alike Transfers/Mobile Payments
 * can be split. Tokens shared across most of the bucket (e.g. "transfer") are
 * uninformative and skipped in favor of the rarer token in each description.
 */
export function suggestSubGroups(txs: Transaction[]): SubSuggestion[] {
  if (txs.length === 0) return [];

  // Document frequency of each significant token within this bucket.
  const df = new Map<string, number>();
  const tokensPerTx = txs.map((t) => {
    const toks = [...new Set(significantTokens(t.description))];
    for (const tok of toks) df.set(tok, (df.get(tok) ?? 0) + 1);
    return toks;
  });

  const groups = new Map<string, { count: number; total: number; samples: Set<string> }>();
  txs.forEach((t, i) => {
    const toks = tokensPerTx[i];
    if (toks.length === 0) return;
    // Most distinctive = lowest document frequency; ties broken by longer token.
    let key = toks[0];
    for (const tok of toks) {
      const a = df.get(tok)!;
      const b = df.get(key)!;
      if (a < b || (a === b && tok.length > key.length)) key = tok;
    }
    let g = groups.get(key);
    if (!g) {
      g = { count: 0, total: 0, samples: new Set() };
      groups.set(key, g);
    }
    g.count++;
    g.total += Math.abs(t.amount);
    if (g.samples.size < 3) g.samples.add(t.description);
  });

  return [...groups.entries()]
    .filter(([, g]) => g.count >= 2)
    .map(([keyword, g]) => ({
      keyword,
      count: g.count,
      total: g.total,
      samples: [...g.samples],
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);
}
