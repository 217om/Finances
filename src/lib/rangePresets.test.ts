import { describe, expect, it } from 'vitest';
import { addCalendarMonths, addDaysISO, compareOptionsFor, daysInclusive } from './rangePresets';

describe('addDaysISO', () => {
  it('adds and subtracts days across month/year boundaries', () => {
    expect(addDaysISO('2026-08-30', 3)).toBe('2026-09-02');
    expect(addDaysISO('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('addCalendarMonths', () => {
  it('clamps the day when the target month is shorter, instead of rolling over', () => {
    expect(addCalendarMonths('2026-05-31', -1)).toBe('2026-04-30');
    expect(addCalendarMonths('2026-03-31', 1)).toBe('2026-04-30');
  });

  it('clamps Jan 31 -> Feb 28/29 depending on leap year', () => {
    expect(addCalendarMonths('2025-01-31', 1)).toBe('2025-02-28');
    expect(addCalendarMonths('2024-01-31', 1)).toBe('2024-02-29');
  });

  it('handles a plain same-day shift, including across a year boundary', () => {
    expect(addCalendarMonths('2026-08-17', -12)).toBe('2025-08-17');
    expect(addCalendarMonths('2026-01-15', -1)).toBe('2025-12-15');
  });
});

describe('daysInclusive', () => {
  it('counts both endpoints', () => {
    expect(daysInclusive('2026-08-01', '2026-08-01')).toBe(1);
    expect(daysInclusive('2026-08-01', '2026-08-17')).toBe(17);
  });
});

describe('compareOptionsFor', () => {
  it('returns no options for a hand-typed custom range (preset null)', () => {
    expect(compareOptionsFor(null, '2026-08-01', '2026-08-17')).toEqual([]);
  });

  it('does not throw and returns no options when the range is not established yet', () => {
    // Regression: this happens right after a fresh cloud sync, before any
    // transactions have landed — from/to are empty strings, and the date
    // math used to throw on them (Invalid Date -> toISOString), crashing the
    // whole Dashboard instead of just having nothing to compare yet.
    expect(() => compareOptionsFor('mtd', '', '')).not.toThrow();
    expect(compareOptionsFor('mtd', '', '')).toEqual([]);
    expect(compareOptionsFor('wtd', '2026-08-01', '')).toEqual([]);
    expect(compareOptionsFor('lastMonth', '', '2026-08-01')).toEqual([]);
  });

  it('week to date: shifts by 7 days / 1 month / 1 year, preserving the span', () => {
    const opts = compareOptionsFor('wtd', '2026-08-16', '2026-08-17'); // 2-day partial week
    const lastWeek = opts.find((o) => o.key === 'lastWeek')!;
    expect(lastWeek.range).toEqual({ from: '2026-08-09', to: '2026-08-10' });
    const lastMonthWeek = opts.find((o) => o.key === 'lastMonthWeek')!;
    expect(lastMonthWeek.range).toEqual({ from: '2026-07-16', to: '2026-07-17' });
    const lastYearWeek = opts.find((o) => o.key === 'lastYearWeek')!;
    expect(lastYearWeek.range).toEqual({ from: '2025-08-16', to: '2025-08-17' });
  });

  it('month to date: same partial period last month/year, not a full prior period', () => {
    const opts = compareOptionsFor('mtd', '2026-08-01', '2026-08-17'); // 17-day partial month
    const lastMonthPeriod = opts.find((o) => o.key === 'lastMonthPeriod')!;
    expect(lastMonthPeriod.range).toEqual({ from: '2026-07-01', to: '2026-07-17' });
    const lastYearPeriod = opts.find((o) => o.key === 'lastYearPeriod')!;
    expect(lastYearPeriod.range).toEqual({ from: '2025-08-01', to: '2025-08-17' });
  });

  it('last month: a complete prior cycle compares against an equally complete one', () => {
    const opts = compareOptionsFor('lastMonth', '2026-07-01', '2026-07-31'); // full 31-day month
    const monthBefore = opts.find((o) => o.key === 'monthBefore')!;
    expect(monthBefore.range).toEqual({ from: '2026-05-31', to: '2026-06-30' });
  });

  it('last 3 months: shifts back 3 months, keeping the exact span even across day-overflow', () => {
    const opts = compareOptionsFor('last3', '2026-01-31', '2026-03-31');
    const prev3 = opts.find((o) => o.key === 'prev3Months')!;
    expect(prev3.range.to).toBe('2025-12-31');
  });
});
