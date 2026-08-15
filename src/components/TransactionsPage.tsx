import { useEffect, useMemo, useState } from 'react';
import type { Transaction } from '../types';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../lib/categorize';
import { UNSORTED, type SubResolver } from '../lib/subcategory';
import { isExcluded, type CategoryFilterState } from '../lib/categoryFilter';
import { money } from '../lib/format';
import CategoryPicker from './CategoryPicker';
import ColumnHeaderMenu from './ColumnHeaderMenu';
import TxNoteCell from './TxNoteCell';
import TrashIcon from './TrashIcon';

export interface TransactionsJump {
  from: string;
  to: string;
  /** Changes on every jump so identical dates still re-trigger the effect. */
  token: number;
}

interface Props {
  transactions: Transaction[];
  categoryOf: (tx: Transaction) => string;
  overriddenIds: Set<string>;
  customCategories: string[];
  sub: SubResolver;
  categoryFilter: CategoryFilterState;
  /** Set when arriving from a chart-click drill-down; pre-fills the date
   *  range and (only for this visit) applies the hidden-category filter —
   *  the Transactions tab otherwise always shows every category. */
  jump?: TransactionsJump | null;
  onSetCategory: (id: string, category: string) => void;
  onClearCategory: (id: string) => void;
  onCreateCategory: (name: string) => void;
  onSetSubCategory: (id: string, parent: string, subName: string) => void;
  onSetTxNote: (id: string, note: string) => void;
  onDeleteTransaction: (id: string) => void;
}

type TypeFilter = 'all' | 'expense' | 'income';
type SortCol = 'date' | 'description' | 'amount';
interface SortState {
  col: SortCol;
  dir: 'asc' | 'desc';
}
const PAGE = 100;

function compareBase(col: SortCol, a: { t: Transaction; cat: string }, b: { t: Transaction; cat: string }): number {
  switch (col) {
    case 'date':
      return a.t.date.localeCompare(b.t.date);
    case 'description':
      return a.t.description.localeCompare(b.t.description);
    case 'amount':
      return a.t.amount - b.t.amount;
    default:
      return 0;
  }
}

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
  categoryFilter,
  jump,
  onSetCategory,
  onClearCategory,
  onCreateCategory,
  onSetSubCategory,
  onSetTxNote,
  onDeleteTransaction,
}: Props) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [categorySelected, setCategorySelected] = useState<Set<string> | null>(null);
  const [sort, setSort] = useState<SortState>({ col: 'date', dir: 'desc' });
  const [fromDate, setFromDate] = useState(jump?.from ?? '');
  const [toDate, setToDate] = useState(jump?.to ?? '');
  const [visible, setVisible] = useState(PAGE);
  const [hiddenActive, setHiddenActive] = useState(Boolean(jump));

  // A fresh chart-click jump pre-fills the date range and (only this once)
  // restricts to categories that aren't hidden elsewhere in the app.
  useEffect(() => {
    if (!jump) return;
    setFromDate(jump.from);
    setToDate(jump.to);
    setHiddenActive(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.token]);

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

  // Tag + sort once per sort choice (newest first by default); filtering/search
  // runs cheaply over this.
  const base = useMemo(() => {
    const tagged = transactions.map((t) => ({ t, cat: categoryOf(t) }));
    const mult = sort.dir === 'asc' ? 1 : -1;
    tagged.sort((a, b) => compareBase(sort.col, a, b) * mult);
    return tagged;
  }, [transactions, categoryOf, sort]);

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
        if (categorySelected && !categorySelected.has(r.cat)) return false;
        if (fromDate && r.t.date < fromDate) return false;
        if (toDate && r.t.date > toDate) return false;
        if (needle && !r.t.description.toLowerCase().includes(needle)) return false;
        if (hiddenActive && isExcluded(categoryFilter, r.cat, sub.subOf(r.t, r.cat))) return false;
        return true;
      }),
    [base, typeFilter, categorySelected, fromDate, toDate, needle, hiddenActive, categoryFilter, sub],
  );

  // Keep the rendered list bounded whenever the filters change.
  useEffect(() => {
    setVisible(PAGE);
  }, [search, typeFilter, categorySelected, fromDate, toDate]);

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
          <span className="hidden-tray-label">Showing only categories that aren’t hidden elsewhere in the app.</span>
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
              <th className="tx-note">Note</th>
              <th className="tx-delete" />
            </tr>
          </thead>
          <tbody>
            {shown.map(({ t, cat }) => (
              <tr key={t.id}>
                <td className="tx-date" data-label="Date">{t.date}</td>
                <td className="desc" data-label="Description" title={t.description}>
                  {t.description || '—'}
                </td>
                <td className="tx-cat" data-label="Category">
                  <div className="tx-cat-cell">
                    <div className="tx-cat-edit">
                      <CategoryPicker
                        value={cat}
                        onChange={(c) => onSetCategory(t.id, c)}
                        options={t.amount < 0 ? options : incomeOptions}
                        onCreate={onCreateCategory}
                      />
                      <button
                        type="button"
                        className={`tx-reset ${overriddenIds.has(t.id) ? '' : 'tx-reset-hidden'}`}
                        title="Revert to automatic category"
                        aria-hidden={!overriddenIds.has(t.id)}
                        tabIndex={overriddenIds.has(t.id) ? 0 : -1}
                        onClick={() => onClearCategory(t.id)}
                      >
                        ↺
                      </button>
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
                <td className={`num ${t.amount >= 0 ? 'pos' : 'neg'}`} data-label="Amount">{money(t.amount)}</td>
                <td className="tx-note" data-label="Note">
                  <TxNoteCell note={t.note} onSave={(note) => onSetTxNote(t.id, note)} />
                </td>
                <td className="tx-delete">
                  <button
                    type="button"
                    className="tx-delete-btn"
                    title="Delete transaction"
                    aria-label="Delete transaction"
                    onClick={() => {
                      if (confirm('Delete this transaction? This can’t be undone.')) onDeleteTransaction(t.id);
                    }}
                  >
                    <TrashIcon />
                  </button>
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
