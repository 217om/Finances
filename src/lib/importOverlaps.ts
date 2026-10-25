import type { Transaction } from '../types';

export function transactionContentKey(t: Transaction): string {
  return JSON.stringify([t.date, t.amount, t.description.toLowerCase().replace(/\s+/g, ' ').trim()]);
}

/** Suggest one-to-one cross-source matches. These require user review: the
 * same day and amount alone cannot prove two payments are identical. */
export function findImportOverlaps(incoming: Transaction[], existing: Transaction[]): Map<string, Transaction> {
  const contentKeys = new Set(incoming.map(transactionContentKey));
  const incomingIds = new Set(incoming.map((t) => t.id));
  const candidates = new Map<string, Transaction[]>();
  for (const t of existing) {
    if (incomingIds.has(t.id) || (t.importAliases ?? []).some((id) => incomingIds.has(id)) || contentKeys.has(transactionContentKey(t))) continue;
    const key = JSON.stringify([t.date, t.amount, t.importKind === 'google-sheet']);
    candidates.set(key, [...(candidates.get(key) ?? []), t]);
  }
  const existingIds = new Set(existing.flatMap((t) => [t.id, ...(t.importAliases ?? [])]));
  const existingContent = new Set(existing.map(transactionContentKey));
  const matches = new Map<string, Transaction>();
  for (const t of incoming) {
    if (existingIds.has(t.id) || existingContent.has(transactionContentKey(t)) || matches.has(t.id)) continue;
    const key = JSON.stringify([t.date, t.amount, t.importKind !== 'google-sheet']);
    const candidate = candidates.get(key)?.shift();
    if (candidate) matches.set(t.id, candidate);
  }
  return matches;
}
