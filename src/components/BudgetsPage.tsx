import { useMemo, useState } from 'react';
import type { Transaction } from '../types';
import { categoryColor } from '../lib/categorize';
import { dayLabelShort, money } from '../lib/format';
import { useConfirm } from '../hooks/useConfirm';
import {
  actualSpend,
  adjacentPeriod,
  currentCyclePeriod,
  cycleBounds,
  dayOffsetInWindow,
  getBudgetCycleAmount,
  todayISO,
  weekTarget,
  weekWindowsForCycle,
  windowDayCount,
  type Budget,
  type BudgetCadence,
  type BudgetCycleAmount,
  type BudgetEntry,
  type WeekWindow,
} from '../lib/budget';

interface Props {
  transactions: Transaction[];
  categoryOf: (tx: Transaction) => string;
  monthStartDay: number;
  weekStartDay: number;
  categoryOptions: string[];
  budgets: Budget[];
  budgetEntries: BudgetEntry[];
  budgetCycleAmounts: BudgetCycleAmount[];
  onCreateBudget: (name: string) => void;
  onRenameBudget: (id: string, name: string) => void;
  onSetCadence: (id: string, cadence: BudgetCadence) => void;
  onDeleteBudget: (id: string) => void;
  onToggleBudgetCategory: (id: string, category: string) => void;
  onSetAmount: (budgetId: string, weekStart: string, amount: number) => void;
  onSetCycleAmount: (budgetId: string, period: string, amount: number) => void;
}

const CADENCE_LABEL: Record<BudgetCadence, string> = {
  weekly: 'Weekly',
  daily: 'Daily',
  monthly: 'Monthly',
};

function weekHeaderLabel(w: WeekWindow): string {
  return w.from === w.to ? dayLabelShort(w.from) : `${dayLabelShort(w.from)} – ${dayLabelShort(w.to)}`;
}

/** A single week's computed (or, for a 'weekly' budget, directly editable)
 *  target + actual, for one budget. */
