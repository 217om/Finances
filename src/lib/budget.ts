// Weekly budget planning, applied at the total (all-cards-combined) level —
// a "budget" is a named envelope covering one or more categories, with a
// weekly target amount compared against what was actually spent across all
// of its categories, computed live from transactions. A "cycle" is one pay
// period — the same one monthStartDay defines for the rest of the app (see
// periodKey in aggregate.ts) — sliced into weeks on the user's chosen
// week-start-day, the same grid the Dashboard's weekly chart uses (see
// startOfWeek). A cycle's start or end rarely lands exactly on that weekday,
// so the first and/or last week of a cycle is often shorter than 7 days —
// clipped to the cycle boundary rather than bleeding into the neighboring
// pay period.

import type { Transaction } from '../types';
import { addMonths, periodKey, startOfWeek } from './aggregate';

export interface Budget {
  id: string;
  name: string;
  /** One or more categories this budget tracks together — their actual
   *  spend is summed for each week. */
  categories: string[];
}

export interface BudgetEntry {
  budgetId: string;
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

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function randomId(): string {
  try {
    return crypto.randomUUID().slice(0, 8);
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

export function makeBudget(name: string): Budget {
  return { id: `budget_${randomId()}`, name: name.trim() || 'New budget', categories: [] };
}

export function renameBudget(budgets: Budget[], id: string, name: string): Budget[] {
  const trimmed = name.trim();
  if (!trimmed) return budgets;
  return budgets.map((b) => (b.id === id ? { ...b, name: trimmed } : b));
}

export function toggleBudgetCategory(budgets: Budget[], id: string, category: string): Budget[] {
  return budgets.map((b) => {
    if (b.id !== id) return b;
    const has = b.categories.includes(category);
    return { ...b, categories: has ? b.categories.filter((c) => c !== category) : [...b.categories, category] };
  });
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

/** How many days a week window's clipped [from, to] span actually covers —
 *  7 for a full week, fewer for one clipped short at a cycle boundary. */
export function windowDayCount(w: { from: string; to: string }): number {
  return Math.round((toUTC(w.to).getTime() - toUTC(w.from).getTime()) / 86400000) + 1;
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

export function isValidBudgets(v: unknown): v is Budget[] {
  if (!Array.isArray(v)) return false;
  return v.every((b) => {
    if (!b || typeof b !== 'object') return false;
    const budget = b as Record<string, unknown>;
    return (
      typeof budget.id === 'string' &&
      typeof budget.name === 'string' &&
      Array.isArray(budget.categories) &&
      budget.categories.every((c) => typeof c === 'string')
    );
  });
}

export function isValidBudgetEntries(v: unknown): v is BudgetEntry[] {
  if (!Array.isArray(v)) return false;
  return v.every((e) => {
    if (!e || typeof e !== 'object') return false;
    const entry = e as Record<string, unknown>;
    return (
      typeof entry.budgetId === 'string' &&
      typeof entry.weekStart === 'string' &&
      typeof entry.amount === 'number' &&
      Number.isFinite(entry.amount)
    );
  });
}


export function getBudgetAmount(entries: BudgetEntry[], budgetId: string, weekStart: string): number {
  return entries.find((e) => e.budgetId === budgetId && e.weekStart === weekStart)?.amount ?? 0;
}

/** Sets (or clears, when amount <= 0) a single week's target for a budget. */
export function setBudgetAmount(
  entries: BudgetEntry[],
  budgetId: string,
  weekStart: string,
  amount: number,
): BudgetEntry[] {
  const rest = entries.filter((e) => !(e.budgetId === budgetId && e.weekStart === weekStart));
  return amount > 0 ? [...rest, { budgetId, weekStart, amount }] : rest;
}

/** Applies the same amount to every given week for one budget — the
 *  "apply to every week shown" bulk-edit action. */
export function setBudgetAmountForWeeks(
  entries: BudgetEntry[],
  budgetId: string,
  weekStarts: string[],
  amount: number,
): BudgetEntry[] {
  let next = entries;
  for (const weekStart of weekStarts) next = setBudgetAmount(next, budgetId, weekStart, amount);
  return next;
}

export function removeBudgetEntries(entries: BudgetEntry[], budgetId: string): BudgetEntry[] {
  return entries.filter((e) => e.budgetId !== budgetId);
}

/** Merges two budget lists by id — an existing budget with the same id as an
 *  incoming one is replaced by the incoming version; anything else on either
 *  side is kept. Used when restoring a backup, matching how filter presets
 *  merge, so restore is additive rather than replacing local budgets. */
export function mergeBudgets(existing: Budget[], incoming: Budget[]): Budget[] {
  const byId = new Map(existing.map((b) => [b.id, b]));
  for (const b of incoming) byId.set(b.id, b);
  return [...byId.values()];
}

/** Merges two budget-entry lists by (budgetId, weekStart) the same way. */
export function mergeBudgetEntries(existing: BudgetEntry[], incoming: BudgetEntry[]): BudgetEntry[] {
  const byKey = new Map(existing.map((e) => [`${e.budgetId}|${e.weekStart}`, e]));
  for (const e of incoming) byKey.set(`${e.budgetId}|${e.weekStart}`, e);
  return [...byKey.values()];
}

/** Total actual expense spend across a set of categories within [from, to]. */
export function actualSpend(
  transactions: Transaction[],
  categoryOf: (t: Transaction) => string,
  categories: string[],
  from: string,
  to: string,
): number {
  if (categories.length === 0) return 0;
  const catSet = new Set(categories);
  let total = 0;
  for (const t of transactions) {
    if (t.amount >= 0) continue;
    if (t.date < from || t.date > to) continue;
    if (!catSet.has(categoryOf(t))) continue;
    total += -t.amount;
  }
  return total;
}
