import { useMemo, useState } from 'react';
import type { Transaction } from '../types';
import { categoryColor } from '../lib/categorize';
import { dayLabelShort, money } from '../lib/format';
import {
  actualSpend,
  adjacentPeriod,
  currentCyclePeriod,
  cycleBounds,
  getBudgetAmount,
  weekWindowsForCycle,
  type Budget,
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
  onCreateBudget: (name: string) => void;
  onRenameBudget: (id: string, name: string) => void;
  onDeleteBudget: (id: string) => void;
  onToggleBudgetCategory: (id: string, category: string) => void;
  onSetAmount: (budgetId: string, weekStart: string, amount: number) => void;
  onSetAmountForWeeks: (budgetId: string, weekStarts: string[], amount: number) => void;
}

function weekHeaderLabel(w: WeekWindow): string {
  return w.from === w.to ? dayLabelShort(w.from) : `${dayLabelShort(w.from)} – ${dayLabelShort(w.to)}`;
}

/** A single week's editable budget input + computed actual, for one budget. */
function BudgetCell({
  budget,
  actual,
  onCommit,
}: {
  budget: number;
  actual: number;
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
      <div className={`budget-actual ${over ? 'budget-over' : ''}`}>{money(actual, { compact: true })}</div>
      {budget > 0 && (
        <div className="budget-bar">
          <div className={`budget-bar-fill ${over ? 'budget-bar-over' : ''}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

/** One budget's name (renameable), category membership (editable), and its
 *  weekly cells. */
function BudgetRow({
  budget,
  weeks,
  budgetEntries,
  categoryOptions,
  actualsByWeek,
  onRename,
  onDelete,
  onToggleCategory,
  onSetAmount,
  onSetAmountForWeeks,
}: {
  budget: Budget;
  weeks: WeekWindow[];
  budgetEntries: BudgetEntry[];
  categoryOptions: string[];
  actualsByWeek: number[];
  onRename: (name: string) => void;
  onDelete: () => void;
  onToggleCategory: (category: string) => void;
  onSetAmount: (weekStart: string, amount: number) => void;
  onSetAmountForWeeks: (weekStarts: string[], amount: number) => void;
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

  return (
    <tr>
      <td>
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
          <button
            type="button"
            className="budget-quickfill"
            title="Copy the first week's amount to every week shown"
            onClick={() => {
              const first = getBudgetAmount(budgetEntries, budget.id, weeks[0].weekStart);
              if (first > 0) onSetAmountForWeeks(weeks.map((w) => w.weekStart), first);
            }}
          >
            apply 1st week to all
          </button>
          <button type="button" className="budget-remove" title="Delete this budget" onClick={onDelete}>
            ✕
          </button>
        </div>
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
      </td>
      {weeks.map((w, i) => (
        <td key={w.weekStart} className="num">
          <BudgetCell
            budget={getBudgetAmount(budgetEntries, budget.id, w.weekStart)}
            actual={actualsByWeek[i] ?? 0}
            onCommit={(amount) => onSetAmount(w.weekStart, amount)}
          />
        </td>
      ))}
    </tr>
  );
}

/** Weekly budget vs. actual, applied at the total (all-cards-combined)
 *  level. A "budget" is a named envelope covering one or more categories —
 *  the actual spend across all of them is compared against one weekly
 *  target. */
export default function BudgetsPage({
  transactions,
  categoryOf,
  monthStartDay,
  weekStartDay,
  categoryOptions,
  budgets,
  budgetEntries,
  onCreateBudget,
  onRenameBudget,
  onDeleteBudget,
  onToggleBudgetCategory,
  onSetAmount,
  onSetAmountForWeeks,
}: Props) {
  const [period, setPeriod] = useState(() => currentCyclePeriod(monthStartDay));
  const isCurrentPeriod = period === currentCyclePeriod(monthStartDay);
  const [newBudgetName, setNewBudgetName] = useState('');
  const [creating, setCreating] = useState(false);

  const bounds = useMemo(() => cycleBounds(period, monthStartDay), [period, monthStartDay]);
  const weeks = useMemo(
    () => weekWindowsForCycle(period, monthStartDay, weekStartDay),
    [period, monthStartDay, weekStartDay],
  );

  // Only expense transactions within this cycle need scanning at all.
  const cycleTx = useMemo(
    () => transactions.filter((t) => t.amount < 0 && t.date >= bounds.from && t.date <= bounds.to),
    [transactions, bounds],
  );

  const actualsByBudget = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const b of budgets) {
      map.set(
        b.id,
        weeks.map((w) => actualSpend(cycleTx, categoryOf, b.categories, w.from, w.to)),
      );
    }
    return map;
  }, [budgets, weeks, cycleTx, categoryOf]);

  const weekTotals = useMemo(
    () =>
      weeks.map((w, i) => {
        let budgetSum = 0;
        let actualSum = 0;
        for (const b of budgets) {
          budgetSum += getBudgetAmount(budgetEntries, b.id, w.weekStart);
          actualSum += actualsByBudget.get(b.id)?.[i] ?? 0;
        }
        return { budget: budgetSum, actual: actualSum };
      }),
    [weeks, budgets, budgetEntries, actualsByBudget],
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

  return (
    <div className="budgets-page">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Budgets</h2>
            <p className="muted">
              Applied at the total level, across every card. Create a budget, assign it one or more
              categories, and set a weekly target — actual spend is calculated automatically from
              your transactions. Weeks follow your Week-starts setting and this pay cycle, so the
              first and/or last week shown may be shorter than 7 days.
            </p>
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

      {budgets.length === 0 ? (
        <section className="panel">
          <p className="muted">
            Create a budget above, then assign it one category (like "Groceries") or several (like
            "Groceries" + "Dining" together) and set a weekly target.
          </p>
        </section>
      ) : (
        <section className="panel">
          <div className="table-wrap budget-table-wrap">
            <table className="data-table budget-table">
              <thead>
                <tr>
                  <th>Budget</th>
                  {weeks.map((w) => (
                    <th key={w.weekStart} className="num">
                      {weekHeaderLabel(w)}
                      {w.partial && <span className="budget-partial-tag">partial</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {budgets.map((b) => (
                  <BudgetRow
                    key={b.id}
                    budget={b}
                    weeks={weeks}
                    budgetEntries={budgetEntries}
                    categoryOptions={categoryOptions}
                    actualsByWeek={actualsByBudget.get(b.id) ?? []}
                    onRename={(name) => onRenameBudget(b.id, name)}
                    onDelete={() => onDeleteBudget(b.id)}
                    onToggleCategory={(category) => onToggleBudgetCategory(b.id, category)}
                    onSetAmount={(weekStart, amount) => onSetAmount(b.id, weekStart, amount)}
                    onSetAmountForWeeks={(weekStarts, amount) => onSetAmountForWeeks(b.id, weekStarts, amount)}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="strong">Total</td>
                  {weekTotals.map((t, i) => {
                    const over = t.budget > 0 && t.actual > t.budget;
                    return (
                      <td key={weeks[i].weekStart} className="num">
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
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
