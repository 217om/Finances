// Build the groups the categorization wizard walks the user through. We only
// surface expense transactions that the user hasn't classified yet (no manual
// override and no matching rule), so re-running after a new import only asks
// about genuinely new merchants.

import type { CategoryRule, Transaction } from '../types';
import { categorize, signatureOf } from './categorize';

export interface TxGroup {
  signature: string;
  /** A human label for the group (the most common description). */
  label: string;
  /** Sample descriptions to show the variety within the group. */
  samples: string[];
  txs: Transaction[];
  total: number; // sum of expense amounts (positive)
  /** Best-guess category, pre-selected for convenience. */
  suggested: string;
}

export interface GroupingResult {
  groups: TxGroup[]; // multi-member, largest first
  leftovers: Transaction[]; // singletons, most recent first
  pendingCount: number; // total transactions awaiting classification
}

function isCovered(
  t: Transaction,
  rules: Map<string, CategoryRule>,
  overrides: Map<string, string>,
): boolean {
  if (overrides.has(t.id)) return true;
  const rule = rules.get(signatureOf(t.description));
  return !!rule && !rule.excludedIds.includes(t.id);
}

function mostCommon(strings: string[]): string {
  const counts = new Map<string, number>();
  for (const s of strings) counts.set(s, (counts.get(s) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Majority built-in guess across a group's transactions. */
function suggestCategory(txs: Transaction[]): string {
  return mostCommon(txs.map((t) => categorize(t.description, t.amount)));
}

export function buildGroups(
  txs: Transaction[],
  rules: Map<string, CategoryRule>,
  overrides: Map<string, string>,
): GroupingResult {
  const pending = txs.filter((t) => t.amount < 0 && !isCovered(t, rules, overrides));

  const bySig = new Map<string, Transaction[]>();
  for (const t of pending) {
    const sig = signatureOf(t.description);
    const list = bySig.get(sig);
    if (list) list.push(t);
    else bySig.set(sig, [t]);
  }

  const groups: TxGroup[] = [];
  const leftovers: Transaction[] = [];

  for (const [signature, list] of bySig) {
    if (list.length >= 2) {
      const descriptions = list.map((t) => t.description);
      const uniqueSamples = [...new Set(descriptions)].slice(0, 4);
      groups.push({
        signature,
        label: mostCommon(descriptions),
        samples: uniqueSamples,
        txs: list.slice().sort((a, b) => b.date.localeCompare(a.date)),
        total: list.reduce((a, t) => a + -t.amount, 0),
        suggested: suggestCategory(list),
      });
    } else {
      leftovers.push(list[0]);
    }
  }

  // Largest groups first — classifying them covers the most transactions.
  groups.sort((a, b) => b.txs.length - a.txs.length);
  leftovers.sort((a, b) => b.date.localeCompare(a.date));

  return { groups, leftovers, pendingCount: pending.length };
}
