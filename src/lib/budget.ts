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

/** How a budget's target amount is entered and spread across the weekly
 *  columns — the columns themselves (and their actual-spend bars) always
 *  look the same regardless of cadence; only how each cell's target number
 *  is produced changes:
 *  - 'weekly': typed directly into each week's cell (the original model).
 *  - 'daily': one rate typed once; each cell = rate × that week's actual
 *    day count, so a partial week at the cycle boundary is scaled down
 *    automatically instead of needing a manually-guessed amount.
 *  - 'monthly': one total for the whole cycle typed once; each cell gets
 *    its day-share of that total (a week covering 3 of the cycle's 30 days
 *    gets 3/30 of it). */
export type BudgetCadence = 'weekly' | 'daily' | 'monthly';

export interface Budget {
  id: string;
  name: string;
  /** One or more categories this budget tracks together — their actual
   *  spend is summed for each week. */
  categories: string[];
  /** Missing/undefined means 'weekly' — every budget created before this
   *  field existed keeps behaving exactly as it did. */
  cadence?: BudgetCadence;
  /** When the name/categories/cadence last changed — lets sync-restore keep
   *  whichever of two conflicting copies is actually newer instead of
   *  blindly letting the restored one win. Optional only for records
   *  written before this field existed. */
  updatedAt?: number;
  /** Set instead of actually removing the record so a delete survives a
   *  sync merge — see the mergeBudgets doc comment below for why. */
  deletedAt?: number;
}

export interface BudgetEntry {
  budgetId: string;
  /** This week's start date exactly as startOfWeek returns it — not clipped,
   *  even when the week itself is a partial one at the edge of a cycle. */
  weekStart: string;
  amount: number;
  /** See Budget.updatedAt — same purpose. */
  updatedAt?: number;
  /** See Budget.deletedAt — same purpose (set when a week's amount is
   *  cleared back to empty, not just when its whole budget is deleted). */
  deletedAt?: number;
}

/** One budget's 'daily' rate or 'monthly' total for one pay cycle — see
 *  BudgetCadence. Not used at all for a 'weekly' budget, which stores its
 *  amounts as BudgetEntry instead, one per week. */
export interface BudgetCycleAmount {
  budgetId: string;
  /** The "YYYY-MM" pay-cycle period this amount applies to (see periodKey) —
   *  like BudgetEntry.weekStart, entered fresh each cycle, never carried
   *  forward automatically. */
  period: string;
  amount: number;
  /** See Budget.updatedAt / Budget.deletedAt — same purpose, both. */
  updatedAt?: number;
  deletedAt?: number;
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
  return { id: `budget_${randomId()}`, name: name.trim() || 'New budget', categories: [], cadence: 'weekly', updatedAt: Date.now() };
}

export function renameBudget(budgets: Budget[], id: string, name: string): Budget[] {
  const trimmed = name.trim();
  if (!trimmed) return budgets;
  return budgets.map((b) => (b.id === id ? { ...b, name: trimmed, updatedAt: Date.now() } : b));
}

export function setBudgetCadence(budgets: Budget[], id: string, cadence: BudgetCadence): Budget[] {
  return budgets.map((b) => (b.id === id ? { ...b, cadence, updatedAt: Date.now() } : b));
}

/** Marks a budget deleted instead of removing it, so the deletion itself
 *  survives a sync merge — see the mergeBudgets doc comment. Its entries and
 *  cycle amounts are left alone: harmless once orphaned (nothing looks them
 *  up for a budget that no longer shows up anywhere). */
export function deleteBudget(budgets: Budget[], id: string): Budget[] {
  const now = Date.now();
  return budgets.map((b) => (b.id === id ? { ...b, deletedAt: now, updatedAt: now } : b));
}

