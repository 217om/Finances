// Weekly budget planning: for a hand-picked set of categories, set a target
// spend for each week of the current pay cycle and compare it against what
// was actually spent, computed live from transactions. A "cycle" is one pay
// period — the same one monthStartDay defines for the rest of the app (see
// periodKey in aggregate.ts) — sliced into weeks on the user's chosen
// week-start-day, the same grid the Dashboard's weekly chart uses (see
// startOfWeek). A cycle's start or end rarely lands exactly on that weekday,
// so the first and/or last week of a cycle is often shorter than 7 days —
// clipped to the cycle boundary rather than bleeding into the neighboring
// pay period.

import type { Transaction } from '../types';
import { addMonths, periodKey, startOfWeek } from './aggregate';

export interface BudgetEntry {
  category: string;
  /** This week's start date exactly as startOfWeek returns it — not clipped,
   *  even when the week itself is a partial one at the edge of a cycle. */
  weekStart: string;
  amount: number;
}

export interface WeekWindow {
  /** Keys this week's budget entries — see BudgetEntry.weekStart. */
  weekStart: string;
  /** The actually-counted span, clipped to the cycle boundary. */
  from: string;
  to: string;
  /** True when `from`/`to` were clipped short of the full 7-day week. */
  partial: boolean;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toUTC(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function addDays(iso: string, delta: number): string {
  const d = toUTC(iso);
  d.setUTCDate(d.getUTCDate() + delta);
  return fromUTC(d);
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** The "YYYY-MM" pay-cycle period containing today, per monthStartDay. */
export function currentCyclePeriod(monthStartDay: number): string {
  return periodKey(todayISO(), monthStartDay);
}

export function adjacentPeriod(period: string, delta: number): string {
  return addMonths(period, delta);
}

/** The inclusive [from, to] span of the pay cycle labeled `period` (e.g.
 *  "2026-08"), given the day-of-month the user's cycle starts on. */
export function cycleBounds(period: string, monthStartDay: number): { from: string; to: string } {
  const [y, m] = period.split('-').map(Number);
  const startDay = Math.max(1, monthStartDay);
  const from = `${y}-${pad2(m)}-${pad2(startDay)}`;
  const [ny, nm] = addMonths(period, 1).split('-').map(Number);
  const nextStart = `${ny}-${pad2(nm)}-${pad2(startDay)}`;
  return { from, to: addDays(nextStart, -1) };
}

/** The week-aligned buckets (per weekStartDay) that overlap a pay cycle,
 *  clipped to the cycle's own [from, to] — see file doc comment. */
export function weekWindowsForCycle(
  period: string,
  monthStartDay: number,
  weekStartDay: number,
): WeekWindow[] {
  const { from, to } = cycleBounds(period, monthStartDay);
  const windows: WeekWindow[] = [];
  let cur = startOfWeek(from, weekStartDay);
  // A cycle spans at most ~31 days, so at most 6 week buckets touch it —
  // this guard is just a defensive backstop against a malformed input.
  for (let i = 0; i < 8 && cur <= to; i++) {
    const naturalEnd = addDays(cur, 6);
    const winFrom = cur < from ? from : cur;
    const winTo = naturalEnd > to ? to : naturalEnd;
    windows.push({ weekStart: cur, from: winFrom, to: winTo, partial: winFrom !== cur || winTo !== naturalEnd });
    cur = addDays(cur, 7);
  }
  return windows;
}

export function isValidBudgetEntries(v: unknown): v is BudgetEntry[] {
  if (!Array.isArray(v)) return false;
  return v.every((e) => {
    if (!e || typeof e !== 'object') return false;
    const entry = e as Record<string, unknown>;
    return (
      typeof entry.category === 'string' &&
      typeof entry.weekStart === 'string' &&
      typeof entry.amount === 'number' &&
      Number.isFinite(entry.amount)
    );
  });
}

export function isValidCategoryList(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((c) => typeof c === 'string');
}

export function getBudgetAmount(entries: BudgetEntry[], category: string, weekStart: string): number {
  return entries.find((e) => e.category === category && e.weekStart === weekStart)?.amount ?? 0;
}

/** Sets (or clears, when amount <= 0) a single week's budget for a category. */
export function setBudgetAmount(
  entries: BudgetEntry[],
  category: string,
  weekStart: string,
  amount: number,
): BudgetEntry[] {
  const rest = entries.filter((e) => !(e.category === category && e.weekStart === weekStart));
  return amount > 0 ? [...rest, { category, weekStart, amount }] : rest;
}

/** Applies the same amount to every given week for one category — the
 *  "apply to every week shown" bulk-edit action. */
export function setBudgetAmountForWeeks(
  entries: BudgetEntry[],
  category: string,
  weekStarts: string[],
  amount: number,
): BudgetEntry[] {
  let next = entries;
  for (const weekStart of weekStarts) next = setBudgetAmount(next, category, weekStart, amount);
  return next;
}

export function removeCategoryBudgets(entries: BudgetEntry[], category: string): BudgetEntry[] {
  return entries.filter((e) => e.category !== category);
}

/** Total actual expense spend for one category within [from, to]. */
export function actualSpend(
  transactions: Transaction[],
  categoryOf: (t: Transaction) => string,
  category: string,
  from: string,
  to: string,
): number {
  let total = 0;
  for (const t of transactions) {
    if (t.amount >= 0) continue;
    if (t.date < from || t.date > to) continue;
    if (categoryOf(t) !== category) continue;
    total += -t.amount;
  }
  return total;
}
