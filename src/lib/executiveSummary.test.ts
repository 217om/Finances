import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../types';
import { buildPeriodBreakdowns, currentPeriodSummary } from './executiveSummary';

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

const categoryOf = (t: Transaction): string => t.description;

describe('buildPeriodBreakdowns', () => {
  it('returns an empty array with absolutely nothing tracked', () => {
    expect(buildPeriodBreakdowns([], [], [], [], categoryOf, 1)).toEqual([]);
  });

  it('gives each period its own full opening/closing + sources/uses breakdown, chronologically', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));

    const cardTxs: Transaction[] = [
      tx({ date: '2026-06-30', amount: 0, balance: 1000 }), // anchor, dated the day before the shown window
      tx({ date: '2026-07-10', amount: 500, description: 'Salary' }),
      tx({ date: '2026-07-15', amount: -200, description: 'Shopping' }),
      tx({ date: '2026-08-05', amount: 300, description: 'Freelance' }),
      tx({ date: '2026-08-08', amount: -100, description: 'Groceries' }),
    ];
    const cards = [{ type: 'debit' as const, transactions: cardTxs, checkpoints: [] }];

    const periods = buildPeriodBreakdowns(cards, [], [], cardTxs, categoryOf, 1, 1, 'month', 2);
    vi.useRealTimers();

    expect(periods.map((p) => p.period)).toEqual(['2026-07', '2026-08']);
    expect(periods.map((p) => p.label)).toEqual(['Jul 2026', 'Aug 2026']);

    const july = periods[0];
    expect(july.opening).toBe(1000);
    expect(july.sources.top).toEqual([{ category: 'Salary', amount: 500 }]);
    expect(july.uses.top).toEqual([{ category: 'Shopping', amount: 200 }]);
    // Closing = 1000 + 500 - 200 = 1300, and the bridge exactly reconciles
    // (no otherTotal) since every transaction is anchored.
    expect(july.closing).toBe(1300);
    expect(july.sources.otherTotal).toBe(0);
    expect(july.uses.otherTotal).toBe(0);

    const august = periods[1];
    // August opens exactly where July closed, and has its OWN (different)
    // top categories, unrelated to July's.
    expect(august.opening).toBe(july.closing);
    expect(august.sources.top).toEqual([{ category: 'Freelance', amount: 300 }]);
    expect(august.uses.top).toEqual([{ category: 'Groceries', amount: 100 }]);
    // "Now" is fake-timed to 2026-08-15, so August's closing balance is as of
    // that day even though the calendar month runs through the 31st.
    expect(august.closing).toBe(1300 + 300 - 100);
  });

  it('week granularity buckets by week-start instead of pay-cycle month, honoring weekStartDay', () => {
    vi.useFakeTimers();
    // A Saturday.
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));

    const cardTxs: Transaction[] = [
      tx({ date: '2026-08-01', amount: 0, balance: 1000 }), // a Saturday, anchor dated the day before the window
      tx({ date: '2026-08-05', amount: 200, description: 'Salary' }), // Wednesday, week of Aug 2
      tx({ date: '2026-08-10', amount: -50, description: 'Shopping' }), // Monday, week of Aug 9
    ];
    const cards = [{ type: 'debit' as const, transactions: cardTxs, checkpoints: [] }];

    // weekStartDay = 0 (Sunday) so Aug 2 (a Sunday) starts its own week.
    const periods = buildPeriodBreakdowns(cards, [], [], cardTxs, categoryOf, 1, 0, 'week', 2);
    vi.useRealTimers();

    expect(periods.map((p) => p.period)).toEqual(['2026-08-02', '2026-08-09']);
    expect(periods[0].from).toBe('2026-08-02');
    expect(periods[0].to).toBe('2026-08-08');
    expect(periods[0].label).toBe('Aug 2 – Aug 8');
    expect(periods[0].sources.total).toBe(200);

    // The second (current, in-progress) week is clipped to "today" (Aug 15
    // fake-timed), not the full Aug 9–15 span end.
    expect(periods[1].to).toBe('2026-08-15');
    expect(periods[1].uses.total).toBe(50);
  });
});

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