export function toggleBudgetCategory(budgets: Budget[], id: string, category: string): Budget[] {
  return budgets.map((b) => {
    if (b.id !== id) return b;
    const has = b.categories.includes(category);
    return {
      ...b,
      categories: has ? b.categories.filter((c) => c !== category) : [...b.categories, category],
      updatedAt: Date.now(),
    };
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
 *  7 for a full week, fewer for one clipped short at a cycle boundary. Also
 *  works on a whole cycle's own [from, to] (used for 'monthly' cadence's
 *  day-share math). */
export function windowDayCount(w: { from: string; to: string }): number {
  return Math.round((toUTC(w.to).getTime() - toUTC(w.from).getTime()) / 86400000) + 1;
}

/** Which day of a window `today` falls on, 1-based (3 means "the 3rd day of
 *  however many this window covers") — for the "Day 3 of 7" indicator on
 *  whichever week contains today. Only meaningful when today actually falls
 *  within [w.from, w.to]. */
export function dayOffsetInWindow(w: { from: string }, today: string): number {
  return Math.round((toUTC(today).getTime() - toUTC(w.from).getTime()) / 86400000) + 1;
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

export function isValidBudgetCycleAmounts(v: unknown): v is BudgetCycleAmount[] {
  if (!Array.isArray(v)) return false;
  return v.every((e) => {
    if (!e || typeof e !== 'object') return false;
    const entry = e as Record<string, unknown>;
    return (
      typeof entry.budgetId === 'string' &&
      typeof entry.period === 'string' &&
      typeof entry.amount === 'number' &&
      Number.isFinite(entry.amount)
    );
  });
}

export function getBudgetAmount(entries: BudgetEntry[], budgetId: string, weekStart: string): number {
  return entries.find((e) => e.budgetId === budgetId && e.weekStart === weekStart && !e.deletedAt)?.amount ?? 0;
}

/** Sets (or clears, when amount <= 0) a single week's target for a budget.
 *  Clearing marks the entry deleted rather than dropping it, so the clear
 *  itself survives a sync merge — see the mergeBudgetEntries doc comment. */
export function setBudgetAmount(
  entries: BudgetEntry[],
  budgetId: string,
  weekStart: string,
  amount: number,
): BudgetEntry[] {
  const rest = entries.filter((e) => !(e.budgetId === budgetId && e.weekStart === weekStart));
  const now = Date.now();
  return amount > 0
    ? [...rest, { budgetId, weekStart, amount, updatedAt: now }]
    : [...rest, { budgetId, weekStart, amount: 0, updatedAt: now, deletedAt: now }];
}

export function getBudgetCycleAmount(amounts: BudgetCycleAmount[], budgetId: string, period: string): number {
  return amounts.find((e) => e.budgetId === budgetId && e.period === period && !e.deletedAt)?.amount ?? 0;
}

/** Sets (or clears, when amount <= 0) one budget's 'daily'/'monthly' amount
 *  for one cycle — same tombstone-on-clear treatment as setBudgetAmount. */
export function setBudgetCycleAmount(
  amounts: BudgetCycleAmount[],
  budgetId: string,
  period: string,
  amount: number,
): BudgetCycleAmount[] {
  const rest = amounts.filter((e) => !(e.budgetId === budgetId && e.period === period));
  const now = Date.now();
  return amount > 0
    ? [...rest, { budgetId, period, amount, updatedAt: now }]
    : [...rest, { budgetId, period, amount: 0, updatedAt: now, deletedAt: now }];
}

/** This week's target amount for a budget, however its cadence says to
 *  produce it — see BudgetCadence. `bounds` is the whole cycle's own
 *  [from, to] (from cycleBounds), needed to work out a 'monthly' budget's
 *  day-share. */
export function weekTarget(
  budget: Budget,
  period: string,
  bounds: { from: string; to: string },
  window: { weekStart: string; from: string; to: string },
  entries: BudgetEntry[],
  cycleAmounts: BudgetCycleAmount[],
): number {
  const cadence = budget.cadence ?? 'weekly';
  if (cadence === 'daily') {
    return getBudgetCycleAmount(cycleAmounts, budget.id, period) * windowDayCount(window);
  }
  if (cadence === 'monthly') {
    const totalDays = windowDayCount(bounds);
    if (totalDays === 0) return 0;
    return (getBudgetCycleAmount(cycleAmounts, budget.id, period) * windowDayCount(window)) / totalDays;
  }
  return getBudgetAmount(entries, budget.id, window.weekStart);
}

/**
 * Merges two budget lists by id — anything only on one side is kept as-is;
 * for an id present on both sides, whichever copy has the later updatedAt
 * wins (missing treated as oldest), so restoring an older backup can't
 * silently undo a newer local rename/category change.
 *
 * Deletion is represented as a real record with `deletedAt` set (see
 * deleteBudget) rather than the id simply being absent — that's what makes
 * the updatedAt comparison above correctly keep a deletion: a tombstoned
 * budget with a later updatedAt than whatever's incoming still wins the
 * comparison like any other edit. If deletion just removed the id instead,
 * `!cur` would be true on every subsequent merge and an old backup — from
 * before the delete, still sitting in the cloud or another device — would
 * resurrect it every time, no matter how long ago it was deleted.
 */
export function mergeBudgets(existing: Budget[], incoming: Budget[]): Budget[] {
  const byId = new Map(existing.map((b) => [b.id, b]));
  for (const b of incoming) {
    const cur = byId.get(b.id);
    if (!cur || (b.updatedAt ?? 0) >= (cur.updatedAt ?? 0)) byId.set(b.id, b);
  }
  return [...byId.values()];
}

/** Merges two budget-entry lists by (budgetId, weekStart) the same way —
 *  later updatedAt wins on a shared key instead of incoming always winning.
 *  Same tombstone reasoning as mergeBudgets applies to a cleared week. */
export function mergeBudgetEntries(existing: BudgetEntry[], incoming: BudgetEntry[]): BudgetEntry[] {
  const byKey = new Map(existing.map((e) => [`${e.budgetId}|${e.weekStart}`, e]));
  for (const e of incoming) {
    const key = `${e.budgetId}|${e.weekStart}`;
    const cur = byKey.get(key);
    if (!cur || (e.updatedAt ?? 0) >= (cur.updatedAt ?? 0)) byKey.set(key, e);
  }
  return [...byKey.values()];
}

/** Merges two budget-cycle-amount lists by (budgetId, period) — same shape
 *  and tombstone reasoning as mergeBudgetEntries. */
export function mergeBudgetCycleAmounts(existing: BudgetCycleAmount[], incoming: BudgetCycleAmount[]): BudgetCycleAmount[] {
  const byKey = new Map(existing.map((e) => [`${e.budgetId}|${e.period}`, e]));
  for (const e of incoming) {
    const key = `${e.budgetId}|${e.period}`;
    const cur = byKey.get(key);
    if (!cur || (e.updatedAt ?? 0) >= (cur.updatedAt ?? 0)) byKey.set(key, e);
  }
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
