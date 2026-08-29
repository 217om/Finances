import { describe, expect, it } from 'vitest';
import type { Transaction } from '../types';
import {
  assetsNetAsOf,
  chronologicalCompare,
  computeCardBalance,
  mergeAssets,
  mergeCheckpoints,
  netWorthAsOf,
  netWorthHistory,
  signedAssetValue,
  signedBalance,
  type Asset,
  type AssetValueEntry,
  type BalanceCheckpoint,
} from './balances';

let idCounter = 0;
function tx(overrides: Partial<Transaction> & { date: string; amount: number }): Transaction {
  idCounter += 1;
  return {
    id: `tx_${idCounter}`,
    description: 'Test transaction',
    month: overrides.date.slice(0, 7),
    source: 'test.csv',
    importedAt: 1,
    ...overrides,
  };
}

function checkpoint(date: string, balance: number, id = `cp_${date}`): BalanceCheckpoint {
  return { id, date, balance, createdAt: 1 };
}

describe('chronologicalCompare', () => {
  it('orders by date first', () => {
    const a = tx({ date: '2026-08-01', amount: -10 });
    const b = tx({ date: '2026-08-02', amount: -10 });
    expect(chronologicalCompare(a, b)).toBeLessThan(0);
    expect(chronologicalCompare(b, a)).toBeGreaterThan(0);
  });

  it('falls back to importedAt on the same date (different import batches)', () => {
    const a = tx({ date: '2026-08-01', amount: -10, importedAt: 100 });
    const b = tx({ date: '2026-08-01', amount: -20, importedAt: 200 });
    expect(chronologicalCompare(a, b)).toBeLessThan(0);
  });

  it('falls back to seq within the same batch, order-independently', () => {
    const a = tx({ date: '2026-08-01', amount: -10, importedAt: 1, seq: 0 });
    const b = tx({ date: '2026-08-01', amount: -20, importedAt: 1, seq: 1 });
    expect(chronologicalCompare(a, b)).toBeLessThan(0);
    expect(chronologicalCompare(b, a)).toBeGreaterThan(0);
    // Same result regardless of which order they're handed in — the whole
    // point of seq is to not depend on storage/array order.
    expect([b, a].sort(chronologicalCompare)).toEqual([a, b]);
    expect([a, b].sort(chronologicalCompare)).toEqual([a, b]);
  });
});

describe('computeCardBalance', () => {
  it('returns null with no transactions and no checkpoints', () => {
    const result = computeCardBalance('debit', [], []);
    expect(result).toEqual({ amount: null, asOf: null, fromCheckpoint: false, sinceCount: 0 });
  });

  it('picks the true last same-day transaction as the balance anchor, regardless of array order', () => {
    // Regression: the anchor used to be whichever same-day row Array.sort's
    // stability happened to leave last, not the one that actually posted
    // last — see chronologicalCompare's doc comment.
    const earlier = tx({
      date: '2026-08-05', amount: -100, importedAt: 1, seq: 0, balance: 95.8,
    });
    const later = tx({
      date: '2026-08-05', amount: -100, importedAt: 1, seq: 1, balance: 1095.8,
    });
    const forward = computeCardBalance('debit', [earlier, later], []);
    const reversed = computeCardBalance('debit', [later, earlier], []);
    expect(forward.amount).toBe(1095.8);
    expect(reversed.amount).toBe(1095.8);
    expect(forward).toEqual(reversed);
  });

  it('adjusts a manual checkpoint by every transaction dated after it', () => {
    const cp = checkpoint('2026-08-05', 1000);
    const later = tx({ date: '2026-08-10', amount: -50 });
    const result = computeCardBalance('debit', [later], [cp]);
    expect(result).toEqual({ amount: 950, asOf: '2026-08-05', fromCheckpoint: true, sinceCount: 1 });
  });

  it('ignores transactions dated on or before the checkpoint', () => {
    const cp = checkpoint('2026-08-05', 1000);
    const before = tx({ date: '2026-08-05', amount: -999 });
    const after = tx({ date: '2026-08-06', amount: -50 });
    const result = computeCardBalance('debit', [before, after], [cp]);
    expect(result.amount).toBe(950);
    expect(result.sinceCount).toBe(1);
  });

  it('prefers a same-day checkpoint over a statement balance row', () => {
    const statementRow = tx({ date: '2026-08-05', amount: -10, balance: 500 });
    const cp = checkpoint('2026-08-05', 1000);
    const result = computeCardBalance('debit', [statementRow], [cp]);
    expect(result.fromCheckpoint).toBe(true);
    expect(result.amount).toBe(1000);
  });

  it('applies the credit-is-debt sign convention to the anchor, not to the deltas', () => {
    const statementRow = tx({ date: '2026-08-01', amount: 0, balance: 500 });
    const later = tx({ date: '2026-08-02', amount: -20 });
    const result = computeCardBalance('credit', [statementRow, later], []);
    // Anchor magnitude 500 becomes -500 (debt); the -20 purchase still adds
    // debt on top (money out increases what's owed).
    expect(result.amount).toBe(-520);
  });
});