function BudgetCell({
  budget,
  actual,
  editable,
  onCommit,
}: {
  budget: number;
  actual: number;
  editable: boolean;
  onCommit: (amount: number) => void;
}) {
  const [text, setText] = useState(budget > 0 ? String(budget) : '');
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : budget > 0 ? String(budget) : '';
  const over = budget > 0 && actual > budget;
  const pct = budget > 0 ? Math.min(100, (actual / budget) * 100) : 0;

  const commit = () => {
    setFocused(false);
    const n = Number(text);
    onCommit(Number.isFinite(n) && n > 0 ? n : 0);
  };

  return (
    <div className="budget-cell">
      {editable ? (
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="—"
          className="budget-input"
          value={shown}
          onFocus={() => {
            setFocused(true);
            setText(budget > 0 ? String(budget) : '');
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      ) : (
        <div className="budget-input budget-input-computed" title="Set by this budget's daily/monthly amount, not editable per week">
          {budget > 0 ? money(budget, { compact: true }) : '—'}
        </div>
      )}
      <div className={`budget-actual ${over ? 'budget-over' : ''}`}>{money(actual, { compact: true })}</div>
      {budget > 0 && (
        <div className="budget-bar">
          <div className={`budget-bar-fill ${over ? 'budget-bar-over' : ''}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

/** The whole displayed cycle's budget vs. actual for one row (or the
 *  grand-total row), as three small stat cards — so the cycle-level picture
 *  doesn't require mentally summing every weekly cell. */
function BudgetSummaryCards({ budget, actual }: { budget: number; actual: number }) {
  const diff = budget - actual;
  const hasBudget = budget > 0;
  const over = hasBudget && actual > budget;
  return (
    <div className="budget-summary">
      <div className="budget-stat">
        <div className="budget-stat-label">Cycle budget</div>
        <div className="budget-stat-value">{money(budget, { compact: true })}</div>
      </div>
      <div className="budget-stat">
        <div className="budget-stat-label">Cycle actual</div>
        <div className={`budget-stat-value ${over ? 'budget-over' : ''}`}>{money(actual, { compact: true })}</div>
      </div>
      <div className="budget-stat">
        <div className="budget-stat-label">{hasBudget ? (over ? 'Over by' : 'Under by') : 'Over/under'}</div>
        <div className={`budget-stat-value ${!hasBudget ? 'muted' : over ? 'budget-over' : 'pos'}`}>
          {hasBudget ? money(Math.abs(diff), { compact: true }) : '—'}
        </div>
      </div>
    </div>
  );
}

/** The single rate/total input for a 'daily' or 'monthly' cadence budget —
 *  one number for the whole cycle, spread across the weekly cells below by
 *  weekTarget instead of being typed into each cell directly. */
function CycleAmountInput({
  cadence,
  amount,
  onCommit,
}: {
  cadence: 'daily' | 'monthly';
  amount: number;
  onCommit: (amount: number) => void;
}) {
  const [text, setText] = useState(amount > 0 ? String(amount) : '');
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : amount > 0 ? String(amount) : '';

  const commit = () => {
    setFocused(false);
    const n = Number(text);
    onCommit(Number.isFinite(n) && n > 0 ? n : 0);
  };

  return (
    <label className="budget-cycle-amount">
      <span className="muted">{cadence === 'daily' ? 'Per day' : 'Per cycle'}</span>
      <input
        type="number"
        min="0"
        step="0.01"
        placeholder="0"
        className="budget-input"
        value={shown}
        onFocus={() => {
          setFocused(true);
          setText(amount > 0 ? String(amount) : '');
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

/** One budget's name (renameable), cadence, category membership (editable),
 *  and its weekly cells. */
function BudgetRow({
  budget,
  period,
  bounds,
  weeks,
  budgetEntries,
  budgetCycleAmounts,
  categoryOptions,
  actualsByWeek,
  cycleTotal,
  today,
  onRename,
  onSetCadence,
  onDelete,
  onToggleCategory,
  onSetAmount,
  onSetCycleAmount,
}: {
  budget: Budget;
  period: string;
  bounds: { from: string; to: string };
  weeks: WeekWindow[];
  budgetEntries: BudgetEntry[];
  budgetCycleAmounts: BudgetCycleAmount[];
  categoryOptions: string[];
  actualsByWeek: number[];
  cycleTotal: { budget: number; actual: number };
  today: string;
  onRename: (name: string) => void;
  onSetCadence: (cadence: BudgetCadence) => void;
  onDelete: () => void;
  onToggleCategory: (category: string) => void;
  onSetAmount: (weekStart: string, amount: number) => void;
  onSetCycleAmount: (amount: number) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [nameText, setNameText] = useState(budget.name);
  const [editingCats, setEditingCats] = useState(false);

  const commitName = () => {
    setRenaming(false);
    if (nameText.trim() && nameText.trim() !== budget.name) onRename(nameText);
    else setNameText(budget.name);
  };

  const availableToAdd = categoryOptions.filter((c) => !budget.categories.includes(c));
  const cadence = budget.cadence ?? 'weekly';

  return (
    <>
      {/* A label row above, spanning every column, so it never factors into
       *  this budget's real content row below — the chips/cards column and
       *  the selector/weekly-cells columns are the only two things that need
       *  to line up with each other, and native table row valign only
       *  centers them correctly when nothing else shares their row. */}
      <tr className="budget-name-row">
        <td colSpan={weeks.length + 1}>
          <div className="budget-cat-cell">
            {renaming ? (
              <input
                autoFocus
                className="budget-name-input"
                value={nameText}
                onChange={(e) => setNameText(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitName();
                  if (e.key === 'Escape') {
                    setNameText(budget.name);
                    setRenaming(false);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="budget-name linklike"
                title="Rename this budget"
                onClick={() => {
                  setNameText(budget.name);
                  setRenaming(true);
                }}
              >
                {budget.name}
              </button>
            )}
          </div>
        </td>
      </tr>
      <tr>
        <td>
          <div className="budget-row-main">
            <div className="budget-row-left">
              <div className="budget-chips">
                {budget.categories.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="budget-chip"
                    style={{ borderColor: categoryColor(c) }}
                    title="Remove this category from the budget"
                    onClick={() => onToggleCategory(c)}
                  >
                    {c} <span aria-hidden>✕</span>
                  </button>
                ))}
                {editingCats ? (
                  <select
                    autoFocus
                    value=""
                    onChange={(e) => {
                      if (e.target.value) onToggleCategory(e.target.value);
                      setEditingCats(false);
                    }}
                    onBlur={() => setEditingCats(false)}
                  >
                    <option value="">{availableToAdd.length === 0 ? 'No more categories' : 'Add category…'}</option>
                    {availableToAdd.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                ) : (
                  <button type="button" className="budget-add-chip" onClick={() => setEditingCats(true)}>
                    + category
                  </button>
                )}
              </div>
              {cadence !== 'weekly' && (
                <CycleAmountInput
                  cadence={cadence}
                  amount={getBudgetCycleAmount(budgetCycleAmounts, budget.id, period)}
                  onCommit={onSetCycleAmount}
                />
              )}
              <BudgetSummaryCards budget={cycleTotal.budget} actual={cycleTotal.actual} />
            </div>
            <div className="budget-row-right">
              <select
                className="budget-cadence-select"
                value={cadence}
                title="How this budget's target amount is set"
                onChange={(e) => onSetCadence(e.target.value as BudgetCadence)}
              >
                {(Object.keys(CADENCE_LABEL) as BudgetCadence[]).map((c) => (
                  <option key={c} value={c}>
                    {CADENCE_LABEL[c]}
                  </option>
                ))}
              </select>
              <button type="button" className="budget-remove" title="Delete this budget" onClick={onDelete}>
                ✕
              </button>
            </div>
          </div>
        </td>
        {weeks.map((w, i) => (
          <td key={w.weekStart} className={`num ${w.from <= today && today <= w.to ? 'budget-col-current' : ''}`}>
            <BudgetCell
              budget={weekTarget(budget, period, bounds, w, budgetEntries, budgetCycleAmounts)}
              actual={actualsByWeek[i] ?? 0}
              editable={cadence === 'weekly'}
              onCommit={(amount) => onSetAmount(w.weekStart, amount)}
            />
          </td>
        ))}
      </tr>
    </>
  );
}

/** Weekly budget vs. actual, applied at the total (all-cards-combined)
 *  level. A "budget" is a named envelope covering one or more categories —
 *  the actual spend across all of them is compared against one target,
 *  either typed per week directly or (for a daily/monthly-cadence budget)
 *  computed from one rate/total entered for the whole cycle. */
export default function BudgetsPage({
  transactions,
  categoryOf,
  monthStartDay,
  weekStartDay,
  categoryOptions,
  budgets,
  budgetEntries,
  budgetCycleAmounts,
  onCreateBudget,
  onRenameBudget,
  onSetCadence,
  onDeleteBudget,
  onToggleBudgetCategory,
  onSetAmount,
  onSetCycleAmount,
}: Props) {
  const { confirmAsync, confirmDialog } = useConfirm();
  const [period, setPeriod] = useState(() => currentCyclePeriod(monthStartDay));
  const isCurrentPeriod = period === currentCyclePeriod(monthStartDay);
  const [newBudgetName, setNewBudgetName] = useState('');
  const [creating, setCreating] = useState(false);
  const today = useMemo(() => todayISO(), []);

  // Deleted budgets are kept (not removed) so the deletion itself survives
  // a sync merge — see deleteBudget's doc comment in lib/budget.ts. Never
  // shown here.
  const liveBudgets = useMemo(() => budgets.filter((b) => !b.deletedAt), [budgets]);

  const bounds = useMemo(() => cycleBounds(period, monthStartDay), [period, monthStartDay]);
  const weeks = useMemo(
    () => weekWindowsForCycle(period, monthStartDay, weekStartDay),
    [period, monthStartDay, weekStartDay],
  );
  const currentWeekIndex = weeks.findIndex((w) => w.from <= today && today <= w.to);

  // Only expense transactions within this cycle need scanning at all.
  const cycleTx = useMemo(
    () => transactions.filter((t) => t.amount < 0 && t.date >= bounds.from && t.date <= bounds.to),
    [transactions, bounds],
  );

  const actualsByBudget = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const b of liveBudgets) {
      map.set(
        b.id,
        weeks.map((w) => actualSpend(cycleTx, categoryOf, b.categories, w.from, w.to)),
      );
    }
    return map;
  }, [liveBudgets, weeks, cycleTx, categoryOf]);

  const weekTotals = useMemo(
    () =>
      weeks.map((w, i) => {
        let budgetSum = 0;
        let actualSum = 0;
        for (const b of liveBudgets) {
          budgetSum += weekTarget(b, period, bounds, w, budgetEntries, budgetCycleAmounts);
          actualSum += actualsByBudget.get(b.id)?.[i] ?? 0;
        }
        return { budget: budgetSum, actual: actualSum };
      }),
    [weeks, liveBudgets, period, bounds, budgetEntries, budgetCycleAmounts, actualsByBudget],
  );

  // Whole-cycle (all weeks shown, summed) totals — per budget, and the
  // grand total across every budget — for the small summary cards.
  const cycleTotalsByBudget = useMemo(() => {
    const map = new Map<string, { budget: number; actual: number }>();
    for (const b of liveBudgets) {
      const actuals = actualsByBudget.get(b.id) ?? [];
      const budgetSum = weeks.reduce((a, w) => a + weekTarget(b, period, bounds, w, budgetEntries, budgetCycleAmounts), 0);
      const actualSum = actuals.reduce((a, x) => a + x, 0);
      map.set(b.id, { budget: budgetSum, actual: actualSum });
    }
    return map;
  }, [liveBudgets, weeks, period, bounds, budgetEntries, budgetCycleAmounts, actualsByBudget]);

  const grandCycleTotal = useMemo(
    () =>
      weekTotals.reduce(
        (acc, t) => ({ budget: acc.budget + t.budget, actual: acc.actual + t.actual }),
        { budget: 0, actual: 0 },
      ),
    [weekTotals],
  );

  const cycleLabel =
    bounds.from.slice(0, 4) === bounds.to.slice(0, 4)
      ? `${dayLabelShort(bounds.from)} – ${dayLabelShort(bounds.to)}, ${bounds.to.slice(0, 4)}`
      : `${dayLabelShort(bounds.from)}, ${bounds.from.slice(0, 4)} – ${dayLabelShort(bounds.to)}, ${bounds.to.slice(0, 4)}`;

  const commitNewBudget = () => {
    setCreating(false);
    const name = newBudgetName.trim();
    setNewBudgetName('');
    onCreateBudget(name || 'New budget');
  };

  const deleteBudget = async (id: string, name: string) => {
    const ok = await confirmAsync(`Delete "${name}"? Its budget amounts for every cycle go with it. This can't be undone.`, {
      confirmLabel: 'Delete',
    });
    if (ok) onDeleteBudget(id);
  };

  return (
    <div className="budgets-page">
      {confirmDialog}
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Budgets</h2>
            <p className="muted">Applies across every card. Set a target, actuals fill in automatically.</p>
          </div>
        </div>

        <div className="budget-nav">
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label="Previous period"
            onClick={() => setPeriod((p) => adjacentPeriod(p, -1))}
          >
            ←
          </button>
          <div className="budget-nav-label">
            <strong>{cycleLabel}</strong>
            {!isCurrentPeriod && (
              <button type="button" className="linklike" onClick={() => setPeriod(currentCyclePeriod(monthStartDay))}>
                back to current period
              </button>
            )}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label="Next period"
            onClick={() => setPeriod((p) => adjacentPeriod(p, 1))}
          >
            →
          </button>
        </div>

        <div className="budget-add-row">
          {creating ? (
            <input
              autoFocus
              className="budget-name-input"
              placeholder="Budget name…"
              value={newBudgetName}
              onChange={(e) => setNewBudgetName(e.target.value)}
              onBlur={commitNewBudget}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitNewBudget();
                if (e.key === 'Escape') {
                  setCreating(false);
                  setNewBudgetName('');
                }
              }}
            />
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
              + New budget
            </button>
          )}
        </div>
      </section>

      {liveBudgets.length === 0 ? (
        <section className="panel">
          <p className="muted">Create a budget above, then assign it one or more categories.</p>
        </section>
      ) : (
        <section className="panel">
          <div className="table-wrap budget-table-wrap">
            <table className="data-table budget-table">
              <thead>
                <tr>
                  <th>Budget</th>
                  {weeks.map((w, i) => {
                    const isCurrent = i === currentWeekIndex;
                    return (
                      <th key={w.weekStart} className={`num ${isCurrent ? 'budget-col-current' : ''}`}>
                        {weekHeaderLabel(w)}
                        <span className="budget-days-tag">
                          {isCurrent
                            ? `Day ${dayOffsetInWindow(w, today)} of ${windowDayCount(w)}`
                            : `${windowDayCount(w)} day${windowDayCount(w) === 1 ? '' : 's'}`}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {liveBudgets.map((b) => (
                  <BudgetRow
                    key={b.id}
                    budget={b}
                    period={period}
                    bounds={bounds}
                    weeks={weeks}
                    budgetEntries={budgetEntries}
                    budgetCycleAmounts={budgetCycleAmounts}
                    categoryOptions={categoryOptions}
                    actualsByWeek={actualsByBudget.get(b.id) ?? []}
                    cycleTotal={cycleTotalsByBudget.get(b.id) ?? { budget: 0, actual: 0 }}
                    today={today}
                    onRename={(name) => onRenameBudget(b.id, name)}
                    onSetCadence={(cadence) => onSetCadence(b.id, cadence)}
                    onDelete={() => deleteBudget(b.id, b.name)}
                    onToggleCategory={(category) => onToggleBudgetCategory(b.id, category)}
                    onSetAmount={(weekStart, amount) => onSetAmount(b.id, weekStart, amount)}
                    onSetCycleAmount={(amount) => onSetCycleAmount(b.id, period, amount)}
                  />
                ))}
              </tbody>
              {/* A "Total" row is only informative once there's more than one
                  budget to add up — with just one, it's an exact duplicate
                  of that budget's own row and numbers. */}
              {liveBudgets.length > 1 && (
                <tfoot>
                  <tr>
                    <td className="strong">
                      Total
                      <BudgetSummaryCards budget={grandCycleTotal.budget} actual={grandCycleTotal.actual} />
                    </td>
                    {weekTotals.map((t, i) => {
                      const over = t.budget > 0 && t.actual > t.budget;
                      const w = weeks[i];
                      return (
                        <td
                          key={w.weekStart}
                          className={`num ${w.from <= today && today <= w.to ? 'budget-col-current' : ''}`}
                        >
                          <div className="budget-total-cell">
                            <span className="muted">{money(t.budget, { compact: true })} budget</span>
                            <span className={`strong ${over ? 'budget-over' : ''}`}>
                              {money(t.actual, { compact: true })} actual
                            </span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
