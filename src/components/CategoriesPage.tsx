import { useMemo, useState } from 'react';
import type { Transaction } from '../types';
import { categoryColor, signatureOf } from '../lib/categorize';
import { UNSORTED, type SubResolver } from '../lib/subcategory';
import { isExcluded, type CategoryFilterState } from '../lib/categoryFilter';
import type { CategoryFilterPreset } from '../lib/categoryFilterPresets';
import { money } from '../lib/format';
import CategoryTreemap, { type TreemapCell } from './CategoryTreemap';
import CategoryTxList from './CategoryTxList';
import CategoryFilterPanel, { type Tagged } from './CategoryFilterPanel';

interface Props {
  transactions: Transaction[];
  categoryOf: (tx: Transaction) => string;
  sub: SubResolver;
  onBulkSetSubCategory: (ids: string[], parent: string, subName: string) => void;
  onSetTxNote: (id: string, note: string) => void;
  categoryFilter: CategoryFilterState;
  onToggleCategoryFilter: (category: string) => void;
  onToggleSubFilter: (category: string, subName: string) => void;
  presets: CategoryFilterPreset[];
  onSavePreset: (name: string, includedCategories: string[], includedSubs: Record<string, string[]>) => void;
  onRenamePreset: (id: string, name: string) => void;
  onDeletePreset: (id: string) => void;
  onApplyPreset: (filter: CategoryFilterState) => void;
}

const MERCHANT_LIMIT = 12;

export default function CategoriesPage({
  transactions,
  categoryOf,
  sub,
  onBulkSetSubCategory,
  onSetTxNote,
  categoryFilter,
  onToggleCategoryFilter,
  onToggleSubFilter,
  presets,
  onSavePreset,
  onRenamePreset,
  onDeletePreset,
  onApplyPreset,
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
  // amount without hiding all of Transfers). The transaction lists below
  // always see everything so hidden categories/subs remain fully editable.
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
          color: name === UNSORTED ? '#7A6F63' : categoryColor(`${category}/${name}`),
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
    if (rest > 0) cells.push({ name: 'Other', value: rest, color: '#7A6F63' });
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

  return (
    <div className="cats-page">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Category map</h2>
            <p className="muted">Sized by spending, all time. Click to break down, click again for transactions.</p>
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
            onSetTxNote={onSetTxNote}
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
              onSetTxNote={onSetTxNote}
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
        presets={presets}
        onSavePreset={onSavePreset}
        onRenamePreset={onRenamePreset}
        onDeletePreset={onDeletePreset}
        onApplyPreset={onApplyPreset}
      />
    </div>
  );
}
