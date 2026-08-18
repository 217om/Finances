import { useEffect, useMemo, useState } from 'react';
import type { CombinedRow } from '../lib/combine';
import type { TransactionsJump } from './TransactionsPage';
import { categoryColor } from '../lib/categorize';
import { UNSORTED } from '../lib/subcategory';
import { isExcluded, type CategoryFilterState } from '../lib/categoryFilter';
import { chronologicalCompare } from '../lib/balances';
import { money } from '../lib/format';
import { useConfirm } from '../hooks/useConfirm';
import ColumnHeaderMenu from './ColumnHeaderMenu';
import TxNoteCell from './TxNoteCell';
import TrashIcon from './TrashIcon';

interface Props {
  rows: CombinedRow[];
  /** Set when arriving from a chart-click drill-down; pre-fills the date range. */
  jump?: TransactionsJump | null;
  onSetTxNote: (cardId: string, id: string, note: string) => void;
  onDeleteTransaction: (cardId: string, id: string) => void;
  /** The combined view's own independent filter (shared with the combined
   *  Dashboard/Categories) — applied here only for one visit after a
   *  chart-click drill-down, so the list matches what the chart counted. */
  categoryFilter: CategoryFilterState;
}

type TypeFilter = 'all' | 'expense' | 'income';
type SortCol = 'date' | 'description' | 'amount';
interface SortState {
  col: SortCol;
  dir: 'asc' | 'desc';
}
const PAGE = 100;

function compareBase(col: SortCol, a: CombinedRow, b: CombinedRow): number {
  switch (col) {
    case 'date':
      // See TransactionsPage's compareBase — same-date rows aren't stored
      // in true chronological order, so this recovers it instead of
      // leaving ties arbitrary.
      return chronologicalCompare(a.t, b.t);
    case 'description':
      return a.t.description.localeCompare(b.t.description);
    case 'amount':
      return a.t.amount - b.t.amount;
    default:
      return 0;
  }
}

/**
 * Merged view of every card's transactions together while "Combine all
 * cards" is selected. Never affected by the combined view's hidden-category
 * filter, matching the single-card Transactions tab's behavior. Category
 * edits require a specific card's rule set, so there's no editing here —
 * switch to a single card in the selector above to reclassify. Notes and
 * deletion aren't rule-dependent, so those stay available here too — each
 * one is applied straight to the transaction's own card.
 */
