import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../types';
import { buildCustomRangeSummary, buildPeriodBreakdowns, hasSalaryRuleMatch, type SalaryRule } from './executiveSummary';

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

    const periods = buildPeriodBreakdowns(cards, [], [], cardTxs, categoryOf, 1, 1, 'month', 1);
    vi.useRealTimers();
    const summary = periods[0];

    expect(summary.uses.top).toEqual([
      { category: 'Groceries', amount: 100 },
      { category: 'Dining', amount: 90 },
      { category: 'Transport', amount: 80 },
      { category: 'Utilities', amount: 70 },
      { category: 'Shopping', amount: 60 },
    ]);
    // Entertainment (30) + Health (10), the 6th and 7th ranked categories.
    expect(summary.uses.otherTotal).toBe(40);
    expect(summary.uses.total).toBe(440);
  });

  it('folds an unreconciled balance gap into otherTotal instead of a separate line', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));

    // No anchor at all — the whole closing balance is an unexplained gap
    // relative to the (zero) categorized transactions this period.
    const cardTxs: Transaction[] = [tx({ date: '2026-08-01', amount: 0, balance: 300, description: 'Anchor mid-period' })];
    const cards = [{ type: 'debit' as const, transactions: cardTxs, checkpoints: [] }];

    const periods = buildPeriodBreakdowns(cards, [], [], cardTxs, categoryOf, 1, 1, 'month', 1);
    vi.useRealTimers();
    const summary = periods[0];

    // opening (July 31) has no anchor at all -> 0; closing (as of today) = 300.
    expect(summary.opening).toBe(0);
    expect(summary.closing).toBe(300);
    expect(summary.sources.top).toEqual([]);
    expect(summary.sources.otherTotal).toBe(300);
    expect(summary.sources.total).toBe(300);
    expect(summary.uses.total).toBe(0);
  });

  it('drops leading periods with no activity at all, but keeps the current period even if it too is empty', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0)); // Aug 15

    // Only June and July have any real data; asking for 6 trailing months
    // (Mar–Aug) should drop the empty leading Mar/Apr/May columns, but keep
    // August even though nothing has happened there yet — it's "now".
    const cardTxs: Transaction[] = [
      tx({ date: '2026-06-05', amount: -50, description: 'Groceries' }),
      tx({ date: '2026-07-01', amount: 200, description: 'Salary' }),
    ];
    const cards = [{ type: 'debit' as const, transactions: cardTxs, checkpoints: [] }];

    const periods = buildPeriodBreakdowns(cards, [], [], cardTxs, categoryOf, 1, 1, 'month'); // default count (6)
    vi.useRealTimers();

    expect(periods.map((p) => p.period)).toEqual(['2026-06', '2026-07', '2026-08']);
  });

  it('keeps every period (even all-empty ones) when nothing at all ever happened', () => {
    // A checkpoint dated today with a zero balance: hasAnyData is true (a
    // checkpoint exists), but every computed period is "empty" by the
    // trim's own definition — should fall back to showing the full window
    // rather than an empty result.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));

    const cards = [{ type: 'debit' as const, transactions: [], checkpoints: [{ id: 'c1', date: '2026-08-15', balance: 0, createdAt: 1 }] }];
    const periods = buildPeriodBreakdowns(cards, [], [], [], categoryOf, 1, 1, 'month', 3);
    vi.useRealTimers();

    expect(periods).toHaveLength(3);
  });
});

describe('buildCustomRangeSummary', () => {
  it('builds one breakdown for the exact picked [from, to] span, spanning arbitrary period boundaries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 20, 12, 0, 0));

    const cardTxs: Transaction[] = [
      tx({ date: '2026-07-14', amount: 0, balance: 1000 }), // anchor, day before the picked window
      tx({ date: '2026-07-20', amount: 400, description: 'Salary' }),
      tx({ date: '2026-08-01', amount: -150, description: 'Rent' }),
    ];
    const cards = [{ type: 'debit' as const, transactions: cardTxs, checkpoints: [] }];

    // A range that crosses a pay-cycle month boundary, which a trailing
    // monthly/weekly period could never express on its own.
    const summary = buildCustomRangeSummary(cards, [], [], cardTxs, categoryOf, '2026-07-15', '2026-08-05');
    vi.useRealTimers();

    expect(summary.from).toBe('2026-07-15');
    expect(summary.to).toBe('2026-08-05');
    expect(summary.opening).toBe(1000);
    expect(summary.sources.top).toEqual([{ category: 'Salary', amount: 400 }]);
    expect(summary.uses.top).toEqual([{ category: 'Rent', amount: 150 }]);
    expect(summary.closing).toBe(1000 + 400 - 150);
  });

  it('swaps from/to when given in reverse order, and clamps to today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 10, 12, 0, 0));

    const cards = [{ type: 'debit' as const, transactions: [], checkpoints: [] }];
    const summary = buildCustomRangeSummary(cards, [], [], [], categoryOf, '2026-08-25', '2026-08-01');
    vi.useRealTimers();

    expect(summary.from).toBe('2026-08-01');
    // 2026-08-25 is in the future relative to the fake-timed "today" (Aug 10) -> clamped.
    expect(summary.to).toBe('2026-08-10');
  });
});

