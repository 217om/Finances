import { useEffect, useMemo, useState } from 'react';
import type { CombinedRow } from '../lib/combine';
import { categoryColor } from '../lib/categorize';
import { UNSORTED } from '../lib/subcategory';
import { money } from '../lib/format';

interface Props {
  rows: CombinedRow[];
}

type TypeFilter = 'all' | 'expense' | 'income';
const PAGE = 100;

/**
 * Read-only merged view of every card's transactions together while
 * "Combine all cards" is selected. Never affected by any card's hidden-
 * category filter, matching the single-card Transactions tab's behavior.
 * Category edits require a specific card's rule set, so there's no editing
 * here — switch to a single card in the selector above to reclassify.
 */
export default function CombinedTransactionsPage({ rows }: Props) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [category, setCategory] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [visible, setVisible] = useState(PAGE);

  const categoriesPresent = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.category);
    return [...set].sort();
  }, [rows]);

  const dateBounds = useMemo(() => {
    if (rows.length === 0) return { min: '', max: '' };
    let min = rows[0].t.date;
    let max = rows[0].t.date;
    for (const r of rows) {
      if (r.t.date < min) min = r.t.date;
      if (r.t.date > max) max = r.t.date;
    }
    return { min, max };
  }, [rows]);

  const needle = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (typeFilter === 'expense' && r.t.amount >= 0) return false;
        if (typeFilter === 'income' && r.t.amount < 0) return false;
        if (category !== 'all' && r.category !== category) return false;
        if (fromDate && r.t.date < fromDate) return false;
        if (toDate && r.t.date > toDate) return false;
        if (needle && !r.t.description.toLowerCase().includes(needle)) return false;
        return true;
      }),
    [rows, typeFilter, category, fromDate, toDate, needle],
  );

  useEffect(() => {
    setVisible(PAGE);
  }, [search, typeFilter, category, fromDate, toDate]);

  const shown = filtered.slice(0, visible);
  const total = filtered.reduce((a, r) => a + r.t.amount, 0);

  return (
    <div className="tx-page">
      <p className="muted combine-readonly-note">
        Showing every card together, read-only. Switch to a single card in the selector above to
        edit categories.
      </p>
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
              <th>Card</th>
              <th>Description</th>
              <th>Category</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={`${r.cardId}:${r.t.id}`}>
                <td className="tx-date">{r.t.date}</td>
                <td>
                  <span className="tx-card-badge">{r.cardName}</span>
                </td>
                <td className="desc" title={r.t.description}>
                  {r.t.description || '—'}
                </td>
                <td className="tx-cat">
                  <span className="catdot" style={{ background: categoryColor(r.category) }} />
                  {r.category}
                  {r.sub !== UNSORTED ? ` / ${r.sub}` : ''}
                </td>
                <td className={`num ${r.t.amount >= 0 ? 'pos' : 'neg'}`}>{money(r.t.amount)}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="muted tx-empty">
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
