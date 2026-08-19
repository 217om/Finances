import { useMemo, useState } from 'react';
import type { Transaction } from '../types';
import { categoryColor, signatureOf } from '../lib/categorize';
import { UNSORTED } from '../lib/subcategory';
import { isExcluded, type CategoryFilterState } from '../lib/categoryFilter';
import type { CategoryFilterPreset } from '../lib/categoryFilterPresets';
import { money } from '../lib/format';
import { type PresetKey, PRESETS, presetRange } from '../lib/rangePresets';
import CategoryTreemap, { type TreemapCell } from './CategoryTreemap';
import CategoryFilterPanel, { type MiniSubResolver, type Tagged } from './CategoryFilterPanel';
import RangeMenu from './RangeMenu';
import TxNoteCell from './TxNoteCell';

type RangeKey = PresetKey | 'all';

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [...PRESETS, { key: 'all', label: 'All time' }];

interface Props {
  /** Unfiltered by any card's own hidden-category filter (see combineAllData)
   *  — this view has its own independent filter below and should have the
   *  full picture available regardless of what any individual card hides. */
  transactions: Transaction[];
  categoryOf: (tx: Transaction) => string;
  monthStartDay: number;
  weekStartDay: number;
  subOf: (tx: Transaction, cat: string) => string;
  cardNameOf: (tx: Transaction) => string;
  cardIdOf: (tx: Transaction) => string;
  /** Independent from any single card's own filter — hiding a category here
   *  only affects this combined view, and doesn't touch any card's settings. */
  categoryFilter: CategoryFilterState;
  onToggleCategoryFilter: (category: string) => void;
  onToggleSubFilter: (category: string, subName: string) => void;
  onSetTxNote: (cardId: string, id: string, note: string) => void;
  presets: CategoryFilterPreset[];
  onSavePreset: (name: string, includedCategories: string[], includedSubs: Record<string, string[]>) => void;
  onRenamePreset: (id: string, name: string) => void;
  onDeletePreset: (id: string) => void;
  onApplyPreset: (filter: CategoryFilterState) => void;
}

const MERCHANT_LIMIT = 12;

/**
 * Category map across every combined card. Mirrors CategoriesPage's
 * treemap/drill-down, fed by merged data instead of a single card, plus its
 * own hide/show filter — independent from any individual card's filter — so
 * the combined view can be explored on its own terms. Sub-category RULES
 * still require a specific card (there's no single card's rules to edit
 * here), so switch to a single card for those — but notes are plain
 * per-transaction text with no rules involved, so those stay editable here.
 */
