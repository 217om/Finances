import { useEffect, useMemo, useState } from 'react';
import type { Transaction } from '../types';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../lib/categorize';
import { UNSORTED, type SubResolver } from '../lib/subcategory';
import { money } from '../lib/format';
import CategoryPicker from './CategoryPicker';

interface Props {
  transactions: Transaction[];
  categoryOf: (tx: Transaction) => string;
  overriddenIds: Set<string>;
  customCategories: string[];
  sub: SubResolver;
  onSetCategory: (id: string, category: string) => void;
  onClearCategory: (id: string) => void;
  onCreateCategory: (name: string) => void;
  onSetSubCategory: (id: string, parent: string, subName: string) => void;
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
  sub,
  onSetCategory,
  onClearCategory,
  onCreateCategory,
  onSetSubCategory,
}: Props) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [category, setCategory] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
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

  const incomeOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of [...INCOME_CATEGORIES, ...customCategories]) {
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

  const dateBounds = useMemo(() => {
    if (base.length === 0) return { min: '', max: '' };
    return { min: base[base.length - 1].t.date, max: base[0].t.date };
  }, [base]);

  const needle = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      base.filter((r) => {
        if (typeFilter === 'expense' && r.t.amount >= 0) return false;
        if (typeFilter === 'income' && r.t.amount < 0) return false;
        if (category !== 'all' && r.cat !== category) return false;
        if (fromDate && r.t.date < fromDate) return false;
        if (toDate && r.t.date > toDate) return false;
        if (needle && !r.t.description.toLowerCase().includes(needle)) return false;
        return true;
      }),
    [base, typeFilter, category, fromDate, toDate, needle],
  );

  // Keep the rendered list bounded whenever the filters change.
  useEffect(() => {
    setVisible(PAGE);
  }, [search, typeFilter, category, fromDate, toDate]);

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
        <label className="picker">
          <span className="picker-label">From</span>
          <input
            type="date"
            value={fromDate}
            min={dateBounds.min}
            max={dateBounds.max}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </label>
        <label className="picker">
          <span className="picker-label">To</span>
          <input
            type="date"
            value={toDate}
            min={dateBounds.min}
            max={dateBounds.max}
            onChange={(e) => setToDate(e.target.value)}
          />
        </label>
        {(fromDate || toDate) && (
          <button
            type="button"
            className="linklike"
            onClick={() => {
              setFromDate('');
              setToDate('');
            }}
          >
            Clear dates
          </button>
        )}
      </div>

      <div className="tx-summary muted">
        {filtered.length.toLocaleString()} transaction{filtered.length === 1 ? '' : 's'} ·{' '}
        <span className={total >= 0 ? 'pos' : 'neg'}>{money(total)}</span> net
      </div>

      <div className="tx-table-wrap">
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
                  <div className="tx-cat-cell">
                    <div className="tx-cat-edit">
                      <CategoryPicker
                        value={cat}
                        onChange={(c) => onSetCategory(t.id, c)}
                        options={t.amount < 0 ? options : incomeOptions}
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
                    {t.amount < 0 && sub.splitParents.has(cat) && (
                      <div className="tx-sub-edit">
                        <span className="tx-sub-arrow">↳</span>
                        <CategoryPicker
                          value={sub.subOf(t, cat)}
                          onChange={(s) => onSetSubCategory(t.id, cat, s)}
                          options={sub.subsForParent(cat)}
                          onCreate={(name) => onSetSubCategory(t.id, cat, name)}
                          keepValue={UNSORTED}
                          keepLabel={UNSORTED}
                        />
                      </div>
                    )}
                  </div>
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
