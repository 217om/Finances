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
