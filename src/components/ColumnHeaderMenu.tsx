import { useEffect, useMemo, useRef, useState } from 'react';

interface Props {
  label: string;
  align?: 'left' | 'right';
  /** Omit all four to disable sorting — filter-only header. */
  sortActive?: boolean;
  sortDir?: 'asc' | 'desc';
  ascLabel?: string;
  descLabel?: string;
  onSort?: (dir: 'asc' | 'desc') => void;
  /** Omit both to disable the checklist filter — sort-only header. */
  filterValues?: string[];
  /** null means "everything selected" (no filter applied). */
  selectedValues?: Set<string> | null;
  onChangeSelected?: (next: Set<string> | null) => void;
}

/**
 * Excel-style column header: click to open a menu with "sort ascending" /
 * "sort descending" (where applicable) and, for columns with a bounded set
 * of values, a checklist to show only specific ones plus an explicit "Clear
 * filter" action — same interaction as an AutoFilter dropdown. The whole
 * header cell is the click target, not just an icon.
 */
export default function ColumnHeaderMenu({
  label,
  align = 'left',
  sortActive,
  sortDir,
  ascLabel,
  descLabel,
  onSort,
  filterValues,
  selectedValues,
  onChangeSelected,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const hasFilter = filterValues !== undefined && onChangeSelected !== undefined;
  const total = filterValues?.length ?? 0;
  const selectedCount = selectedValues ? selectedValues.size : total;
  const isFiltered = hasFilter && selectedCount < total;
  const allChecked = selectedCount === total;
  const noneChecked = selectedCount === 0;

  const shownValues = useMemo(() => {
    if (!filterValues) return [];
    const q = search.trim().toLowerCase();
    return q ? filterValues.filter((v) => v.toLowerCase().includes(q)) : filterValues;
  }, [filterValues, search]);

  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = !allChecked && !noneChecked;
  }, [allChecked, noneChecked]);

  const toggleAll = () => {
    if (!onChangeSelected) return;
    onChangeSelected(allChecked ? new Set() : null);
  };
  const toggleOne = (v: string) => {
    if (!onChangeSelected || !filterValues) return;
    const base = selectedValues ?? new Set(filterValues);
    const next = new Set(base);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChangeSelected(next.size === filterValues.length ? null : next);
  };

  return (
    <div className={`col-menu ${align === 'right' ? 'col-menu-right' : ''}`} ref={ref}>
      <button type="button" className="col-menu-btn" onClick={() => setOpen((o) => !o)}>
        <span className="col-menu-label">{label}</span>
        {sortActive && <span className="col-menu-sort-ind">{sortDir === 'asc' ? '▲' : '▼'}</span>}
        {isFiltered && <span className="col-menu-filter-dot" title="Filtered" />}
        <svg className="col-menu-caret" viewBox="0 0 10 6" width="9" height="6" aria-hidden="true">
          <path d="M0 0 L10 0 L5 6 Z" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className={`menu-pop col-menu-pop ${align === 'right' ? 'col-menu-pop-right' : ''}`} role="menu">
          {onSort && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onSort('asc');
                  setOpen(false);
                }}
              >
                {ascLabel}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onSort('desc');
                  setOpen(false);
                }}
              >
                {descLabel}
              </button>
            </>
          )}
          {hasFilter && filterValues && filterValues.length > 0 && (
            <>
              {onSort && <div className="menu-sep" />}
              {isFiltered && (
                <button
                  type="button"
                  role="menuitem"
                  className="col-menu-clear"
                  onClick={() => {
                    onChangeSelected?.(null);
                    setOpen(false);
                  }}
                >
                  ✕ Clear filter
                </button>
              )}
              <div className="menu-sep" />
              {filterValues.length > 8 && (
                <input
                  className="col-menu-search"
                  autoFocus
                  value={search}
                  placeholder="Search…"
                  onChange={(e) => setSearch(e.target.value)}
                />
              )}
              <label className="filter-check col-menu-selectall">
                <input ref={selectAllRef} type="checkbox" checked={allChecked} onChange={toggleAll} />
                Select all
              </label>
              <div className="col-menu-list">
                {shownValues.map((v) => (
                  <label key={v} className="filter-check">
                    <input
                      type="checkbox"
                      checked={!selectedValues || selectedValues.has(v)}
                      onChange={() => toggleOne(v)}
                    />
                    {v}
                  </label>
                ))}
                {shownValues.length === 0 && <div className="muted col-menu-empty">No matches</div>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
