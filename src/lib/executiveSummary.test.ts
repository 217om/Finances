import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../types';
import { buildExecutiveSummary, currentPeriodSummary } from './executiveSummary';

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

describe('buildExecutiveSummary', () => {
  it('returns null with absolutely nothing tracked', () => {
    expect(buildExecutiveSummary([], [], [], [], 1)).toBeNull();
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

    const summary = buildExecutiveSummary(cards, [], [], cardTxs, 1, 1, 'month', 2);
    vi.useRealTimers();

    expect(summary).not.toBeNull();
    expect(summary!.periods.map((p) => p.period)).toEqual(['2026-07', '2026-08']);
    expect(summary!.periods.map((p) => p.label)).toEqual(['Jul 2026', 'Aug 2026']);

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

    const summary = buildExecutiveSummary(cards, [], [], cardTxs, 1, 1, 'month', 2);
    vi.useRealTimers();

    expect(summary!.anyIncomplete).toBe(true);
    const july = summary!.periods[0];
    expect(july.opening).toBe(0); // defaulted, not reconstructed
    expect(july.openingComplete).toBe(false);
    // closing (as of end of July) is still unknown too, since there's still
    // no anchor anywhere in the data.
    expect(july.closingComplete).toBe(false);
  });

  it('isolates asset value changes from card cash flow', () => {
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

    const summary = buildExecutiveSummary(cards, assets, assetValues, cardTxs, 1, 1, 'month', 1);
    vi.useRealTimers();

    const august = summary!.periods[0];
    expect(august.assetChange).toBe(5000);
    // The asset revaluation is fully explained by assetChange, not left in "other".
    expect(august.other).toBeCloseTo(0);
  });

  it('week granularity buckets by week-start instead of pay-cycle month, honoring weekStartDay', () => {
    vi.useFakeTimers();
    // A Saturday.
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));

    const cardTxs: Transaction[] = [
      tx({ date: '2026-08-02', amount: 0, balance: 1000 }), // a Sunday, anchor
      tx({ date: '2026-08-05', amount: 200, description: 'Salary' }), // Wednesday, week of Aug 2
      tx({ date: '2026-08-10', amount: -50, description: 'Shopping' }), // Monday, week of Aug 9
    ];
    const cards = [{ type: 'debit' as const, transactions: cardTxs, checkpoints: [] }];

    // weekStartDay = 0 (Sunday) so Aug 2 (a Sunday) starts its own week.
    const summary = buildExecutiveSummary(cards, [], [], cardTxs, 1, 0, 'week', 2);
    vi.useRealTimers();

    expect(summary!.periods.map((p) => p.period)).toEqual(['2026-08-02', '2026-08-09']);
    expect(summary!.periods[0].from).toBe('2026-08-02');
    expect(summary!.periods[0].to).toBe('2026-08-08');
    expect(summary!.periods[0].label).toBe('Aug 2 – Aug 8');
    expect(summary!.periods[0].sources).toBe(200);

    // The second (current, in-progress) week is clipped to "today" (Aug 15
    // fake-timed), not the full Aug 9–15 span end.
    expect(summary!.periods[1].to).toBe('2026-08-15');
    expect(summary!.periods[1].uses).toBe(50);
  });
});

const categoryOf = (t: Transaction): string => t.description;

describe('currentPeriodSummary', () => {
  it('returns null with absolutely nothing tracked', () => {
    expect(currentPeriodSummary([], [], [], [], categoryOf, 1)).toBeNull();
  });

  it('reconstructs the current period opening/closing and totals sources/uses', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0)); // Aug 15

    const cardTxs: Transaction[] = [
      tx({ date: '2026-07-31', amount: 0, balance: 1000, description: 'Anchor' }),
      tx({ date: '2026-08-05', amount: 500, description: 'Salary' }),
      tx({ date: '2026-08-06', amount: -80, description: 'Groceries' }),
    ];
    const cards = [{ type: 'debit' as const, transactions: cardTxs, checkpoints: [] }];

    const summary = currentPeriodSummary(cards, [], [], cardTxs, categoryOf, 1, 1, 'month');
    vi.useRealTimers();

    expect(summary!.period).toBe('2026-08');
    expect(summary!.label).toBe('Aug 2026');
    expect(summary!.opening).toBe(1000);
    expect(summary!.closing).toBe(1420); // 1000 + 500 - 80
    expect(summary!.netChange).toBe(420);
    expect(summary!.sources.total).toBe(500);
    expect(summary!.sources.top).toEqual([{ category: 'Salary', amount: 500 }]);
    expect(summary!.sources.otherTotal).toBe(0);
    expect(summary!.uses.total).toBe(80);
    expect(summary!.uses.top).toEqual([{ category: 'Groceries', amount: 80 }]);
    expect(summary!.uses.otherTotal).toBe(0);
  });

  it('caps the breakdown at the top 5 categories, folding the rest into otherTotal', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));

    const cardTxs: Transaction[] = [
      tx({ date: '2026-07-31', amount: 0, balance: 0, description: 'Anchor' }),
      tx({ date: '2026-08-01', amount: -100, description: 'Groceries' }),
      tx({ date: '2026-08-02', amount: -90, description: 'Dining' }),
      tx({ date: '2026-08-03', amount: -80, description: 'Transport' }),
      tx({ date: '2026-08-04', amount: -70, description: 'Utilities' }),
      tx({ date: '2026-08-05', amount: -60, description: 'Shopping' }),
      tx({ date: '2026-08-06', amount: -30, description: 'Entertainment' }),
      tx({ date: '2026-08-07', amount: -10, description: 'Health' }),
    ];
    const cards = [{ type: 'debit' as const, transactions: cardTxs, checkpoints: [] }];

    const summary = currentPeriodSummary(cards, [], [], cardTxs, categoryOf, 1, 1, 'month');
    vi.useRealTimers();

    expect(summary!.uses.top).toEqual([
      { category: 'Groceries', amount: 100 },
      { category: 'Dining', amount: 90 },
      { category: 'Transport', amount: 80 },
      { category: 'Utilities', amount: 70 },
      { category: 'Shopping', amount: 60 },
    ]);
    // Entertainment (30) + Health (10), the 6th and 7th ranked categories.
    expect(summary!.uses.otherTotal).toBe(40);
    expect(summary!.uses.total).toBe(440);
  });

  it('folds an unreconciled balance gap into otherTotal instead of a separate line', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));

    // No anchor at all — the whole closing balance is an unexplained gap
    // relative to the (zero) categorized transactions this period.
    const cardTxs: Transaction[] = [tx({ date: '2026-08-01', amount: 0, balance: 300, description: 'Anchor mid-period' })];
    const cards = [{ type: 'debit' as const, transactions: cardTxs, checkpoints: [] }];

    const summary = currentPeriodSummary(cards, [], [], cardTxs, categoryOf, 1, 1, 'month');
    vi.useRealTimers();

    // opening (July 31) has no anchor at all -> 0; closing (as of today) = 300.
    expect(summary!.opening).toBe(0);
    expect(summary!.closing).toBe(300);
    expect(summary!.sources.top).toEqual([]);
    expect(summary!.sources.otherTotal).toBe(300);
    expect(summary!.sources.total).toBe(300);
    expect(summary!.uses.total).toBe(0);
  });
});
