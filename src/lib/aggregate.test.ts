import { describe, expect, it } from 'vitest';
import type { Transaction } from '../types';
import { addMonths, buildOverview, periodKey, startOfWeek, summarizeByMonth } from './aggregate';

let idCounter = 0;
function tx(date: string, amount: number, description = 'Test'): Transaction {
  idCounter += 1;
  return { id: `tx_${idCounter}`, date, amount, description, month: date.slice(0, 7), source: 'test.csv', importedAt: 1 };
}

describe('addMonths', () => {
  it('adds and subtracts whole months, rolling over the year', () => {
    expect(addMonths('2026-01', 1)).toBe('2026-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
  });
});

describe('periodKey', () => {
  it('with startDay 1, every date belongs to its own calendar month', () => {
    expect(periodKey('2026-08-15', 1)).toBe('2026-08');
  });

  it('with a later startDay, a date before it belongs to the previous period', () => {
    // Pay cycle starts on the 25th: Aug 24 is still "July's" period.
    expect(periodKey('2026-08-24', 25)).toBe('2026-07');
    expect(periodKey('2026-08-25', 25)).toBe('2026-08');
  });
});

describe('startOfWeek', () => {
  // 2026-08-17 is a Monday.
  it('defaults to Monday as the week start', () => {
    expect(startOfWeek('2026-08-19')).toBe('2026-08-17');
  });

  it('honors a different week-start day (0 = Sunday)', () => {
    expect(startOfWeek('2026-08-19', 0)).toBe('2026-08-16');
  });
});

describe('summarizeByMonth', () => {
  it('gap-fills a quiet month between two active ones as a flat zero', () => {
    const txs = [tx('2026-06-01', 100), tx('2026-08-01', -50)];
    const months = summarizeByMonth(txs, 1);
    expect(months.map((m) => m.month)).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(months[1]).toMatchObject({ income: 0, expenses: 0, net: 0, txCount: 0 });
  });

  it('returns nothing for an empty transaction list', () => {
    expect(summarizeByMonth([], 1)).toEqual([]);
  });
});

describe('buildOverview', () => {
  it('sums income and expenses across active months only', () => {
    const txs = [tx('2026-08-01', 1000), tx('2026-08-05', -200), tx('2026-08-10', -100)];
    const overview = buildOverview(txs, 1);
    expect(overview.totalIncome).toBe(1000);
    expect(overview.totalExpenses).toBe(300);
    expect(overview.totalNet).toBe(700);
    expect(overview.savingsRate).toBeCloseTo(70, 5);
  });

  it('reports a null savings rate contribution when there is no income', () => {
    const txs = [tx('2026-08-01', -100)];
    const overview = buildOverview(txs, 1);
    expect(overview.savingsRate).toBe(0);
  });

  it('drops a prior week/month clipped by the caller\'s date filter instead of comparing against it', () => {
    // Full history goes back to June; the caller (e.g. a "Month to date"
    // dashboard filter) only hands buildOverview the Aug 1-7 slice. Aug 1
    // isn't a Monday, so the week bucket before Aug 3 only has 2 real days
    // of data — comparing against it would produce a nonsense percentage.
    const fullHistoryStart = '2026-06-01';
    const rangeStart = '2026-08-01';
    const txs = [tx('2026-08-01', -50), tx('2026-08-02', -10), tx('2026-08-05', -1000)];
    const overview = buildOverview(txs, 1, undefined, 1, rangeStart, fullHistoryStart);
    expect(overview.priorWeek).toBeNull();
    expect(overview.weekChangePct).toBeNull();
  });

  it('keeps the prior week/month comparison when nothing was clipped', () => {
    // No external date filter in play (rangeStart === historyStart), so a
    // genuinely quiet prior week is still a real, comparable data point.
    const start = '2026-07-27';
    const txs = [tx('2026-07-27', -100), tx('2026-08-03', -50)];
    const overview = buildOverview(txs, 1, undefined, 1, start, start);
    expect(overview.priorWeek).not.toBeNull();
    expect(overview.weekChangePct).not.toBeNull();
  });
});
