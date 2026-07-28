import { useMemo, useState } from 'react';
import type { Transaction } from '../types';
import { categoryColor } from '../lib/categorize';
import { UNSORTED } from '../lib/subcategory';
import { isCategoryExcluded, isSubExcluded, type CategoryFilterState } from '../lib/categoryFilter';
import { money } from '../lib/format';

export interface Tagged {
  t: Transaction;
  cat: string;
}

/** Just enough of SubResolver for the filter panel — a full SubResolver
 *  satisfies this structurally, and the combined view (which has no single
 *  card's rules to build a real one from) can supply a lighter stand-in. */
export interface MiniSubResolver {
  subOf: (tx: Transaction, parent: string) => string;
  subsForParent: (parent: string) => string[];
}

// --- Show in charts & totals (category/sub visibility filter) ---------------

export default function CategoryFilterPanel({
  expenses,
  incomeTagged,
  sub,
  categoryFilter,
  onToggleCategoryFilter,
  onToggleSubFilter,
}: {
  expenses: Tagged[];
  incomeTagged: Tagged[];
  sub: MiniSubResolver;
  categoryFilter: CategoryFilterState;
  onToggleCategoryFilter: (category: string) => void;
  onToggleSubFilter: (category: string, subName: string) => void;
}) {
  const categoryTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const x of expenses) totals.set(x.cat, (totals.get(x.cat) ?? 0) + -x.t.amount);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [expenses]);

  const incomeTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const x of incomeTagged) totals.set(x.cat, (totals.get(x.cat) ?? 0) + x.t.amount);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [incomeTagged]);

  const subTotalsFor = (category: string) => {
    const totals = new Map<string, number>();
    for (const x of expenses) {
      if (x.cat !== category) continue;
      const s = sub.subOf(x.t, category);
      if (s === UNSORTED) continue;
      totals.set(s, (totals.get(s) ?? 0) + -x.t.amount);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  };

  const hiddenChips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    for (const c of categoryFilter.categories) {
      chips.push({ key: `cat:${c}`, label: c, onRemove: () => onToggleCategoryFilter(c) });
    }
    for (const [parent, subs] of Object.entries(categoryFilter.subs)) {
      for (const s of subs) {
        chips.push({
          key: `sub:${parent}:${s}`,
          label: `${parent} → ${s}`,
          onRemove: () => onToggleSubFilter(parent, s),
        });
      }
    }
    return chips;
  }, [categoryFilter, onToggleCategoryFilter, onToggleSubFilter]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (c: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Show in charts &amp; totals</h2>
          <p className="muted">
            Uncheck anything that isn’t real spending (like a transfer to your own savings) to remove
            it from every chart, KPI, and total across the app — not just here.
          </p>
        </div>
      </div>

      {hiddenChips.length > 0 && (
        <div className="hidden-tray">
          <span className="muted hidden-tray-label">Hidden:</span>
          {hiddenChips.map((h) => (
            <button key={h.key} type="button" className="hidden-chip" onClick={h.onRemove}>
              {h.label} <span aria-hidden>✕</span>
            </button>
          ))}
        </div>
      )}

      <div className="filter-list">
        {categoryTotals.map(([cat, total]) => {
          const catExcluded = isCategoryExcluded(categoryFilter, cat);
          const subs = sub.subsForParent(cat);
          const hasSubs = subs.length > 0;
          const isExpanded = expanded.has(cat);
          return (
            <div key={cat} className="filter-row-group">
              <div className={`filter-row ${catExcluded ? 'filter-row-excluded' : ''}`}>
                <label className="filter-check">
                  <input
                    type="checkbox"
                    checked={!catExcluded}
                    onChange={() => onToggleCategoryFilter(cat)}
                  />
                </label>
                <span className="catdot" style={{ background: categoryColor(cat) }} />
                <span className="filter-name">{cat}</span>
                <span className="muted filter-total">{money(total)}</span>
                {hasSubs && (
                  <button
                    type="button"
                    className="linklike filter-expand"
                    onClick={() => toggleExpand(cat)}
                  >
                    {isExpanded ? 'hide subs' : `${subs.length} sub${subs.length === 1 ? '' : 's'}`}
                  </button>
                )}
              </div>
              {hasSubs && isExpanded && (
                <div className="filter-subs">
                  {subTotalsFor(cat).map(([s, subTotal]) => {
                    const subExcluded = isSubExcluded(categoryFilter, cat, s);
                    return (
                      <div
                        key={s}
                        className={`filter-row filter-subrow ${subExcluded ? 'filter-row-excluded' : ''}`}
                      >
                        <label className="filter-check">
                          <input
                            type="checkbox"
                            checked={!subExcluded}
                            disabled={catExcluded}
                            onChange={() => onToggleSubFilter(cat, s)}
                          />
                        </label>
                        <span
                          className="catdot"
                          style={{ background: categoryColor(`${cat}/${s}`) }}
                        />
                        <span className="filter-name">{s}</span>
                        <span className="muted filter-total">{money(subTotal)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {incomeTotals.length > 0 && (
        <>
          <h3 className="filter-income-head">Income categories</h3>
          <div className="filter-list">
            {incomeTotals.map(([cat, total]) => {
              const catExcluded = isCategoryExcluded(categoryFilter, cat);
              return (
                <div key={cat} className="filter-row-group">
                  <div className={`filter-row ${catExcluded ? 'filter-row-excluded' : ''}`}>
                    <label className="filter-check">
                      <input
                        type="checkbox"
                        checked={!catExcluded}
                        onChange={() => onToggleCategoryFilter(cat)}
                      />
                    </label>
                    <span className="catdot" style={{ background: categoryColor(cat) }} />
                    <span className="filter-name">{cat}</span>
                    <span className="muted filter-total pos">{money(total)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
