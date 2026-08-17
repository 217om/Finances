import { describe, expect, it } from 'vitest';
import type { Transaction } from '../types';
import {
  actualSpend,
  cycleBounds,
  mergeBudgetEntries,
  mergeBudgets,
  windowDayCount,
  weekWindowsForCycle,
  type Budget,
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
});