describe('buildPeriodBreakdowns with a salaryRule (month granularity)', () => {
  const salaryRule: SalaryRule = { category: 'Salary', minAmount: 1000, maxAmount: null };

  it('opens each period on the actual salary date instead of a fixed day-of-month', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 20, 12, 0, 0)); // Aug 20

    const cardTxs: Transaction[] = [
      tx({ date: '2026-06-24', amount: 0, balance: 500, description: 'Anchor' }),
      tx({ date: '2026-06-27', amount: 1500, description: 'Salary' }), // irregular payday
      tx({ date: '2026-07-01', amount: -200, description: 'Rent' }),
      tx({ date: '2026-07-29', amount: 1500, description: 'Salary' }), // shifted earlier this cycle
      tx({ date: '2026-08-01', amount: -50, description: 'Groceries' }),
    ];
    const cards = [{ type: 'debit' as const, transactions: cardTxs, checkpoints: [] }];

    const periods = buildPeriodBreakdowns(cards, [], [], cardTxs, categoryOf, 1, 1, 'month', undefined, salaryRule);
    vi.useRealTimers();

    expect(periods.map((p) => p.from)).toEqual(['2026-06-27', '2026-07-29']);
    expect(periods[0].to).toBe('2026-07-28'); // day before the next salary date
    expect(periods[1].to).toBe('2026-08-20'); // in-progress period runs through "today"
    expect(periods[0].opening).toBe(500);
    // June's salary itself lands ON the period's first day, so it's part of
    // that period's Sources, not folded into the prior (unshown) opening.
    expect(periods[0].sources.top).toEqual([{ category: 'Salary', amount: 1500 }]);
    expect(periods[0].uses.top).toEqual([{ category: 'Rent', amount: 200 }]);
    expect(periods[1].sources.top).toEqual([{ category: 'Salary', amount: 1500 }]);
  });

  it('falls back to the fixed pay-cycle when the rule matches nothing yet', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));

    const cardTxs: Transaction[] = [tx({ date: '2026-08-05', amount: 500, description: 'Freelance' })];
    const cards = [{ type: 'debit' as const, transactions: cardTxs, checkpoints: [] }];

    const withRule = buildPeriodBreakdowns(cards, [], [], cardTxs, categoryOf, 1, 1, 'month', 2, salaryRule);
    const withoutRule = buildPeriodBreakdowns(cards, [], [], cardTxs, categoryOf, 1, 1, 'month', 2, null);
    vi.useRealTimers();

    expect(withRule.map((p) => p.period)).toEqual(withoutRule.map((p) => p.period));
  });

  it('respects the min/max amount bounds, ignoring same-category transactions outside them', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));

    const cardTxs: Transaction[] = [
      tx({ date: '2026-08-01', amount: 50, description: 'Salary' }), // categorized right, too small to count
      tx({ date: '2026-08-10', amount: 1200, description: 'Salary' }), // the real payday
    ];
    const cards = [{ type: 'debit' as const, transactions: cardTxs, checkpoints: [] }];

    const periods = buildPeriodBreakdowns(cards, [], [], cardTxs, categoryOf, 1, 1, 'month', 1, salaryRule);
    vi.useRealTimers();

    expect(periods).toHaveLength(1);
    expect(periods[0].from).toBe('2026-08-10');
  });

  it('leaves week granularity on the calendar week regardless of a configured salaryRule', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));

    const cardTxs: Transaction[] = [tx({ date: '2026-08-10', amount: 1200, description: 'Salary' })];
    const cards = [{ type: 'debit' as const, transactions: cardTxs, checkpoints: [] }];

    const withRule = buildPeriodBreakdowns(cards, [], [], cardTxs, categoryOf, 1, 1, 'week', 2, salaryRule);
    const withoutRule = buildPeriodBreakdowns(cards, [], [], cardTxs, categoryOf, 1, 1, 'week', 2, null);
    vi.useRealTimers();

    expect(withRule.map((p) => p.from)).toEqual(withoutRule.map((p) => p.from));
  });
});

describe('hasSalaryRuleMatch', () => {
  const rule: SalaryRule = { category: 'Salary', minAmount: 1000, maxAmount: 2000 };

  it('is true only when a transaction matches category and amount range', () => {
    expect(hasSalaryRuleMatch([tx({ date: '2026-08-10', amount: 1500, description: 'Salary' })], categoryOf, rule)).toBe(true);
    expect(hasSalaryRuleMatch([tx({ date: '2026-08-10', amount: 500, description: 'Salary' })], categoryOf, rule)).toBe(false);
    expect(hasSalaryRuleMatch([tx({ date: '2026-08-10', amount: 1500, description: 'Bonus' })], categoryOf, rule)).toBe(false);
    expect(hasSalaryRuleMatch([], categoryOf, rule)).toBe(false);
  });
});
