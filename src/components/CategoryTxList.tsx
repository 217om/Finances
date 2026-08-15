import { useEffect, useMemo, useState } from 'react';
import type { Transaction } from '../types';
import { UNSORTED, type SubResolver } from '../lib/subcategory';
import { categoryColor } from '../lib/categorize';
import { money } from '../lib/format';
import CategoryPicker from './CategoryPicker';
import TxNoteCell from './TxNoteCell';

interface Props {
  parent: string;
  rows: Transaction[]; // all expense transactions already scoped to this parent (or a sub of it)
  sub: SubResolver;
  onAssign: (ids: string[], subName: string) => void;
  onSetTxNote: (id: string, note: string) => void;
  /** Show the sub-category filter dropdown (only meaningful at the whole-category level). */
  showSubFilter?: boolean;
}

const PAGE = 100;
type Sort = 'date' | 'amount';

/**
 * Searchable, sortable, paginated transaction list with multi-select and bulk
 * sub-category assignment. Used both for "every transaction in this category"
 * and for a single sub-group's transactions, so search + reassignment work
 * everywhere you can see a list of transactions.
 */
export default function CategoryTxList({ parent, rows, sub, onAssign, onSetTxNote, showSubFilter }: Props) {
  const [search, setSearch] = useState('');
  const [subFilter, setSubFilter] = useState('all');
  const [sort, setSort] = useState<Sort>('date');
  const [visible, setVisible] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignTo, setAssignTo] = useState('');

  const subOptions = useMemo(() => sub.subsForParent(parent), [sub, parent]);

  const tagged = useMemo(() => rows.map((t) => ({ t, s: sub.subOf(t, parent) })), [rows, parent, sub]);

  const needle = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    const out = tagged.filter((x) => {
      if (subFilter !== 'all' && x.s !== subFilter) return false;
      if (needle && !x.t.description.toLowerCase().includes(needle)) return false;
      return true;
    });
    out.sort((a, b) =>
      sort === 'date'
        ? b.t.date.localeCompare(a.t.date)
        : Math.abs(b.t.amount) - Math.abs(a.t.amount),
    );
    return out;
  }, [tagged, subFilter, needle, sort]);

  useEffect(() => {
    setVisible(PAGE);
  }, [search, subFilter, sort, rows]);

  // Drop any selected ids that scrolled out of the current filter result.
  useEffect(() => {
    const validIds = new Set(filtered.map((x) => x.t.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needle, subFilter]);

  const shown = filtered.slice(0, visible);
  const total = filtered.reduce((a, x) => a + -x.t.amount, 0);
  const allShownSelected = shown.length > 0 && shown.every((x) => selected.has(x.t.id));

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllShown = () => {
    setSelected((prev) => {
      if (allShownSelected) {
        const next = new Set(prev);
        for (const x of shown) next.delete(x.t.id);
        return next;
      }
      const next = new Set(prev);
      for (const x of shown) next.add(x.t.id);
      return next;
    });
  };

  const applyAssign = () => {
    if (!assignTo || selected.size === 0) return;
    onAssign([...selected], assignTo);
    setSelected(new Set());
    setAssignTo('');
  };

  return (
    <div className="cattx">
      <div className="cattx-controls">
        <input
          className="explorer-search"
          value={search}
          placeholder="Search description…"
          onChange={(e) => setSearch(e.target.value)}
        />
        {showSubFilter && (
          <label className="picker">
            <span className="picker-label">Sub-category</span>
            <select value={subFilter} onChange={(e) => setSubFilter(e.target.value)}>
              <option value="all">All</option>
              <option value={UNSORTED}>{UNSORTED}</option>
              {subOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="seg seg-sm">
          <button type="button" className={sort === 'date' ? 'seg-on' : ''} onClick={() => setSort('date')}>
            Newest
          </button>
          <button
            type="button"
            className={sort === 'amount' ? 'seg-on' : ''}
            onClick={() => setSort('amount')}
          >
            Largest
          </button>
        </div>
      </div>

      <div className="cattx-summary muted">
        {filtered.length.toLocaleString()} transaction{filtered.length === 1 ? '' : 's'} ·{' '}
        {money(total)}
      </div>

      {selected.size > 0 && (
        <div className="cattx-bulk">
          <span>{selected.size} selected</span>
          <CategoryPicker
            value={assignTo}
            onChange={setAssignTo}
            options={subOptions}
            onCreate={(name) => onAssign([...selected], name)}
            keepValue=""
            keepLabel="Assign sub-category…"
          />
          <button type="button" className="btn btn-primary btn-sm" disabled={!assignTo} onClick={applyAssign}>
            Apply
          </button>
          <button type="button" className="linklike" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      <div className="tx-table-wrap">
        <table className="data-table tx-table">
          <thead>
            <tr>
              <th className="cattx-check">
                <input type="checkbox" checked={allShownSelected} onChange={toggleAllShown} />
              </th>
              <th className="tx-th-label">Date</th>
              <th className="tx-th-label">Description</th>
              <th className="tx-th-label">Sub-category</th>
              <th className="num tx-th-label">Amount</th>
              <th className="tx-note">Note</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ t, s }) => (
              <tr key={t.id} className={selected.has(t.id) ? 'row-selected' : ''}>
                <td className="cattx-check" data-label="Select">
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onChange={() => toggleOne(t.id)}
                  />
                </td>
                <td className="tx-date" data-label="Date">{t.date}</td>
                <td className="desc" data-label="Description" title={t.description}>
                  {t.description || '—'}
                </td>
                <td data-label="Sub-category">
                  <span className="catdot" style={{ background: s === UNSORTED ? '#cbd5e1' : categoryColor(`${parent}/${s}`) }} />
                  <span className={s === UNSORTED ? 'muted' : ''}>{s}</span>
                </td>
                <td className="num neg" data-label="Amount">{money(t.amount)}</td>
                <td className="tx-note" data-label="Note">
                  <TxNoteCell note={t.note} onSave={(note) => onSetTxNote(t.id, note)} />
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
