// Latest-balance tracking for cards (debit or credit) and free-form assets,
// feeding the Balances tab and its net worth total.
//
// A card's current balance comes from whichever is more recent: the last
// statement row that included a running-balance column, or a manually
// entered checkpoint (for banks whose exports don't include one). Whichever
// anchor wins, every transaction dated after it is added on top to bring the
// figure up to date — see computeCardBalance.
//
// Credit-card balances are always treated as debt (negative), regardless of
// whatever sign convention the bank's own statement export or the user's
// manual entry happens to use, so summing every card's balance plus every
// asset's value directly yields net worth. Debit balances pass through
// unchanged, including the rare legitimate case of an overdrawn (negative)
// debit balance.

import type { Transaction } from '../types';

export type CardType = 'debit' | 'credit';

/** A manually-entered "as of this date, the balance was this" snapshot.
 *  `balance` is the raw magnitude as the user typed it, unmodified — see
 *  signedBalance for where the credit-is-negative convention is applied. */
export interface BalanceCheckpoint {
  id: string;
  date: string; // ISO YYYY-MM-DD
  balance: number;
  createdAt: number;
}

export interface Asset {
  id: string;
  name: string;
  createdAt: number;
}

/** One historical value for an asset. Entries accumulate over time so the
 *  full history stays available, even though only the latest is shown by
 *  default. */
export interface AssetValueEntry {
  id: string;
  assetId: string;
  date: string; // ISO YYYY-MM-DD
  value: number;
  createdAt: number;
}

export interface ComputedBalance {
  /** Signed value (credit debt negative), or null with no data at all. */
  amount: number | null;
  /** The anchor's date, or null when `amount` is null. */
  asOf: string | null;
  /** True when the anchor was a manual checkpoint rather than a statement's
   *  balance column. */
  fromCheckpoint: boolean;
  /** How many transactions after the anchor were added on top to reach
   *  `amount` — 0 means the anchor itself is already up to date. */
  sinceCount: number;
}

function randomId(): string {
  try {
    return crypto.randomUUID().slice(0, 8);
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

export function makeCheckpoint(date: string, balance: number): BalanceCheckpoint {
  return { id: `bal_${randomId()}`, date, balance, createdAt: Date.now() };
}

export function makeAsset(name: string): Asset {
  return { id: `asset_${randomId()}`, name: name.trim() || 'New asset', createdAt: Date.now() };
}

export function makeAssetValueEntry(assetId: string, date: string, value: number): AssetValueEntry {
  return { id: `assetval_${randomId()}`, assetId, date, value, createdAt: Date.now() };
}

/** Applies the credit-is-negative convention to a raw magnitude. Credit
 *  cards always become debt (negative), regardless of the sign the raw value
 *  happened to carry; debit cards pass through unchanged. */
export function signedBalance(type: CardType, rawMagnitude: number): number {
  return type === 'credit' ? -Math.abs(rawMagnitude) : rawMagnitude;
}

/**
 * Reconciles a card's statement running-balance column (if any) with its
 * manual checkpoints into one current balance. Picks whichever anchor — the
 * latest balance-bearing transaction, or the latest checkpoint — is more
 * recent (a same-day tie favors the checkpoint, since it's a deliberate,
 * later user action rather than incidental row order), then adds every
 * transaction dated strictly after it. Transaction.amount is already signed
 * money-in-positive/money-out-negative regardless of card type, so the same
 * addition is correct for both: a credit-card payment (money in) reduces
 * debt, a purchase (money out) increases it.
 */
export function computeCardBalance(
  type: CardType,
  transactions: Transaction[],
  checkpoints: BalanceCheckpoint[],
): ComputedBalance {
  const sorted = [...transactions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let anchorDate: string | null = null;
  let anchorRaw = 0;
  let fromCheckpoint = false;

  for (const t of sorted) {
    if (t.balance === undefined || t.balance === null || Number.isNaN(t.balance)) continue;
    if (anchorDate === null || t.date >= anchorDate) {
      anchorDate = t.date;
      anchorRaw = t.balance;
      fromCheckpoint = false;
    }
  }

  for (const cp of checkpoints) {
    if (anchorDate === null || cp.date >= anchorDate) {
      anchorDate = cp.date;
      anchorRaw = cp.balance;
      fromCheckpoint = true;
    }
  }

  if (anchorDate === null) {
    return { amount: null, asOf: null, fromCheckpoint: false, sinceCount: 0 };
  }

  const since = sorted.filter((t) => t.date > anchorDate!);
  const delta = since.reduce((a, t) => a + t.amount, 0);

  return {
    amount: signedBalance(type, anchorRaw) + delta,
    asOf: anchorDate,
    fromCheckpoint,
    sinceCount: since.length,
  };
}

// --- Validation & merge (for full-backup restore) ----------------------------

export function isValidCardType(v: unknown): v is CardType {
  return v === 'debit' || v === 'credit';
}

export function isValidCheckpoints(v: unknown): v is BalanceCheckpoint[] {
  if (!Array.isArray(v)) return false;
  return v.every((c) => {
    if (!c || typeof c !== 'object') return false;
    const cp = c as Record<string, unknown>;
    return (
      typeof cp.id === 'string' &&
      typeof cp.date === 'string' &&
      typeof cp.balance === 'number' &&
      Number.isFinite(cp.balance)
    );
  });
}

export function isValidAssets(v: unknown): v is Asset[] {
  if (!Array.isArray(v)) return false;
  return v.every((a) => {
    if (!a || typeof a !== 'object') return false;
    const asset = a as Record<string, unknown>;
    return typeof asset.id === 'string' && typeof asset.name === 'string';
  });
}

export function isValidAssetValues(v: unknown): v is AssetValueEntry[] {
  if (!Array.isArray(v)) return false;
  return v.every((e) => {
    if (!e || typeof e !== 'object') return false;
    const entry = e as Record<string, unknown>;
    return (
      typeof entry.id === 'string' &&
      typeof entry.assetId === 'string' &&
      typeof entry.date === 'string' &&
      typeof entry.value === 'number' &&
      Number.isFinite(entry.value)
    );
  });
}

export function mergeCheckpoints(
  existing: BalanceCheckpoint[],
  incoming: BalanceCheckpoint[],
): BalanceCheckpoint[] {
  const byId = new Map(existing.map((c) => [c.id, c]));
  for (const c of incoming) byId.set(c.id, c);
  return [...byId.values()];
}

export function mergeAssets(existing: Asset[], incoming: Asset[]): Asset[] {
  const byId = new Map(existing.map((a) => [a.id, a]));
  for (const a of incoming) byId.set(a.id, a);
  return [...byId.values()];
}

export function mergeAssetValues(existing: AssetValueEntry[], incoming: AssetValueEntry[]): AssetValueEntry[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()];
}

/** The latest value on or before today for one asset, or null if it has none. */
export function latestAssetValue(entries: AssetValueEntry[], assetId: string): AssetValueEntry | null {
  let best: AssetValueEntry | null = null;
  for (const e of entries) {
    if (e.assetId !== assetId) continue;
    if (!best || e.date >= best.date) best = e;
  }
  return best;
}
