import { describe, expect, it } from 'vitest';
import type { Transaction } from '../types';
import {
  actualSpend,
  cycleBounds,
  dayOffsetInWindow,
  deleteBudget,
  mergeBudgetEntries,
  mergeBudgets,
  setBudgetAmount,
  weekTarget,
  windowDayCount,
  weekWindowsForCycle,
  type Budget,
  type BudgetCycleAmount,
  type BudgetEntry,
} from './budget';

let idCounter = 0;
function tx(date: string, amount: number, description = 'Test'): Transaction {
  idCounter += 1;
  return { id: `tx_${idCounter}`, date, amount, description, month: date.slice(0, 7), source: 'test.csv', importedAt: 1 };
}

describe('cycleBounds', () => {
  it('with monthStartDay 1, a period is the plain calendar month', () => {
    expect(cycleBounds('2026-08', 1)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
  });

  it('with a later monthStartDay, the cycle runs into the next calendar month', () => {
    expect(cycleBounds('2026-08', 25)).toEqual({ from: '2026-08-25', to: '2026-09-24' });
  });

  it('handles a December cycle rolling into January', () => {
    expect(cycleBounds('2026-12', 1)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('weekWindowsForCycle', () => {
  it('fully covers the cycle with contiguous, non-overlapping windows', () => {
    const bounds = cycleBounds('2026-08', 1);
    const windows = weekWindowsForCycle('2026-08', 1, 1);
    expect(windows[0].from).toBe(bounds.from);
    expect(windows[windows.length - 1].to).toBe(bounds.to);
    const totalDays = windows.reduce((a, w) => a + windowDayCount(w), 0);
    const cycleDays = windowDayCount(bounds);
    expect(totalDays).toBe(cycleDays);
    // Every window but possibly the first/last is a full, unclipped 7-day week.
    for (const w of windows.slice(1, -1)) {
      expect(windowDayCount(w)).toBe(7);
      expect(w.partial).toBe(false);
    }
  });

  it('bails out gracefully for a shorter cycle too', () => {
    const windows = weekWindowsForCycle('2026-02', 1, 1);
    const bounds = cycleBounds('2026-02', 1);
    expect(windows[0].from).toBe(bounds.from);
    expect(windows[windows.length - 1].to).toBe(bounds.to);
  });
});

describe('actualSpend', () => {
  it('sums only matching-category expenses within the date range', () => {
    const txs = [
      tx('2026-08-05', -50, 'in range, matching'),
      tx('2026-08-20', -30, 'out of range'),
      tx('2026-08-10', 200, 'income, ignored even if category matched'),
    ];
    const categoryOf = (t: Transaction) => (t.description.includes('matching') ? 'Groceries' : 'Other');
    expect(actualSpend(txs, categoryOf, ['Groceries'], '2026-08-01', '2026-08-15')).toBe(50);
  });

  it('returns 0 for an empty category list', () => {
    expect(actualSpend([tx('2026-08-01', -10)], () => 'Groceries', [], '2026-08-01', '2026-08-31')).toBe(0);
  });
});

describe('mergeBudgets / mergeBudgetEntries', () => {
  it('mergeBudgets keeps whichever side has the later updatedAt for a shared id', () => {
    const a: Budget = { id: 'b1', name: 'Old', categories: [], updatedAt: 100 };
    const b: Budget = { id: 'b1', name: 'New', categories: [], updatedAt: 200 };
    expect(mergeBudgets([a], [b])[0].name).toBe('New');
    expect(mergeBudgets([b], [a])[0].name).toBe('New');
  });

  it('mergeBudgetEntries upserts by (budgetId, weekStart), newest wins', () => {
    const existing: BudgetEntry[] = [{ budgetId: 'b1', weekStart: '2026-08-01', amount: 100, updatedAt: 1 }];
    const incoming: BudgetEntry[] = [{ budgetId: 'b1', weekStart: '2026-08-01', amount: 999, updatedAt: 2 }];
    const merged = mergeBudgetEntries(existing, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0].amount).toBe(999);
  });

  it('a tombstoned (deleted) budget with the later updatedAt survives the merge instead of being resurrected', () => {
    // This is the sync bug: an older backup (e.g. still sitting in the
    // cloud, or on another device) still has the budget the user deleted
    // here. Without a tombstone, merge would just see "not present locally"
    // and always accept the incoming live copy.
    const deletedLocally: Budget = { id: 'b1', name: 'Groceries', categories: [], updatedAt: 200, deletedAt: 200 };
    const staleIncoming: Budget = { id: 'b1', name: 'Groceries', categories: ['Groceries'], updatedAt: 100 };
    const merged = mergeBudgets([deletedLocally], [staleIncoming]);
    expect(merged[0].deletedAt).toBe(200);
  });

  it('a genuinely newer incoming edit still wins over an older local deletion', () => {
    // Deleted here, then edited on another device afterwards — last write
    // wins, same as any other field.
    const deletedLocally: Budget = { id: 'b1', name: 'Groceries', categories: [], updatedAt: 100, deletedAt: 100 };
    const newerIncoming: Budget = { id: 'b1', name: 'Groceries', categories: ['Groceries'], updatedAt: 300 };
    const merged = mergeBudgets([deletedLocally], [newerIncoming]);
    expect(merged[0].deletedAt).toBeUndefined();
  });

  it('deleteBudget tombstones instead of removing, and setBudgetAmount tombstones a cleared week', () => {
    const budgets = deleteBudget([{ id: 'b1', name: 'Groceries', categories: [] }], 'b1');
    expect(budgets).toHaveLength(1);
    expect(budgets[0].deletedAt).toBeGreaterThan(0);

    const entries = setBudgetAmount([{ budgetId: 'b1', weekStart: '2026-08-01', amount: 50 }], 'b1', '2026-08-01', 0);
    expect(entries).toHaveLength(1);
    expect(entries[0].deletedAt).toBeGreaterThan(0);
  });
});

describe('weekTarget (budget cadence)', () => {
  const budget = (over: Partial<Budget>): Budget => ({ id: 'b1', name: 'B', categories: [], ...over });
  const bounds = cycleBounds('2026-08', 1); // 2026-08-01 .. 2026-08-31, 31 days

  it('weekly cadence reads the amount typed directly into that week', () => {
    const b = budget({ cadence: 'weekly' });
    const entries: BudgetEntry[] = [{ budgetId: 'b1', weekStart: '2026-08-03', amount: 75 }];
    const window = { weekStart: '2026-08-03', from: '2026-08-03', to: '2026-08-09' };
    expect(weekTarget(b, '2026-08', bounds, window, entries, [])).toBe(75);
  });

  it('daily cadence multiplies the one entered rate by that week\'s actual day count', () => {
    const b = budget({ cadence: 'daily' });
    const cycleAmounts: BudgetCycleAmount[] = [{ budgetId: 'b1', period: '2026-08', amount: 10 }];
    const fullWeek = { weekStart: '2026-08-03', from: '2026-08-03', to: '2026-08-09' };
    const partialWeek = { weekStart: '2026-07-27', from: '2026-08-01', to: '2026-08-02' };
    expect(weekTarget(b, '2026-08', bounds, fullWeek, [], cycleAmounts)).toBe(70);
    expect(weekTarget(b, '2026-08', bounds, partialWeek, [], cycleAmounts)).toBe(20);
  });

  it('monthly cadence spreads the one entered total across weeks by day-share', () => {
    const b = budget({ cadence: 'monthly' });
    const cycleAmounts: BudgetCycleAmount[] = [{ budgetId: 'b1', period: '2026-08', amount: 310 }];
    const fullWeek = { weekStart: '2026-08-03', from: '2026-08-03', to: '2026-08-09' };
    // 31-day cycle, 310 total -> 10/day -> a 7-day week gets 70.
    expect(weekTarget(b, '2026-08', bounds, fullWeek, [], cycleAmounts)).toBe(70);
  });

  it('missing cadence defaults to weekly (pre-existing budgets keep working)', () => {
    const b = budget({});
    const entries: BudgetEntry[] = [{ budgetId: 'b1', weekStart: '2026-08-03', amount: 42 }];
    const window = { weekStart: '2026-08-03', from: '2026-08-03', to: '2026-08-09' };
    expect(weekTarget(b, '2026-08', bounds, window, entries, [])).toBe(42);
  });
});

describe('dayOffsetInWindow', () => {
  it('is 1-based, counting from the window\'s own start', () => {
    expect(dayOffsetInWindow({ from: '2026-08-03' }, '2026-08-03')).toBe(1);
    expect(dayOffsetInWindow({ from: '2026-08-03' }, '2026-08-05')).toBe(3);
  });
});
