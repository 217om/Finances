import { useEffect, useMemo, useState } from 'react';
import type { CombinedRow } from '../lib/combine';
import type { TransactionsJump } from './TransactionsPage';
import { categoryColor } from '../lib/categorize';
import { UNSORTED } from '../lib/subcategory';
import { money } from '../lib/format';
import TxNoteCell from './TxNoteCell';

interface Props {
  rows: CombinedRow[];
  /** Set when arriving from a chart-click drill-down; pre-fills the date range. */
  jump?: TransactionsJump | null;
  onSetTxNote: (cardId: string, id: string, note: string) => void;
}

type TypeFilter = 'all' | 'expense' | 'income';
const PAGE = 100;

/**
 * Merged view of every card's transactions together while "Combine all
 * cards" is selected. Never affected by any card's hidden-category filter,
 * matching the single-card Transactions tab's behavior. Category edits
 * require a specific card's rule set, so there's no editing here — switch to
 * a single card in the selector above to reclassify. Notes are plain
 * per-transaction text with no rules involved, so those stay editable —
 * each one is saved straight to the transaction's own card.
 */
export default function CombinedTransactionsPage({ rows, jump, onSetTxNote }: Props) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [category, setCategory] = useState('all');
  const [fromDate, setFromDate] = useState(jump?.from ?? '');
  const [toDate, setToDate] = useState(jump?.to ?? '');
  const [visible, setVisible] = useState(PAGE);
  const [hiddenActive, setHiddenActive] = useState(Boolean(jump));

  // A fresh chart-click jump pre-fills the date range and (only this once)
  // restricts to categories that aren't hidden on their own card — matching
  // what the chart itself counted — same as the single-card Transactions tab.
  useEffect(() => {
    if (!jump) return;
    setFromDate(jump.from);
    setToDate(jump.to);
    setHiddenActive(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.token]);

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
        if (hiddenActive && r.hidden) return false;
        return true;
      }),
    [rows, typeFilter, category, fromDate, toDate, needle, hiddenActive],
  );

  useEffect(() => {
    setVisible(PAGE);
  }, [search, typeFilter, category, fromDate, toDate]);

  const shown = filtered.slice(0, visible);
  const total = filtered.reduce((a, r) => a + r.t.amount, 0);

  return (
    <div className="tx-page">
      <p className="muted combine-readonly-note">
        Showing every card together. Switch to a single card in the selector above to edit
        categories — notes can be added right here.
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

      {hiddenActive && (
        <div className="hidden-tray">
          <span className="hidden-tray-label">
            Showing only categories that aren’t hidden on their own card.
          </span>
          <button type="button" className="linklike" onClick={() => setHiddenActive(false)}>
            Show all
          </button>
        </div>
      )}

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
              <th className="tx-note">Note</th>
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
                <td className="tx-note">
                  <TxNoteCell note={r.t.note} onSave={(note) => onSetTxNote(r.cardId, r.t.id, note)} />
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="muted tx-empty">
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
