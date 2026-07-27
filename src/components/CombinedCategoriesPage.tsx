import { useMemo, useState } from 'react';
import type { Transaction } from '../types';
import { categoryColor, signatureOf } from '../lib/categorize';
import { UNSORTED } from '../lib/subcategory';
import { money } from '../lib/format';
import CategoryTreemap, { type TreemapCell } from './CategoryTreemap';

interface Props {
  /** Already category-filtered per each card's own hidden-category settings
   *  (see combineSnapshots) — a category hidden on one card is excluded here
   *  while a card that doesn't hide it still counts and shows its share. */
  transactions: Transaction[];
  categoryOf: (tx: Transaction) => string;
  subOf: (tx: Transaction, cat: string) => string;
  cardNameOf: (tx: Transaction) => string;
}

interface Tagged {
  t: Transaction;
  cat: string;
}

const MERCHANT_LIMIT = 12;

/**
 * Read-only Category map across every combined card. Mirrors CategoriesPage's
 * treemap/drill-down, but fed by merged data instead of a single card, and
 * with no editing (hiding categories, sub-category rules) — those require a
 * specific card's own filter/rules, so switch to a single card for those.
 */
export default function CombinedCategoriesPage({ transactions, categoryOf, subOf, cardNameOf }: Props) {
  const expenses = useMemo<Tagged[]>(
    () => transactions.filter((t) => t.amount < 0).map((t) => ({ t, cat: categoryOf(t) })),
    [transactions, categoryOf],
  );

  const [category, setCategory] = useState<string | null>(null);
  const [leaf, setLeaf] = useState<string | null>(null);
  const [viewAll, setViewAll] = useState(false);

  const rootCells = useMemo<TreemapCell[]>(() => {
    const totals = new Map<string, number>();
    for (const x of expenses) totals.set(x.cat, (totals.get(x.cat) ?? 0) + -x.t.amount);
    return [...totals.entries()]
      .map(([name, value]) => ({ name, value, color: categoryColor(name) }))
      .sort((a, b) => b.value - a.value);
  }, [expenses]);

  const inCategory = useMemo(
    () => (category ? expenses.filter((x) => x.cat === category) : []),
    [expenses, category],
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
      for (const x of inCategory) {
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
    for (const x of inCategory) {
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
  }, [category, inCategory, isSplit, subOf]);

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

  return (
    <div className="cats-page">
      <p className="muted combine-readonly-note">
        Showing every card's spending together, read-only. Switch to a single card in the selector
        above to manage hidden categories or sub-categories.
      </p>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Category map</h2>
            <p className="muted">
              Sized by spending across every combined card (all time; each card's own hidden
              categories are excluded). Click a category to break it down; click it again to list
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
                    <th>Date</th>
                    <th>Card</th>
                    <th>Description</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsToShow.map((t) => (
                    <tr key={`${cardNameOf(t)}:${t.id}`}>
                      <td className="tx-date">{t.date}</td>
                      <td>
                        <span className="tx-card-badge">{cardNameOf(t)}</span>
                      </td>
                      <td className="desc" title={t.description}>
                        {t.description || '—'}
                      </td>
                      <td className="num neg">{money(t.amount)}</td>
                    </tr>
                  ))}
                  {rowsToShow.length === 0 && (
                    <tr>
                      <td colSpan={4} className="muted tx-empty">
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
    </div>
  );
}
