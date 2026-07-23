import { useMemo, useState } from 'react';
import type { SubRule, Transaction } from '../types';
import { categoryColor, signatureOf } from '../lib/categorize';
import { UNSORTED, suggestSubGroups, type SubResolver } from '../lib/subcategory';
import {
  isCategoryExcluded,
  isExcluded,
  isSubExcluded,
  type CategoryFilterState,
} from '../lib/categoryFilter';
import { money } from '../lib/format';
import CategoryTreemap, { type TreemapCell } from './CategoryTreemap';
import CategoryTxList from './CategoryTxList';

interface Props {
  transactions: Transaction[];
  categoryOf: (tx: Transaction) => string;
  sub: SubResolver;
  subRules: SubRule[];
  onAddSubRule: (parent: string, keyword: string, subName: string) => void;
  onDeleteSubRule: (id: string) => void;
  onBulkSetSubCategory: (ids: string[], parent: string, subName: string) => void;
  categoryFilter: CategoryFilterState;
  onToggleCategoryFilter: (category: string) => void;
  onToggleSubFilter: (category: string, subName: string) => void;
}

interface Tagged {
  t: Transaction;
  cat: string;
}

const MERCHANT_LIMIT = 12;

export default function CategoriesPage({
  transactions,
  categoryOf,
  sub,
  subRules,
  onAddSubRule,
  onDeleteSubRule,
  onBulkSetSubCategory,
  categoryFilter,
  onToggleCategoryFilter,
  onToggleSubFilter,
}: Props) {
  const expenses = useMemo<Tagged[]>(
    () => transactions.filter((t) => t.amount < 0).map((t) => ({ t, cat: categoryOf(t) })),
    [transactions, categoryOf],
  );
  // Income doesn't appear on the spend-sized treemap, but it can still be
  // categorized (via the Transactions page or Refine) and excluded from totals
  // the same way expense categories can — surfaced in the filter panel below.
  const incomeTagged = useMemo<Tagged[]>(
    () => transactions.filter((t) => t.amount >= 0).map((t) => ({ t, cat: categoryOf(t) })),
    [transactions, categoryOf],
  );

  // The chart/treemap respects the visibility filter — both a fully-excluded
  // category AND an excluded sub-category within an otherwise-visible one
  // (e.g. hiding just "Transfers → Savings" shrinks the Transfers tile by that
  // amount without hiding all of Transfers). The management tools below
  // (sub-category manager, transaction lists) always see everything so hidden
  // categories/subs remain fully editable.
  const visibleExpenses = useMemo(
    () => expenses.filter((x) => !isExcluded(categoryFilter, x.cat, sub.subOf(x.t, x.cat))),
    [expenses, categoryFilter, sub],
  );

  // --- Treemap drill state ---------------------------------------------------
  const [category, setCategory] = useState<string | null>(null);
  const [leaf, setLeaf] = useState<string | null>(null);
  // Clicking the selected category's breadcrumb a second time (i.e. clicking
  // the category again) shows every transaction in it, not just one sub-group.
  const [viewAll, setViewAll] = useState(false);

  const categoriesPresent = useMemo(() => {
    const totals = new Map<string, number>();
    for (const x of expenses) totals.set(x.cat, (totals.get(x.cat) ?? 0) + -x.t.amount);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [expenses]);

  const rootCells = useMemo<TreemapCell[]>(() => {
    const totals = new Map<string, number>();
    for (const x of visibleExpenses) totals.set(x.cat, (totals.get(x.cat) ?? 0) + -x.t.amount);
    return [...totals.entries()]
      .map(([name, value]) => ({ name, value, color: categoryColor(name) }))
      .sort((a, b) => b.value - a.value);
  }, [visibleExpenses]);

  const inCategory = useMemo(
    () => (category ? expenses.filter((x) => x.cat === category) : []),
    [expenses, category],
  );
  // Same, but excluding hidden sub-categories — feeds only the chart/breakdown.
  const visibleInCategory = useMemo(
    () =>
      category
        ? inCategory.filter((x) => !isExcluded(categoryFilter, category, sub.subOf(x.t, category)))
        : [],
    [inCategory, category, categoryFilter, sub],
  );

  const isSplit = category ? sub.splitParents.has(category) : false;

  const childCells = useMemo<TreemapCell[]>(() => {
    if (!category) return [];
    const totals = new Map<string, number>();
    if (isSplit) {
      for (const x of visibleInCategory) {
        const s = sub.subOf(x.t, category);
        totals.set(s, (totals.get(s) ?? 0) + -x.t.amount);
      }
      return [...totals.entries()]
        .map(([name, value]) => ({
          name,
          value,
          color: name === UNSORTED ? '#cbd5e1' : categoryColor(`${category}/${name}`),
        }))
        .sort((a, b) => b.value - a.value);
    }
    // Not split → break down by merchant so the tile is still explorable.
    for (const x of visibleInCategory) {
      const key = signatureOf(x.t.description);
      totals.set(key, (totals.get(key) ?? 0) + -x.t.amount);
    }
    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, MERCHANT_LIMIT);
    const rest = sorted.slice(MERCHANT_LIMIT).reduce((a, [, v]) => a + v, 0);
    const cells = top.map(([name, value]) => ({
      name,
      value,
      color: categoryColor(`${category}/${name}`),
    }));
    if (rest > 0) cells.push({ name: 'Other', value: rest, color: '#cbd5e1' });
    return cells;
  }, [category, visibleInCategory, isSplit, sub]);

  const leafTxs = useMemo(() => {
    if (!category || !leaf) return [];
    const rows = isSplit
      ? inCategory.filter((x) => sub.subOf(x.t, category) === leaf)
      : inCategory.filter((x) => signatureOf(x.t.description) === leaf);
    return rows.map((x) => x.t).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [category, leaf, inCategory, isSplit, sub]);

  const cells = category ? childCells : rootCells;
  const onSelect = (name: string) => {
    if (!category) {
      setCategory(name);
      setLeaf(null);
      setViewAll(false);
    } else {
      setViewAll(false);
      setLeaf((cur) => (cur === name ? null : name));
    }
  };

  const selectCategory = (c: string) => {
    setCategory(c);
    setLeaf(null);
    setViewAll(false);
  };

  return (
    <div className="cats-page">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Category map</h2>
            <p className="muted">
              Sized by spending (all time). Click a category to break it down; click it again to list
              every transaction in it.
            </p>
          </div>
        </div>

        <div className="crumbs">
          <button
            type="button"
            className="crumb"
            onClick={() => {
              setCategory(null);
              setLeaf(null);
              setViewAll(false);
            }}
          >
            All categories
          </button>
          {category && (
            <>
              <span className="crumb-sep">▸</span>
              <button
                type="button"
                className="crumb"
                title="Click again to list every transaction in this category"
                onClick={() => {
                  if (leaf) {
                    setLeaf(null);
                  } else {
                    setViewAll((v) => !v);
                  }
                }}
              >
                {category}
                {isSplit ? '' : ' · merchants'}
              </button>
            </>
          )}
          {category && leaf && !viewAll && (
            <>
              <span className="crumb-sep">▸</span>
              <span className="crumb crumb-current">{leaf}</span>
            </>
          )}
          {category && viewAll && (
            <>
              <span className="crumb-sep">▸</span>
              <span className="crumb crumb-current">All transactions</span>
            </>
          )}
          {category && !leaf && (
            <button
              type="button"
              className="linklike crumbs-action"
              onClick={() => setViewAll((v) => !v)}
            >
              {viewAll ? '◂ back to breakdown' : `view all ${inCategory.length} transactions`}
            </button>
          )}
        </div>

        {!viewAll && <CategoryTreemap data={cells} onSelect={onSelect} selected={leaf} />}

        {category && viewAll && (
          <CategoryTxList
            parent={category}
            rows={inCategory.map((x) => x.t)}
            sub={sub}
            showSubFilter={isSplit}
            onAssign={(ids, subName) => onBulkSetSubCategory(ids, category, subName)}
          />
        )}

        {category && leaf && !viewAll && (
          <div className="leaf-list">
            <div className="leaf-list-head">
              <strong>
                {leaf} · {leafTxs.length} transaction{leafTxs.length === 1 ? '' : 's'}
              </strong>
              <span className="muted">{money(leafTxs.reduce((a, t) => a + -t.amount, 0))}</span>
            </div>
            <CategoryTxList
              parent={category}
              rows={leafTxs}
              sub={sub}
              showSubFilter={false}
              onAssign={(ids, subName) => onBulkSetSubCategory(ids, category, subName)}
            />
          </div>
        )}
      </section>

      <CategoryFilterPanel
        expenses={expenses}
        incomeTagged={incomeTagged}
        sub={sub}
        categoryFilter={categoryFilter}
        onToggleCategoryFilter={onToggleCategoryFilter}
        onToggleSubFilter={onToggleSubFilter}
      />

      <SubcategoryManager
        categoriesPresent={categoriesPresent}
        expenses={expenses}
        sub={sub}
        subRules={subRules}
        onAddSubRule={onAddSubRule}
        onDeleteSubRule={onDeleteSubRule}
        onFocusCategory={selectCategory}
      />
    </div>
  );
}

// --- Show in charts & totals (category/sub visibility filter) ---------------

function CategoryFilterPanel({
  expenses,
  incomeTagged,
  sub,
  categoryFilter,
  onToggleCategoryFilter,
  onToggleSubFilter,
}: {
  expenses: Tagged[];
  incomeTagged: Tagged[];
  sub: SubResolver;
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

// --- Sub-category manager -----------------------------------------------------

function SubcategoryManager({
  categoriesPresent,
  expenses,
  sub,
  subRules,
  onAddSubRule,
  onDeleteSubRule,
  onFocusCategory,
}: {
  categoriesPresent: string[];
  expenses: Tagged[];
  sub: SubResolver;
  subRules: SubRule[];
  onAddSubRule: (parent: string, keyword: string, subName: string) => void;
  onDeleteSubRule: (id: string) => void;
  onFocusCategory: (c: string) => void;
}) {
  const [parent, setParent] = useState('');
  const active = parent || categoriesPresent[0] || '';

  const inParent = useMemo(
    () => expenses.filter((x) => x.cat === active).map((x) => x.t),
    [expenses, active],
  );
  const unsorted = useMemo(
    () => inParent.filter((t) => sub.subOf(t, active) === UNSORTED),
    [inParent, active, sub],
  );
  const suggestions = useMemo(() => suggestSubGroups(unsorted), [unsorted]);
  const parentRules = useMemo(
    () => subRules.filter((r) => r.parent === active).sort((a, b) => b.createdAt - a.createdAt),
    [subRules, active],
  );

  const [names, setNames] = useState<Record<string, string>>({});

  const countFor = (keyword: string) =>
    inParent.filter((t) => t.description.toLowerCase().includes(keyword)).length;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Split a category into sub-categories</h2>
          <p className="muted">
            For look-alike buckets like Transfers — name the groups the app finds. Rules apply to
            future imports too; untagged transactions stay “Unsorted”.
          </p>
        </div>
        <label className="picker">
          <span className="picker-label">Category</span>
          <select
            value={active}
            onChange={(e) => {
              setParent(e.target.value);
              setNames({});
            }}
          >
            {categoriesPresent.map((c) => (
              <option key={c} value={c}>
                {c}
                {sub.splitParents.has(c) ? ' ✓' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="sub-stats muted">
        {inParent.length} transactions · {inParent.length - unsorted.length} sorted ·{' '}
        {unsorted.length} unsorted
        {sub.splitParents.has(active) && (
          <button type="button" className="linklike" onClick={() => onFocusCategory(active)}>
            view in map
          </button>
        )}
      </div>

      {parentRules.length > 0 && (
        <div className="sub-rules">
          <h3>Sub-categories</h3>
          {parentRules.map((r) => (
            <div key={r.id} className="sub-rule">
              <span className="catdot" style={{ background: categoryColor(`${active}/${r.sub}`) }} />
              <span className="sub-rule-name">{r.sub}</span>
              <span className="muted">
                “{r.keyword}” · {countFor(r.keyword)} match
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onDeleteSubRule(r.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <h3 className="sub-suggest-head">Suggested groups</h3>
      {suggestions.length === 0 ? (
        <p className="muted">
          {unsorted.length === 0
            ? 'Everything here is sorted. 🎉'
            : 'No repeating groups found in the unsorted transactions.'}
        </p>
      ) : (
        <div className="sub-suggests">
          {suggestions.map((s) => (
            <div key={s.keyword} className="sub-suggest">
              <div className="sub-suggest-info">
                <strong>“{s.keyword}”</strong>
                <span className="muted">
                  {s.count} tx · {money(s.total)}
                </span>
                <span className="sub-samples">{s.samples.join(' · ')}</span>
              </div>
              <div className="sub-suggest-add">
                <input
                  value={names[s.keyword] ?? ''}
                  placeholder="Name this group…"
                  maxLength={28}
                  onChange={(e) => setNames((n) => ({ ...n, [s.keyword]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (names[s.keyword] ?? '').trim()) {
                      onAddSubRule(active, s.keyword, names[s.keyword].trim());
                      setNames((n) => ({ ...n, [s.keyword]: '' }));
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!(names[s.keyword] ?? '').trim()}
                  onClick={() => {
                    onAddSubRule(active, s.keyword, names[s.keyword].trim());
                    setNames((n) => ({ ...n, [s.keyword]: '' }));
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
