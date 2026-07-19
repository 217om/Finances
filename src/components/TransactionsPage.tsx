import { useEffect, useMemo, useState } from 'react';
import type { Transaction } from '../types';
import { EXPENSE_CATEGORIES, INCOME_CATEGORY, categoryColor } from '../lib/categorize';
import { money } from '../lib/format';
import CategoryPicker from './CategoryPicker';

interface Props {
  transactions: Transaction[];
  categoryOf: (tx: Transaction) => string;
  overriddenIds: Set<string>;
  customCategories: string[];
  onSetCategory: (id: string, category: string) => void;
  onClearCategory: (id: string) => void;
  onCreateCategory: (name: string) => void;
}

type TypeFilter = 'all' | 'expense' | 'income';
const PAGE = 100;

/**
 * Full transaction list — searchable, filterable, newest first, with inline
 * category editing. Rows are paginated ("Show more") so even years of data
 * never render tens of thousands of nodes at once.
 */
export default function TransactionsPage({
  transactions,
  categoryOf,
  overriddenIds,
  customCategories,
  onSetCategory,
  onClearCategory,
  onCreateCategory,
}: Props) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [category, setCategory] = useState('all');
  const [visible, setVisible] = useState(PAGE);

  const options = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of [...EXPENSE_CATEGORIES, ...customCategories]) {
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
    return out;
  }, [customCategories]);

  // Tag + sort once (newest first); filtering/search runs cheaply over this.
  const base = useMemo(
    () =>
      transactions
        .map((t) => ({ t, cat: categoryOf(t) }))
        .sort((a, b) => (a.t.date < b.t.date ? 1 : a.t.date > b.t.date ? -1 : 0)),
    [transactions, categoryOf],
  );

  const categoriesPresent = useMemo(() => {
    const set = new Set<string>();
    for (const r of base) set.add(r.cat);
    return [...set].sort();
  }, [base]);

  const needle = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      base.filter((r) => {
        if (typeFilter === 'expense' && r.t.amount >= 0) return false;
        if (typeFilter === 'income' && r.t.amount < 0) return false;
        if (category !== 'all' && r.cat !== category) return false;
        if (needle && !r.t.description.toLowerCase().includes(needle)) return false;
        return true;
      }),
    [base, typeFilter, category, needle],
  );

  // Keep the rendered list bounded whenever the filters change.
  useEffect(() => {
    setVisible(PAGE);
  }, [search, typeFilter, category]);

  const shown = filtered.slice(0, visible);
  const total = filtered.reduce((a, r) => a + r.t.amount, 0);

  return (
    <div className="tx-page">
      <div className="tx-controls">
        <input
          className="explorer-search"
          value={search}
          placeholder="Search description…"
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="seg seg-sm">
          {(['all', 'expense', 'income'] as TypeFilter[]).map((tf) => (
            <button
              key={tf}
              type="button"
              className={typeFilter === tf ? 'seg-on' : ''}
              onClick={() => setTypeFilter(tf)}
            >
              {tf === 'all' ? 'All' : tf === 'expense' ? 'Expenses' : 'Income'}
            </button>
          ))}
        </div>
        <label className="picker">
          <span className="picker-label">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All categories</option>
            {categoriesPresent.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="tx-summary muted">
        {filtered.length.toLocaleString()} transaction{filtered.length === 1 ? '' : 's'} ·{' '}
        <span className={total >= 0 ? 'pos' : 'neg'}>{money(total)}</span> net
      </div>

      <div className="table-wrap tx-table-wrap">
        <table className="data-table tx-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Category</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ t, cat }) => (
              <tr key={t.id}>
                <td className="tx-date">{t.date}</td>
                <td className="desc" title={t.description}>
                  {t.description || '—'}
                </td>
                <td className="tx-cat">
                  {t.amount < 0 ? (
                    <div className="tx-cat-edit">
                      <CategoryPicker
                        value={cat}
                        onChange={(c) => onSetCategory(t.id, c)}
                        options={options}
                        onCreate={onCreateCategory}
                      />
                      {overriddenIds.has(t.id) && (
                        <button
                          type="button"
                          className="tx-reset"
                          title="Revert to automatic category"
                          onClick={() => onClearCategory(t.id)}
                        >
                          ↺
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className="tx-income-cat">
                      <span className="catdot" style={{ background: categoryColor(INCOME_CATEGORY) }} />
                      Income
                    </span>
                  )}
                </td>
                <td className={`num ${t.amount >= 0 ? 'pos' : 'neg'}`}>{money(t.amount)}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="muted tx-empty">
                  No transactions match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {visible < filtered.length && (
        <div className="tx-more">
          <button type="button" className="btn" onClick={() => setVisible((v) => v + PAGE)}>
            Show more
          </button>
          <span className="muted">
            Showing {shown.length.toLocaleString()} of {filtered.length.toLocaleString()}
          </span>
        </div>
      )}
    </div>
  );
}
