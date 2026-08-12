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
  type BudgetEntry,
  type WeekWindow,
} from '../lib/budget';

interface Props {
  transactions: Transaction[];
  categoryOf: (tx: Transaction) => string;
  monthStartDay: number;
  weekStartDay: number;
  categoryOptions: string[];
  budgetCategories: string[];
  budgetEntries: BudgetEntry[];
  onAddCategory: (category: string) => void;
  onRemoveCategory: (category: string) => void;
  onSetAmount: (category: string, weekStart: string, amount: number) => void;
  onSetAmountForWeeks: (category: string, weekStarts: string[], amount: number) => void;
}

function weekHeaderLabel(w: WeekWindow): string {
  return w.from === w.to ? dayLabelShort(w.from) : `${dayLabelShort(w.from)} – ${dayLabelShort(w.to)}`;
}

/** A single week's editable budget input + computed actual, for one category. */
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

/** Weekly budget vs. actual for a hand-picked set of categories — separate
 *  from "Show in charts & totals", which controls what counts in every other
 *  chart/total. Budgets tracks only categories you explicitly add here. */
export default function BudgetsPage({
  transactions,
  categoryOf,
  monthStartDay,
  weekStartDay,
  categoryOptions,
  budgetCategories,
  budgetEntries,
  onAddCategory,
  onRemoveCategory,
  onSetAmount,
  onSetAmountForWeeks,
}: Props) {
  const [period, setPeriod] = useState(() => currentCyclePeriod(monthStartDay));
  const isCurrentPeriod = period === currentCyclePeriod(monthStartDay);

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

  const actualsByCategory = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const cat of budgetCategories) {
      map.set(
        cat,
        weeks.map((w) => actualSpend(cycleTx, categoryOf, cat, w.from, w.to)),
      );
    }
    return map;
  }, [budgetCategories, weeks, cycleTx, categoryOf]);

  const availableToAdd = useMemo(
    () => categoryOptions.filter((c) => !budgetCategories.includes(c)).sort((a, b) => a.localeCompare(b)),
    [categoryOptions, budgetCategories],
  );

  const weekTotals = useMemo(
    () =>
      weeks.map((w, i) => {
        let budget = 0;
        let actual = 0;
        for (const cat of budgetCategories) {
          budget += getBudgetAmount(budgetEntries, cat, w.weekStart);
          actual += actualsByCategory.get(cat)?.[i] ?? 0;
        }
        return { budget, actual };
      }),
    [weeks, budgetCategories, budgetEntries, actualsByCategory],
  );

  const cycleLabel =
    bounds.from.slice(0, 4) === bounds.to.slice(0, 4)
      ? `${dayLabelShort(bounds.from)} – ${dayLabelShort(bounds.to)}, ${bounds.to.slice(0, 4)}`
      : `${dayLabelShort(bounds.from)}, ${bounds.from.slice(0, 4)} – ${dayLabelShort(bounds.to)}, ${bounds.to.slice(0, 4)}`;

  return (
    <div className="budgets-page">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Budgets</h2>
            <p className="muted">
              Set a weekly target for the categories you pick below — actual spend is calculated
              automatically from your transactions. Weeks follow your Week-starts setting and this
              card's pay cycle, so the first and/or last week shown may be shorter than 7 days.
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
          <span className="muted">Tracked categories:</span>
          {budgetCategories.length === 0 && <span className="muted">none yet — add one below</span>}
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) onAddCategory(e.target.value);
            }}
            disabled={availableToAdd.length === 0}
          >
            <option value="">{availableToAdd.length === 0 ? 'All categories added' : '+ Add a category…'}</option>
            {availableToAdd.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </section>

      {budgetCategories.length === 0 ? (
        <section className="panel">
          <p className="muted">
            Pick one or more categories above to start tracking a weekly budget against your actual
            spend.
          </p>
        </section>
      ) : (
        <section className="panel">
          <div className="table-wrap budget-table-wrap">
            <table className="data-table budget-table">
              <thead>
                <tr>
                  <th>Category</th>
                  {weeks.map((w) => (
                    <th key={w.weekStart} className="num">
                      {weekHeaderLabel(w)}
                      {w.partial && <span className="budget-partial-tag">partial</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {budgetCategories.map((cat) => (
                  <tr key={cat}>
                    <td>
                      <div className="budget-cat-cell">
                        <span className="catdot" style={{ background: categoryColor(cat) }} />
                        <span className="filter-name">{cat}</span>
                        <button
                          type="button"
                          className="budget-quickfill"
                          title="Copy the first week's amount to every week shown"
                          onClick={() => {
                            const first = getBudgetAmount(budgetEntries, cat, weeks[0].weekStart);
                            if (first > 0) {
                              onSetAmountForWeeks(cat, weeks.map((w) => w.weekStart), first);
                            }
                          }}
                        >
                          apply 1st week to all
                        </button>
                        <button
                          type="button"
                          className="budget-remove"
                          title="Stop tracking this category"
                          onClick={() => onRemoveCategory(cat)}
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                    {weeks.map((w, i) => (
                      <td key={w.weekStart} className="num">
                        <BudgetCell
                          budget={getBudgetAmount(budgetEntries, cat, w.weekStart)}
                          actual={actualsByCategory.get(cat)?.[i] ?? 0}
                          onCommit={(amount) => onSetAmount(cat, w.weekStart, amount)}
                        />
                      </td>
                    ))}
                  </tr>
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
