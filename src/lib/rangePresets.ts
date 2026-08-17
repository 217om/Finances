// Shared date-range presets — used by the Dashboard's own range controls and
// by any other view that wants the same "week/month to date, last month,
// last 3 months" choices, all in terms of the user's own pay-cycle and week
// start days rather than plain calendar months/weeks.

import { startOfWeek } from './aggregate';
import { adjacentPeriod, cycleBounds, currentCyclePeriod, todayISO } from './budget';

export type PresetKey = 'wtd' | 'mtd' | 'lastMonth' | 'last3';

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'wtd', label: 'Week to date' },
  { key: 'mtd', label: 'Month to date' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'last3', label: 'Last 3 months' },
];

/** A preset's [from, to] span — "last month" is the pay-cycle right before
 *  the one containing today, not the 1st-to-last-day calendar month, and
 *  "week to date" starts on the same weekday the Budgets tab's own weekly
 *  columns do. */
export function presetRange(
  key: PresetKey,
  monthStartDay: number,
  weekStartDay: number,
  bounds: { min: string; max: string },
): { from: string; to: string } {
  const clamp = (d: string) => (d < bounds.min ? bounds.min : d > bounds.max ? bounds.max : d);

  if (key === 'wtd') {
    return { from: clamp(startOfWeek(todayISO(), weekStartDay)), to: bounds.max };
  }

  const current = currentCyclePeriod(monthStartDay);
  if (key === 'lastMonth') {
    const { from, to } = cycleBounds(adjacentPeriod(current, -1), monthStartDay);
    return { from: clamp(from), to: clamp(to) };
  }
  // 'mtd' starts at the current cycle; 'last3' starts two cycles earlier, so
  // it spans this partial cycle plus the two full ones before it. Both run
  // through the latest data available, not all the way to today, so a card
  // whose last import is old doesn't show a mostly-empty trailing gap.
  const startPeriod = key === 'last3' ? adjacentPeriod(current, -2) : current;
  const { from } = cycleBounds(startPeriod, monthStartDay);
  return { from: clamp(from), to: bounds.max };
}

export function addDaysISO(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** Shifts a date by whole calendar months, clamping the day when the target
 *  month is shorter (May 31 minus 1 month is April 30, not "May 1" — which
 *  is what naive Date arithmetic would silently roll over to). */
export function addCalendarMonths(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const targetIdx = m - 1 + delta;
  const ny = y + Math.floor(targetIdx / 12);
  const nm0 = ((targetIdx % 12) + 12) % 12;
  const daysInTarget = new Date(Date.UTC(ny, nm0 + 1, 0)).getUTCDate();
  const day = Math.min(d, daysInTarget);
  return `${ny}-${String(nm0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function daysInclusive(fromISO: string, toISO: string): number {
  const [y1, m1, d1] = fromISO.split('-').map(Number);
  const [y2, m2, d2] = toISO.split('-').map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86400000) + 1;
}

export interface CompareOption {
  key: string;
  label: string;
  range: { from: string; to: string };
}

/** One comparison target per preset, each shifting the *end* of the current
 *  range back by a calendar amount and then taking the same number of days
 *  the current range spans — so a still-partial period (week/month to date)
 *  compares against an equally partial one instead of a full prior period,
 *  and a complete one (last month, last 3 months) compares against an
 *  equally complete one. No well-defined comparison exists for a hand-typed
 *  custom range, so this returns none then. */
const COMPARE_SHIFTS: Record<PresetKey, { key: string; label: string; monthsBack?: number; daysBack?: number }[]> = {
  wtd: [
    { key: 'lastWeek', label: 'Last week', daysBack: 7 },
    { key: 'lastMonthWeek', label: 'Same week last month', monthsBack: 1 },
    { key: 'lastYearWeek', label: 'Same week last year', monthsBack: 12 },
  ],
  mtd: [
    { key: 'lastMonthPeriod', label: 'Same period last month', monthsBack: 1 },
    { key: 'lastYearPeriod', label: 'Same period last year', monthsBack: 12 },
  ],
  lastMonth: [
    { key: 'monthBefore', label: 'The month before that', monthsBack: 1 },
    { key: 'lastYearSameMonth', label: 'Same month last year', monthsBack: 12 },
  ],
  last3: [
    { key: 'prev3Months', label: 'The previous 3 months', monthsBack: 3 },
    { key: 'lastYearSame3', label: 'Same 3 months last year', monthsBack: 12 },
  ],
};

export function compareOptionsFor(preset: PresetKey | null, from: string, to: string): CompareOption[] {
  // `from`/`to` are empty strings whenever there's no data yet to range over
  // (e.g. right after a fresh cloud sync, before any transactions have
  // landed) — there's nothing to compare in that case, and feeding an empty
  // string into the date math below would produce an Invalid Date and throw.
  if (preset === null || !from || !to) return [];
  const span = daysInclusive(from, to);
  return COMPARE_SHIFTS[preset].map(({ key, label, monthsBack, daysBack }) => {
    const compTo = daysBack !== undefined ? addDaysISO(to, -daysBack) : addCalendarMonths(to, -(monthsBack ?? 0));
    const compFrom = addDaysISO(compTo, -(span - 1));
    return { key, label, range: { from: compFrom, to: compTo } };
  });
}
