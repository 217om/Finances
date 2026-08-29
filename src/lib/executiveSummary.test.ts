import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../types';
import { buildExecutiveSummary } from './executiveSummary';

let idCounter = 0;
function tx(overrides: Partial<Transaction> & { date: string; amount: number; description?: string }): Transaction {
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

const categoryOf = (t: Transaction): string => (t.amount >= 0 ? 'Income' : 'Shopping');

describe('buildExecutiveSummary', () => {
  it('returns null with absolutely nothing tracked', () => {
    expect(buildExecutiveSummary([], [], [], [], categoryOf, 1)).toBeNull();
  });

  it('reconstructs opening/closing balances from the statement anchor and bridges them with categorized transactions', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));

    const cardTxs: Transaction[] = [
      tx({ date: '2026-06-30', amount: 0, balance: 1000 }), // anchor, dated the day before the shown window
      tx({ date: '2026-07-10', amount: 500, description: 'Salary' }),
      tx({ date: '2026-07-15', amount: -200, description: 'Shopping' }),
      tx({ date: '2026-08-05', amount: 300, description: 'Salary' }),
      tx({ date: '2026-08-08', amount: -100, description: 'Shopping' }),
    ];
    const cards = [{ type: 'debit' as const, transactions: cardTxs, checkpoints: [] }];

    const summary = buildExecutiveSummary(cards, [], [], cardTxs, categoryOf, 1, 2);
    vi.useRealTimers();

    expect(summary).not.toBeNull();
    expect(summary!.periods.map((p) => p.period)).toEqual(['2026-07', '2026-08']);

    const july = summary!.periods[0];
    // Opening balance the day before July: only the anchor itself applies (no
    // transactions before it), so opening = 1000.
    expect(july.opening).toBe(1000);
    expect(july.sources).toBe(500);
    expect(july.uses).toBe(200);
    // Closing = 1000 + 500 - 200 = 1300, and the bridge should exactly
    // reconcile (no unexplained "other") since every transaction is anchored.
    expect(july.closing).toBe(1300);
    expect(july.other).toBeCloseTo(0);
    expect(july.openingComplete).toBe(true);
    expect(july.closingComplete).toBe(true);

    const august = summary!.periods[1];
    // August opens exactly where July closed.
    expect(august.opening).toBe(july.closing);
    expect(august.sources).toBe(300);
    expect(august.uses).toBe(100);
    // "Now" is fake-timed to 2026-08-15, so August's closing balance is as of
    // that day even though the calendar month runs through the 31st.
    expect(august.closing).toBe(1300 + 300 - 100);
    expect(august.other).toBeCloseTo(0);

    expect(summary!.opening).toBe(july.opening);
    expect(summary!.closing).toBe(august.closing);
    expect(summary!.netChange).toBe(august.closing - july.opening);
    expect(summary!.anyIncomplete).toBe(false);
  });

  it('flags an unknown early opening balance instead of silently assuming zero, and folds the gap into "other"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));

    // No balance column anywhere and no checkpoint — the card's true balance
    // has never been anchored, and it already had activity before the shown
    // window even starts, so July's opening balance is genuinely unknown
    // (as opposed to a card that simply didn't exist yet, which correctly
    // gets a complete 0).
    const cardTxs: Transaction[] = [
      tx({ date: '2026-06-01', amount: -999, description: 'Old spend, never anchored' }),
      tx({ date: '2026-07-05', amount: -50, description: 'Shopping' }),
      tx({ date: '2026-08-01', amount: 200, description: 'Salary' }),
    ];
    const cards = [{ type: 'debit' as const, transactions: cardTxs, checkpoints: [] }];

    const summary = buildExecutiveSummary(cards, [], [], cardTxs, categoryOf, 1, 2);
    vi.useRealTimers();

    expect(summary!.anyIncomplete).toBe(true);
    const july = summary!.periods[0];
    expect(july.opening).toBe(0); // defaulted, not reconstructed
    expect(july.openingComplete).toBe(false);
    // closing (as of end of July) is still unknown too, since there's still
    // no anchor anywhere in the data.
    expect(july.closingComplete).toBe(false);
  });

  it('isolates asset value changes from card cash flow, and includes both assets and cards in the categorized-window totals', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));

    // Anchored well before the shown window so the card side of the bridge
    // reconciles cleanly, isolating the asset revaluation in "assetChange"
    // rather than muddying it with an unrelated card-side "other" gap.
    const cardTxs: Transaction[] = [tx({ date: '2026-07-01', amount: 0, balance: 1000 })];
    const cards = [{ type: 'debit' as const, transactions: cardTxs, checkpoints: [] }];
    const assets = [{ id: 'house', name: 'House', createdAt: 1, kind: 'asset' as const }];
    const assetValues = [
      { id: 'v1', assetId: 'house', date: '2026-07-01', value: 100000, createdAt: 1 },
      { id: 'v2', assetId: 'house', date: '2026-08-10', value: 105000, createdAt: 1 },
    ];

    const summary = buildExecutiveSummary(cards, assets, assetValues, cardTxs, categoryOf, 1, 1);
    vi.useRealTimers();

    const august = summary!.periods[0];
    expect(august.assetChange).toBe(5000);
    // The asset revaluation is fully explained by assetChange, not left in "other".
    expect(august.other).toBeCloseTo(0);
  });

  it('aggregates source/use category totals across the whole shown window, sorted by amount descending', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));

    const cardTxs: Transaction[] = [
      tx({ date: '2026-07-01', amount: 0, balance: 0 }),
      tx({ date: '2026-07-10', amount: 100, description: 'Salary' }),
      tx({ date: '2026-08-05', amount: 400, description: 'Salary' }),
      tx({ date: '2026-08-06', amount: -30, description: 'Shopping' }),
    ];
    const cards = [{ type: 'debit' as const, transactions: cardTxs, checkpoints: [] }];

    const summary = buildExecutiveSummary(cards, [], [], cardTxs, categoryOf, 1, 2);
    vi.useRealTimers();

    expect(summary!.sourceCategories).toEqual([{ category: 'Income', amount: 500 }]);
    expect(summary!.useCategories).toEqual([{ category: 'Shopping', amount: 30 }]);
    expect(summary!.totalSources).toBe(500);
    expect(summary!.totalUses).toBe(30);
  });
});