export default function CombinedCategoriesPage({
  transactions,
  categoryOf,
  monthStartDay,
  weekStartDay,
  subOf,
  cardNameOf,
  cardIdOf,
  categoryFilter,
  onToggleCategoryFilter,
  onToggleSubFilter,
  onSetTxNote,
  presets,
  onSavePreset,
  onRenamePreset,
  onDeletePreset,
  onApplyPreset,
}: Props) {
  // Defaults to month-to-date so the map reflects recent spending rather
  // than the combined history — the user can widen it via the low-key range
  // word in the subtitle below.
  const [rangeKey, setRangeKey] = useState<RangeKey>('mtd');

  const dateBounds = useMemo(() => {
    if (transactions.length === 0) return { min: '', max: '' };
    let min = transactions[0].date;
    let max = transactions[0].date;
    for (const t of transactions) {
      if (t.date < min) min = t.date;
      if (t.date > max) max = t.date;
    }
    return { min, max };
  }, [transactions]);

  const range = useMemo(() => {
    if (!dateBounds.max) return { from: '', to: '' };
    if (rangeKey === 'all') return { from: dateBounds.min, to: dateBounds.max };
    return presetRange(rangeKey, monthStartDay, weekStartDay, dateBounds);
  }, [rangeKey, monthStartDay, weekStartDay, dateBounds]);

  const ranged = useMemo(() => {
    if (!range.from || !range.to) return transactions;
    return transactions.filter((t) => t.date >= range.from && t.date <= range.to);
  }, [transactions, range]);

  const expenses = useMemo<Tagged[]>(
    () => ranged.filter((t) => t.amount < 0).map((t) => ({ t, cat: categoryOf(t) })),
    [ranged, categoryOf],
  );
  const incomeTagged = useMemo<Tagged[]>(
    () => ranged.filter((t) => t.amount >= 0).map((t) => ({ t, cat: categoryOf(t) })),
    [ranged, categoryOf],
  );
  // Unranged (all-time) versions feed the filter panel's row set/order and
  // the sub-category list below, so switching the date range above never
  // adds, drops, or reshuffles a filter row — only the amount next to it.
  const allExpenses = useMemo<Tagged[]>(
    () => transactions.filter((t) => t.amount < 0).map((t) => ({ t, cat: categoryOf(t) })),
    [transactions, categoryOf],
  );
  const allIncomeTagged = useMemo<Tagged[]>(
    () => transactions.filter((t) => t.amount >= 0).map((t) => ({ t, cat: categoryOf(t) })),
    [transactions, categoryOf],
  );

  const [category, setCategory] = useState<string | null>(null);
  const [leaf, setLeaf] = useState<string | null>(null);
  const [viewAll, setViewAll] = useState(false);

  // The chart/treemap respects this view's own visibility filter; the
  // transaction lists below always see everything, same as CategoriesPage.
  const visibleExpenses = useMemo(
    () => expenses.filter((x) => !isExcluded(categoryFilter, x.cat, subOf(x.t, x.cat))),
    [expenses, categoryFilter, subOf],
  );

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
  const visibleInCategory = useMemo(
    () =>
      category
        ? inCategory.filter((x) => !isExcluded(categoryFilter, category, subOf(x.t, category)))
        : [],
    [inCategory, category, categoryFilter, subOf],
  );

  // Whether any merged transaction in this category actually has a real
  // sub-category assigned (as opposed to every card's rules leaving it
  // entirely Unsorted, in which case a merchant breakdown is more useful).
  const isSplit = useMemo(
    () => (category ? inCategory.some((x) => subOf(x.t, category) !== UNSORTED) : false),
    [category, inCategory, subOf],
  );

  const childCells = useMemo<TreemapCell[]>(() => {
    if (!category) return [];
    const totals = new Map<string, number>();
    if (isSplit) {
      for (const x of visibleInCategory) {
        const s = subOf(x.t, category);
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
  }, [category, visibleInCategory, isSplit, subOf]);

  const leafTxs = useMemo(() => {
    if (!category || !leaf) return [];
    const rows = isSplit
      ? inCategory.filter((x) => subOf(x.t, category) === leaf)
      : inCategory.filter((x) => signatureOf(x.t.description) === leaf);
    return rows.map((x) => x.t).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [category, leaf, inCategory, isSplit, subOf]);

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

  const rowsToShow = viewAll ? inCategory.map((x) => x.t) : leafTxs;

  // A minimal stand-in for a card's own SubResolver — there's no single
  // card's rules to build a real one from here, but the filter panel only
  // needs to resolve a sub-category and list the ones actually present.
  const combinedSub = useMemo<MiniSubResolver>(
    () => ({
      subOf,
      // All-time, not range-scoped — otherwise a sub-category with no
      // activity in the current range would vanish from the panel instead
      // of just showing 0.
      subsForParent: (parent) => {
        const names = new Set<string>();
        for (const x of allExpenses) {
          if (x.cat !== parent) continue;
          const s = subOf(x.t, parent);
          if (s !== UNSORTED) names.add(s);
        }
        return [...names].sort();
      },
    }),
    [subOf, allExpenses],
  );

  return (
    <div className="cats-page">
      <p className="muted combine-readonly-note">
        All cards combined. Hiding a category here only affects this view, not any card's own
        filter.
      </p>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Category map</h2>
            <p className="muted">
              Sized by spending, <RangeMenu options={RANGE_OPTIONS} activeKey={rangeKey} onSelect={(k) => setRangeKey(k as RangeKey)} />.
              Click to break down, click again for transactions.
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

        {category && (viewAll || (leaf && !viewAll)) && (
          <div className="leaf-list">
            {leaf && !viewAll && (
              <div className="leaf-list-head">
                <strong>
                  {leaf} · {leafTxs.length} transaction{leafTxs.length === 1 ? '' : 's'}
                </strong>
                <span className="muted">{money(leafTxs.reduce((a, t) => a + -t.amount, 0))}</span>
              </div>
            )}
            <div className="tx-table-wrap">
              <table className="data-table tx-table">
                <thead>
                  <tr>
                    <th className="tx-th-label">Date</th>
                    <th className="tx-th-label">Card</th>
                    <th className="tx-th-label">Description</th>
                    <th className="num tx-th-label">Amount</th>
                    <th className="tx-note">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsToShow.map((t) => (
                    <tr key={`${cardIdOf(t)}:${t.id}`}>
                      <td className="tx-date" data-label="Date">{t.date}</td>
                      <td data-label="Card">
                        <span className="tx-card-badge">{cardNameOf(t)}</span>
                      </td>
                      <td className="desc" data-label="Description" title={t.description}>
                        {t.description || '—'}
                      </td>
                      <td className="num neg" data-label="Amount">{money(t.amount)}</td>
                      <td className="tx-note" data-label="Note">
                        <TxNoteCell note={t.note} onSave={(note) => onSetTxNote(cardIdOf(t), t.id, note)} />
                      </td>
                    </tr>
                  ))}
                  {rowsToShow.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted tx-empty">
                        No transactions match these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <CategoryFilterPanel
        expenses={expenses}
        incomeTagged={incomeTagged}
        allExpenses={allExpenses}
        allIncomeTagged={allIncomeTagged}
        sub={combinedSub}
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