export default function CombinedTransactionsPage({ rows, jump, onSetTxNote, onDeleteTransaction, categoryFilter }: Props) {
  const { confirmAsync, confirmDialog } = useConfirm();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [categorySelected, setCategorySelected] = useState<Set<string> | null>(null);
  const [cardSelected, setCardSelected] = useState<Set<string> | null>(null);
  const [sort, setSort] = useState<SortState>({ col: 'date', dir: 'desc' });
  const [fromDate, setFromDate] = useState(jump?.from ?? '');
  const [toDate, setToDate] = useState(jump?.to ?? '');
  const [visible, setVisible] = useState(PAGE);
  const [hiddenActive, setHiddenActive] = useState(Boolean(jump));

  // A fresh chart-click jump pre-fills the date range and (only this once)
  // restricts to categories the combined view's own filter doesn't hide —
  // matching what the chart itself counted — same as the single-card
  // Transactions tab.
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

  const cardsPresent = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.cardName);
    return [...set].sort();
  }, [rows]);

  // Sort once per sort choice (newest first by default); filtering/search
  // runs cheaply over this.
  const base = useMemo(() => {
    const sorted = [...rows];
    const mult = sort.dir === 'asc' ? 1 : -1;
    sorted.sort((a, b) => compareBase(sort.col, a, b) * mult);
    return sorted;
  }, [rows, sort]);

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

  const hasBalance = useMemo(() => rows.some((r) => r.t.balance != null), [rows]);

  const needle = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      base.filter((r) => {
        if (typeFilter === 'expense' && r.t.amount >= 0) return false;
        if (typeFilter === 'income' && r.t.amount < 0) return false;
        if (categorySelected && !categorySelected.has(r.category)) return false;
        if (cardSelected && !cardSelected.has(r.cardName)) return false;
        if (fromDate && r.t.date < fromDate) return false;
        if (toDate && r.t.date > toDate) return false;
        if (needle && !r.t.description.toLowerCase().includes(needle)) return false;
        if (hiddenActive && isExcluded(categoryFilter, r.category, r.sub)) return false;
        return true;
      }),
    [base, typeFilter, categorySelected, cardSelected, fromDate, toDate, needle, hiddenActive, categoryFilter],
  );

  useEffect(() => {
    setVisible(PAGE);
  }, [search, typeFilter, categorySelected, cardSelected, fromDate, toDate]);

  const shown = filtered.slice(0, visible);
  const total = filtered.reduce((a, r) => a + r.t.amount, 0);

  return (
    <div className="tx-page">
      {confirmDialog}
      <p className="muted combine-readonly-note">
        Showing every card together. Switch to a single card to edit categories.
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
            Showing only categories that aren’t hidden by the combined view's filter.
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
              <th className="tx-th-menu">
                <ColumnHeaderMenu
                  label="Date"
                  sortActive={sort.col === 'date'}
                  sortDir={sort.dir}
                  ascLabel="Oldest first"
                  descLabel="Newest first"
                  onSort={(dir) => setSort({ col: 'date', dir })}
                />
              </th>
              <th className="tx-th-menu">
                <ColumnHeaderMenu
                  label="Card"
                  filterValues={cardsPresent}
                  selectedValues={cardSelected}
                  onChangeSelected={setCardSelected}
                />
              </th>
              <th className="tx-th-menu">
                <ColumnHeaderMenu
                  label="Description"
                  sortActive={sort.col === 'description'}
                  sortDir={sort.dir}
                  ascLabel="A → Z"
                  descLabel="Z → A"
                  onSort={(dir) => setSort({ col: 'description', dir })}
                />
              </th>
              <th className="tx-th-menu">
                <ColumnHeaderMenu
                  label="Category"
                  filterValues={categoriesPresent}
                  selectedValues={categorySelected}
                  onChangeSelected={setCategorySelected}
                />
              </th>
              <th className="num tx-th-menu">
                <ColumnHeaderMenu
                  label="Amount"
                  align="right"
                  sortActive={sort.col === 'amount'}
                  sortDir={sort.dir}
                  ascLabel="Smallest first"
                  descLabel="Largest first"
                  onSort={(dir) => setSort({ col: 'amount', dir })}
                />
              </th>
              {hasBalance && <th className="num">Balance</th>}
              <th className="tx-note">Note</th>
              <th className="tx-delete" />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={`${r.cardId}:${r.t.id}`}>
                <td className="tx-date" data-label="Date">{r.t.date}</td>
                <td data-label="Card">
                  <span className="tx-card-badge">{r.cardName}</span>
                </td>
                <td className="desc" data-label="Description" title={r.t.description}>
                  {r.t.description || '—'}
                </td>
                <td className="tx-cat" data-label="Category">
                  <span className="catdot" style={{ background: categoryColor(r.category) }} />
                  {r.category}
                  {r.sub !== UNSORTED ? ` / ${r.sub}` : ''}
                </td>
                <td className={`num ${r.t.amount >= 0 ? 'pos' : 'neg'}`} data-label="Amount">{money(r.t.amount)}</td>
                {hasBalance && (
                  <td className="num muted" data-label="Balance">
                    {r.t.balance != null ? money(r.t.balance) : '—'}
                  </td>
                )}
                <td className="tx-note" data-label="Note">
                  <TxNoteCell note={r.t.note} onSave={(note) => onSetTxNote(r.cardId, r.t.id, note)} />
                </td>
                <td className="tx-delete">
                  <button
                    type="button"
                    className="tx-delete-btn"
                    title="Delete transaction"
                    aria-label="Delete transaction"
                    onClick={async () => {
                      if (await confirmAsync('Delete this transaction? This can’t be undone.')) onDeleteTransaction(r.cardId, r.t.id);
                    }}
                  >
                    <TrashIcon />
                  </button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={hasBalance ? 8 : 7} className="muted tx-empty">
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