describe('signedBalance / signedAssetValue', () => {
  it('always makes a credit balance negative, regardless of input sign', () => {
    expect(signedBalance('credit', 500)).toBe(-500);
    expect(signedBalance('credit', -500)).toBe(-500);
  });

  it('passes a debit balance through unchanged, including overdrawn (negative)', () => {
    expect(signedBalance('debit', 500)).toBe(500);
    expect(signedBalance('debit', -20)).toBe(-20);
  });

  it('always makes a liability negative; an asset passes through', () => {
    expect(signedAssetValue('liability', 300)).toBe(-300);
    expect(signedAssetValue('liability', -300)).toBe(-300);
    expect(signedAssetValue('asset', 300)).toBe(300);
    expect(signedAssetValue(undefined, 300)).toBe(300);
  });
});

describe('mergeCheckpoints', () => {
  it('upserts by id — an incoming checkpoint with the same id replaces the existing one', () => {
    const existing = [checkpoint('2026-08-01', 100, 'a'), checkpoint('2026-08-05', 200, 'b')];
    const incoming = [checkpoint('2026-08-01', 999, 'a')];
    const merged = mergeCheckpoints(existing, incoming);
    expect(merged).toHaveLength(2);
    expect(merged.find((c) => c.id === 'a')?.balance).toBe(999);
    expect(merged.find((c) => c.id === 'b')?.balance).toBe(200);
  });
});

describe('mergeAssets', () => {
  const asset = (id: string, name: string, updatedAt: number): Asset => ({ id, name, createdAt: 1, updatedAt });

  it('keeps whichever side has the later updatedAt for a shared id', () => {
    const existing = [asset('a', 'Old name', 100)];
    const incoming = [asset('a', 'New name', 200)];
    expect(mergeAssets(existing, incoming)[0].name).toBe('New name');
    // Reversed: an older incoming record must not overwrite a newer local one.
    expect(mergeAssets([asset('a', 'New name', 200)], [asset('a', 'Stale', 50)])[0].name).toBe('New name');
  });

  it('keeps records that only exist on one side', () => {
    const merged = mergeAssets([asset('a', 'A', 1)], [asset('b', 'B', 1)]);
    expect(merged.map((a) => a.id).sort()).toEqual(['a', 'b']);
  });
});

describe('netWorthHistory', () => {
  it('sums every card and asset as of each date something changed', () => {
    const cardA = {
      type: 'debit' as const,
      transactions: [tx({ date: '2026-08-01', amount: 0, balance: 100 })],
      checkpoints: [],
    };
    const points = netWorthHistory([cardA], [], []);
    expect(points).toEqual([{ date: '2026-08-01', amount: 100 }]);
  });

  it('returns an empty history with nothing to track', () => {
    expect(netWorthHistory([], [], [])).toEqual([]);
  });
});

describe('assetsNetAsOf / netWorthAsOf (the Executive Summary bridge building block)', () => {
  const asset = (id: string, kind: Asset['kind'] = 'asset'): Asset => ({ id, name: id, createdAt: 1, kind });
  const value = (assetId: string, date: string, value: number): AssetValueEntry => ({
    id: `${assetId}_${date}`,
    assetId,
    date,
    value,
    createdAt: 1,
  });

  it('assetsNetAsOf sums the latest value on or before the date, per asset, signing liabilities negative', () => {
    const assets = [asset('house'), asset('loan', 'liability')];
    const values = [value('house', '2026-01-01', 100000), value('loan', '2026-01-01', 20000)];
    expect(assetsNetAsOf(assets, values, '2026-06-01')).toBe(80000);
  });

  it('assetsNetAsOf ignores a value entered after the as-of date', () => {
    const assets = [asset('house')];
    const values = [value('house', '2026-01-01', 100000), value('house', '2026-12-01', 150000)];
    expect(assetsNetAsOf(assets, values, '2026-06-01')).toBe(100000);
  });

  it('netWorthAsOf sums every card plus every asset and reports complete when every anchor is known', () => {
    const cardA = {
      type: 'debit' as const,
      transactions: [tx({ date: '2026-08-01', amount: 0, balance: 500 })],
      checkpoints: [],
    };
    const result = netWorthAsOf([cardA], [asset('house')], [value('house', '2026-01-01', 1000)], '2026-08-15');
    expect(result).toEqual({ amount: 1500, complete: true });
  });

  it('flags incomplete when a card had activity before the as-of date but no anchor to reconstruct from', () => {
    // A transaction exists, but neither it nor anything else carries a
    // balance, and there's no manual checkpoint either — genuinely unknown,
    // not a safe zero.
    const cardA = {
      type: 'debit' as const,
      transactions: [tx({ date: '2026-08-01', amount: -50 })],
      checkpoints: [],
    };
    const result = netWorthAsOf([cardA], [], [], '2026-08-15');
    expect(result.amount).toBe(0);
    expect(result.complete).toBe(false);
  });

  it('does not flag incomplete for a card with no activity at all before the as-of date', () => {
    // The card just didn't exist yet as of this date — 0 is the correct
    // answer, not a guess.
    const cardA = {
      type: 'debit' as const,
      transactions: [tx({ date: '2026-09-01', amount: -50 })],
      checkpoints: [],
    };
    const result = netWorthAsOf([cardA], [], [], '2026-08-15');
    expect(result).toEqual({ amount: 0, complete: true });
  });
});
