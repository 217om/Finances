// Optional second tier under a category. Sub-categories never change a
// transaction's top-level category — they split a "junk drawer" bucket (like
// Transfers) into finer parts. A transaction's sub-category resolves as:
//   1. a manual per-transaction sub-override
//   2. a sub-rule for its parent whose keyword matches (newest wins)
//   3. "Unsorted"

import type { SubOverride, SubRule, Transaction } from '../types';

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
